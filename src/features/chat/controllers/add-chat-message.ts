import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { uploads } from '@global/helpers/cloudinary-upload';
import { IUserDocument } from '@user/interfaces/user.interface';
import { UserCache } from '@service/redis/user.cache';
import { MessageCache } from '@service/redis/message.cache';
import { addChatSchema } from '@chat/schemes/chat';
import { IChatUsers, IMessageData, IMessageNotification } from '@chat/interfaces/chat.interface';
import { INotificationTemplate } from '@notification/interfaces/notification.interface';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { emailQueue } from '@service/queues/email.queue';
import { socketIOChatObject } from '@socket/chat';
import { connectedUsersMap } from '@socket/user';
import { chatQueue } from '@service/queues/chat.queue';
import { userService } from '@service/db/user.service';
import { chatService } from '@service/db/chat.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const userCache: UserCache = new UserCache();
const messageCache: MessageCache = new MessageCache();
const log: Logger = config.createLogger('addChatMessage');

export class Add {
  @joiValidation(addChatSchema)
  public async message(req: Request, res: Response): Promise<void> {
    try {
      // Validate required fields early
      if (!req.currentUser || !req.currentUser.userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          message: 'User not authenticated',
          error: 'Authentication required'
        });
        return;
      }

      const {
        conversationId,
        receiverId,
        receiverUsername,
        receiverAvatarColor,
        receiverProfilePicture,
        body,
        gifUrl,
        isRead,
        selectedImage
      } = req.body;

      // Validate required fields
      if (!receiverId || !receiverUsername || !receiverProfilePicture) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          message: 'Missing required fields: receiverId, receiverUsername, and receiverProfilePicture are required',
          error: 'Validation error'
        });
        return;
      }

      let fileUrl = '';
      const messageObjectId: ObjectId = new ObjectId();

      // Safely convert conversationId to ObjectId
      let conversationObjectId: mongoose.Types.ObjectId;
      try {
        conversationObjectId = conversationId
          ? new mongoose.Types.ObjectId(conversationId)
          : new mongoose.Types.ObjectId();
      } catch (error) {
        log.error(`Invalid conversationId format: ${conversationId}`, error);
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          message: 'Invalid conversationId format',
          error: 'Validation error'
        });
        return;
      }

      // Get sender profile picture from cache/database, but don't block on it
      // Use empty string as default, try to get from cache/database with short timeout
      let senderProfilePicture = '';

      // Try to get profile picture from cache/database, but with very short timeout
      // If it fails, we'll use empty string (not critical for message creation)
      try {
        const sender = await Promise.race([
          userCache.getUserFromCache(`${req.currentUser!.userId}`),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
        ]);
        if (sender?.profilePicture) {
          senderProfilePicture = sender.profilePicture;
        } else {
          // Try database as fallback, but with very short timeout
          try {
            const dbSender = await Promise.race([
              userService.getUserById(`${req.currentUser!.userId}`),
              new Promise<IUserDocument | null>((resolve) => {
                setTimeout(() => resolve(null), 2000);
              })
            ]);
            if (dbSender?.profilePicture) {
              senderProfilePicture = dbSender.profilePicture;
            }
          } catch (error) {
            // Silently fail - profile picture is not critical
            log.warn(`Failed to get sender profile picture: ${error}`);
          }
        }
      } catch (error) {
        // Silently fail - profile picture is not critical for message creation
        log.warn(`Failed to get sender from cache: ${error}`);
      }

      // Handle image upload with timeout - don't block response
      if (selectedImage && selectedImage.length) {
        // Generate a unique public_id using messageObjectId to ensure each image has a unique Cloudinary ID
        const uniqueImageId = `${messageObjectId}`;
        // Add timeout protection for Cloudinary upload (shorter timeout)
        try {
          const result = await Promise.race([
            uploads(selectedImage, uniqueImageId, true, true),
            new Promise<UploadApiErrorResponse>((resolve) => {
              setTimeout(() => {
                log.warn(`Cloudinary upload timed out for messageId: ${messageObjectId}`);
                resolve({
                  error: { message: 'Upload timeout' },
                  message: 'Cloudinary upload timed out after 5 seconds',
                  name: 'UploadTimeoutError',
                  http_code: 408,
                  severity: 'error'
                } as unknown as UploadApiErrorResponse);
              }, 5000); // Reduced to 5 seconds
            })
          ]);

          // Check if upload failed or returned undefined
          if (!result || (result as UploadApiErrorResponse).error) {
            const errorResponse = result as UploadApiErrorResponse;
            log.warn('Cloudinary upload failed, continuing without image:', errorResponse.message);
            // Don't throw error - just log and continue without image
            // The message will be saved without the image
          } else {
            // Verify we have a valid upload response
            const uploadResponse = result as UploadApiResponse;
            if (uploadResponse.public_id) {
              // Use Cloudinary's secure_url if available, otherwise construct the URL manually
              fileUrl = uploadResponse.secure_url || uploadResponse.url || `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v${uploadResponse.version}/${uploadResponse.public_id}`;
              log.info('✅ Cloudinary upload successful:', { fileUrl, public_id: uploadResponse.public_id });
            } else {
              log.warn('Cloudinary upload response missing public_id, continuing without image');
            }
          }
        } catch (error) {
          log.error(`Cloudinary upload error: ${error}, continuing without image`);
          // Don't throw error - continue without image to ensure response is sent
        }
      }

      // Convert senderId and receiverId to ObjectId for Mongoose schema compatibility
      let senderIdObjectId: mongoose.Types.ObjectId;
      let receiverIdObjectId: mongoose.Types.ObjectId;
      try {
        senderIdObjectId = typeof req.currentUser!.userId === 'string'
          ? new mongoose.Types.ObjectId(req.currentUser!.userId)
          : req.currentUser!.userId;
        receiverIdObjectId = typeof receiverId === 'string'
          ? new mongoose.Types.ObjectId(receiverId)
          : receiverId;
      } catch (error) {
        log.error(`Invalid ObjectId format: senderId=${req.currentUser!.userId}, receiverId=${receiverId}`, error);
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          message: 'Invalid user ID format',
          error: 'Validation error'
        });
        return;
      }

      const messageData: IMessageData = {
        _id: `${messageObjectId}`,
        conversationId: conversationObjectId,
        receiverId: receiverIdObjectId as any, // Cast to any since interface says string but schema needs ObjectId
        receiverAvatarColor: receiverAvatarColor || '',
        receiverProfilePicture,
        receiverUsername,
        senderUsername: `${req.currentUser!.username}`,
        senderId: senderIdObjectId as any, // Cast to any since interface says string but schema needs ObjectId
        senderAvatarColor: `${req.currentUser!.avatarColor}`,
        senderProfilePicture: senderProfilePicture || req.currentUser!.avatarColor || '',
        body,
        isRead,
        gifUrl,
        selectedImage: fileUrl,
        reaction: [],
        createdAt: new Date(),
        deleteForEveryone: false,
        deleteForMe: false
      };

      // Send response immediately - don't wait for database or cache operations
      // This ensures the endpoint always responds quickly, even if services are slow/unavailable
      res.status(HTTP_STATUS.OK).json({
        message: 'Message added',
        conversationId: conversationObjectId
      });

      // Fire and forget - save to database asynchronously via queue
      // This prevents blocking the response if database is slow/unavailable
      setImmediate(() => {
        try {
          chatQueue.addChatJob('addChatMessageToDB', messageData);
        } catch (queueError) {
          log.error('Failed to add job to queue:', queueError);
          // Try to save directly as last resort (but don't wait for it)
          chatService.addMessageToDB(messageData).catch((dbError) => {
            log.error('Failed to save message to database:', dbError);
          });
        }
      });

      // Fire and forget - do these operations asynchronously after response is sent
      // This prevents blocking the response if Redis is slow/unavailable
      setImmediate(async () => {
        // Emit socket events - wrap in try-catch to prevent crashes
        try {
          Add.prototype.emitSocketIOEvent(messageData);
        } catch (error) {
          log.warn('Failed to emit socket events:', error);
        }

        if (!isRead) {
          // Fire and forget notification - don't block on it
          Add.prototype.messageNotification({
            currentUser: req.currentUser!,
            message: body,
            receiverName: receiverUsername,
            receiverId,
            messageData
          }).catch((error) => {
            log.warn('Failed to send message notification:', error);
          });
        }

        // Cache operations - fire and forget with timeouts
        // 1 - add sender to chat list in cache
        Promise.race([
          messageCache.addChatListToCache(`${req.currentUser!.userId}`, `${receiverId}`, `${conversationObjectId}`),
          new Promise<void>((resolve) => {
            setTimeout(() => {
              log.warn('addChatListToCache (sender) timed out');
              resolve();
            }, 2000);
          })
        ]).catch((error) => {
          log.warn('Failed to add sender to chat list cache:', error);
        });

        // 2 - add receiver to chat list in cache
        Promise.race([
          messageCache.addChatListToCache(`${receiverId}`, `${req.currentUser!.userId}`, `${conversationObjectId}`),
          new Promise<void>((resolve) => {
            setTimeout(() => {
              log.warn('addChatListToCache (receiver) timed out');
              resolve();
            }, 2000);
          })
        ]).catch((error) => {
          log.warn('Failed to add receiver to chat list cache:', error);
        });

        // 3 - add message data to cache
        Promise.race([
          messageCache.addChatMessageToCache(`${conversationObjectId}`, messageData),
          new Promise<void>((resolve) => {
            setTimeout(() => {
              log.warn('addChatMessageToCache timed out');
              resolve();
            }, 2000);
          })
        ]).catch((error) => {
          log.warn('Failed to add message to cache:', error);
        });
      });
    } catch (error) {
      log.error(`Error in message endpoint: ${error}`);
      // Ensure response is sent even if there's an error
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          message: 'Failed to add message',
          error: 'Internal server error'
        });
      }
    }
  }

  public async addChatUsers(req: Request, res: Response): Promise<void> {
    // Add timeout to prevent hanging if Redis is slow/unavailable
    let chatUsers: IChatUsers[] = [];
    try {
      chatUsers = await Promise.race([
        messageCache.addChatUsersToCache(req.body),
        new Promise<IChatUsers[]>((resolve) => {
          setTimeout(() => {
            log.warn('addChatUsersToCache timed out, returning empty array');
            resolve([]);
          }, 3000);
        })
      ]);
    } catch (error) {
      log.error('Failed to add chat users to cache:', error);
      // Continue with empty array - cache failure is non-fatal
      chatUsers = [];
    }

    if (socketIOChatObject) {
      socketIOChatObject.emit('add chat users', chatUsers);
    }
    res.status(HTTP_STATUS.OK).json({ message: 'Users added', chatUsers });
  }

  public async removeChatUsers(req: Request, res: Response): Promise<void> {
    // Add timeout to prevent hanging if Redis is slow/unavailable
    let chatUsers: IChatUsers[] = [];
    try {
      chatUsers = await Promise.race([
        messageCache.removeChatUsersFromCache(req.body),
        new Promise<IChatUsers[]>((resolve) => {
          setTimeout(() => {
            log.warn('removeChatUsersFromCache timed out, returning empty array');
            resolve([]);
          }, 3000);
        })
      ]);
    } catch (error) {
      log.error('Failed to remove chat users from cache:', error);
      // Continue with empty array - cache failure is non-fatal
      chatUsers = [];
    }

    if (socketIOChatObject) {
      socketIOChatObject.emit('remove chat users', chatUsers);
    }
    res.status(HTTP_STATUS.OK).json({ message: 'Users removed', chatUsers });
  }

  private emitSocketIOEvent(data: IMessageData): void {
    // Emit to specific users in the conversation instead of broadcasting globally
    const senderId = `${data.senderId}`;
    const receiverId = `${data.receiverId}`;

    // Emit message received event to receiver
    const receiverSocketId = connectedUsersMap.get(receiverId);
    if (receiverSocketId && socketIOChatObject) {
      socketIOChatObject.to(receiverSocketId).emit('message received', data);
      log.debug(`Message emitted to receiver ${receiverId} (socket: ${receiverSocketId})`);
    }

    // Emit chat list update to both sender and receiver
    if (socketIOChatObject) {
      // Update sender's chat list
      const senderSocketId = connectedUsersMap.get(senderId);
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit('chat list', data);
      }

      // Update receiver's chat list
      if (receiverSocketId) {
        socketIOChatObject.to(receiverSocketId).emit('chat list', data);
      }
    }

    // Fallback: if socket IDs not found, emit globally (for backwards compatibility)
    if (!receiverSocketId) {
      log.warn(`Receiver ${receiverId} not found in connectedUsersMap, broadcasting globally`);
      socketIOChatObject?.emit('message received', data);
      socketIOChatObject?.emit('chat list', data);
    }
  }

  private async messageNotification({ currentUser, message, receiverName, receiverId }: IMessageNotification): Promise<void> {
    // Get user data with timeout to prevent hanging
    let cachedUser: IUserDocument | null = null;
    try {
      cachedUser = await Promise.race([
        userCache.getUserFromCache(`${receiverId}`) as Promise<IUserDocument>,
        new Promise<IUserDocument | null>((resolve) => {
          setTimeout(() => {
            log.warn(`getUserFromCache timed out for ${receiverId}, trying database`);
            resolve(null);
          }, 2000);
        })
      ]);

      // If cache failed or timed out, get from database
      if (!cachedUser) {
        cachedUser = await userService.getUserById(`${receiverId}`);
      }
    } catch (error) {
      log.warn('Failed to get user for notification:', error);
      // Continue without notification if user lookup fails
      return;
    }

    if (cachedUser?.notifications?.messages) {
      const templateParams: INotificationTemplate = {
        username: receiverName,
        message,
        header: `Message notification from ${currentUser.username}`
      };
      const template: string = notificationTemplate.notificationMessageTemplate(templateParams);
      emailQueue.addEmailJob('directMessageEmail', {
        receiverEmail: cachedUser.email!,
        template,
        subject: `You've received messages from ${currentUser.username}`
      });
    }
  }
}

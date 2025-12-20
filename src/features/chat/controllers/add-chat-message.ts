import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { uploads } from '@global/helpers/cloudinary-upload';
import { BadRequestError } from '@global/helpers/error-handler';
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
      let fileUrl = '';
      const messageObjectId: ObjectId = new ObjectId();
      const conversationObjectId: mongoose.Types.ObjectId = conversationId
        ? new mongoose.Types.ObjectId(conversationId)
        : new mongoose.Types.ObjectId();

      // Get sender from cache, fallback to database if not in cache
      // Use timeout to prevent hanging if Redis is slow/unavailable
      let sender: IUserDocument | null = null;
      try {
        sender = await Promise.race([
          userCache.getUserFromCache(`${req.currentUser!.userId}`),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
      } catch (error) {
        log.warn(`Failed to get user from cache: ${error}, falling back to database`);
      }

      if (!sender) {
        log.warn(`User ${req.currentUser!.userId} not found in cache, fetching from database`);
        try {
          // Add timeout protection for database call
          sender = await Promise.race([
            userService.getUserById(`${req.currentUser!.userId}`),
            new Promise<IUserDocument | null>((resolve) => {
              setTimeout(() => {
                log.warn(`getUserById timed out for ${req.currentUser!.userId}`);
                resolve(null);
              }, 5000);
            })
          ]);
        } catch (error) {
          log.error(`Failed to get user from database: ${error}`);
          throw new BadRequestError('Failed to retrieve user information. Please try again.');
        }
      }

      if (!sender) {
        throw new BadRequestError('User not found. Please login again.');
      }

      if (selectedImage && selectedImage.length) {
        // Generate a unique public_id using messageObjectId to ensure each image has a unique Cloudinary ID
        const uniqueImageId = `${messageObjectId}`;
        const result: UploadApiResponse | UploadApiErrorResponse | undefined = await uploads(
          selectedImage,
          uniqueImageId,
          true, // Allow overwrite in case of retries - messageObjectId should be unique anyway
          true
        );

        // Check if upload failed or returned undefined
        if (!result || (result as UploadApiErrorResponse).error) {
          const errorResponse = result as UploadApiErrorResponse;
          const errorMessage = errorResponse?.message || 'Failed to upload image to Cloudinary';
          console.error('❌ Cloudinary upload error:', {
            error: errorResponse?.error,
            message: errorMessage,
            uniqueImageId,
            http_code: errorResponse?.http_code
          });
          throw new BadRequestError(errorMessage);
        }

        // Verify we have a valid upload response
        const uploadResponse = result as UploadApiResponse;
        if (!uploadResponse.public_id) {
          console.error('❌ Cloudinary upload response missing public_id:', {
            result: uploadResponse
          });
          throw new BadRequestError('Invalid response from Cloudinary upload: missing public_id');
        }

        // Use Cloudinary's secure_url if available, otherwise construct the URL manually with correct cloud name
        fileUrl = uploadResponse.secure_url || uploadResponse.url || `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v${uploadResponse.version}/${uploadResponse.public_id}`;
        console.log('✅ Cloudinary upload successful:', {
          fileUrl,
          public_id: uploadResponse.public_id,
          version: uploadResponse.version,
          secure_url: uploadResponse.secure_url,
          url: uploadResponse.url
        });
      }

      // Convert senderId and receiverId to ObjectId for Mongoose schema compatibility
      const senderIdObjectId = typeof req.currentUser!.userId === 'string'
        ? new mongoose.Types.ObjectId(req.currentUser!.userId)
        : req.currentUser!.userId;
      const receiverIdObjectId = typeof receiverId === 'string'
        ? new mongoose.Types.ObjectId(receiverId)
        : receiverId;

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
        senderProfilePicture: sender.profilePicture || req.currentUser!.avatarColor || '',
        body,
        isRead,
        gifUrl,
        selectedImage: fileUrl,
        reaction: [],
        createdAt: new Date(),
        deleteForEveryone: false,
        deleteForMe: false
      };

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

      // 1 - add sender to chat list in cache (with error handling)
      try {
        await messageCache.addChatListToCache(`${req.currentUser!.userId}`, `${receiverId}`, `${conversationObjectId}`);
      } catch (error) {
        log.warn('Failed to add sender to chat list cache:', error);
      }

      // 2 - add receiver to chat list in cache (with error handling)
      try {
        await messageCache.addChatListToCache(`${receiverId}`, `${req.currentUser!.userId}`, `${conversationObjectId}`);
      } catch (error) {
        log.warn('Failed to add receiver to chat list cache:', error);
      }

      // 3 - add message data to cache (with error handling)
      try {
        await messageCache.addChatMessageToCache(`${conversationObjectId}`, messageData);
      } catch (error) {
        log.warn('Failed to add message to cache:', error);
      }

      // 4 - Save to database synchronously to ensure persistence, then queue for any additional processing
      // Add timeout protection to prevent hanging if database is slow/unavailable
      try {
        await Promise.race([
          chatService.addMessageToDB(messageData),
          new Promise<void>((_, reject) => {
            setTimeout(() => {
              log.warn('addMessageToDB timed out after 5 seconds, falling back to queue');
              reject(new Error('Database operation timeout'));
            }, 5000);
          })
        ]);
      } catch (error) {
        log.error('Failed to save message synchronously, falling back to queue:', error);
        chatQueue.addChatJob('addChatMessageToDB', messageData);
      }

      res.status(HTTP_STATUS.OK).json({ message: 'Message added', conversationId: conversationObjectId });
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

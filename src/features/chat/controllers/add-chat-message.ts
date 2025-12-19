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
        sender = await userService.getUserById(`${req.currentUser!.userId}`);
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

      // Use Cloudinary's secure_url if available, otherwise construct the URL manually
      fileUrl = uploadResponse.secure_url || uploadResponse.url || `https://res.cloudinary.com/dynamr9ym3/image/upload/v${uploadResponse.version}/${uploadResponse.public_id}`;
      console.log('✅ Cloudinary upload successful:', {
        fileUrl,
        public_id: uploadResponse.public_id,
        version: uploadResponse.version,
        secure_url: uploadResponse.secure_url,
        url: uploadResponse.url
      });
    }

    const messageData: IMessageData = {
      _id: `${messageObjectId}`,
      conversationId: conversationObjectId,
      receiverId,
      receiverAvatarColor,
      receiverProfilePicture,
      receiverUsername,
      senderUsername: `${req.currentUser!.username}`,
      senderId: `${req.currentUser!.userId}`,
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

    Add.prototype.emitSocketIOEvent(messageData);

    if (!isRead) {
      Add.prototype.messageNotification({
        currentUser: req.currentUser!,
        message: body,
        receiverName: receiverUsername,
        receiverId,
        messageData
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
    try {
      await chatService.addMessageToDB(messageData);
    } catch (error) {
      log.error('Failed to save message synchronously, falling back to queue:', error);
      chatQueue.addChatJob('addChatMessageToDB', messageData);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Message added', conversationId: conversationObjectId });
  }

  public async addChatUsers(req: Request, res: Response): Promise<void> {
    const chatUsers: IChatUsers[] = await messageCache.addChatUsersToCache(req.body);
    socketIOChatObject.emit('add chat users', chatUsers);
    res.status(HTTP_STATUS.OK).json({ message: 'Users added', chatUsers });
  }

  public async removeChatUsers(req: Request, res: Response): Promise<void> {
    const chatUsers: IChatUsers[] = await messageCache.removeChatUsersFromCache(req.body);
    socketIOChatObject.emit('remove chat users', chatUsers);
    res.status(HTTP_STATUS.OK).json({ message: 'Users removed', chatUsers });
  }

  private emitSocketIOEvent(data: IMessageData): void {
    socketIOChatObject?.emit('message received', data);
    socketIOChatObject?.emit('chat list', data);
  }

  private async messageNotification({ currentUser, message, receiverName, receiverId }: IMessageNotification): Promise<void> {
    const cachedUser: IUserDocument = (await userCache.getUserFromCache(`${receiverId}`)) as IUserDocument;
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

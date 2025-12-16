import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { UploadApiResponse } from 'cloudinary';
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

const userCache: UserCache = new UserCache();
const messageCache: MessageCache = new MessageCache();

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

    const sender: IUserDocument = (await userCache.getUserFromCache(`${req.currentUser!.userId}`)) as IUserDocument;

    if (selectedImage && selectedImage.length) {
      const result: UploadApiResponse = (await uploads(
        selectedImage,
        req.currentUser!.userId,
        true,
        true
      )) as UploadApiResponse;
      if (!result?.public_id) {
        throw new BadRequestError(result.message);
      }
      fileUrl = `https://res.cloudinary.com/dynamr9ym3/image/upload/v${result.version}/${result.public_id}`;
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
      senderProfilePicture: `${sender.profilePicture}`,
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

    // 1 - add sender to chat list in cache
    await messageCache.addChatListToCache(`${req.currentUser!.userId}`, `${receiverId}`, `${conversationObjectId}`);
    // 2 - add receiver to chat list in cache
    await messageCache.addChatListToCache(`${receiverId}`, `${req.currentUser!.userId}`, `${conversationObjectId}`);
    // 3 - add message data to cache
    await messageCache.addChatMessageToCache(`${conversationObjectId}`, messageData);
    // 4 - add message to chat queue
    chatQueue.addChatJob('addChatMessageToDB', messageData);

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

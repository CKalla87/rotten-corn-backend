import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { markChatSchema } from '@chat/schemes/chat';
import { MessageCache } from '@service/redis/message.cache';
import { IMessageData } from '@chat/interfaces/chat.interface';
import { socketIOChatObject } from '@socket/chat';
import { connectedUsersMap } from '@socket/user';
import { chatQueue } from '@service/queues/chat.queue';
import { config } from '@root/config';
import Logger from 'bunyan';

const messageCache: MessageCache = new MessageCache();
const log: Logger = config.createLogger('updateChatMessage');

export class Update {
  @joiValidation(markChatSchema)
  public async message(req: Request, res: Response): Promise<void> {
    const { senderId, receiverId } = req.body;
    const updatedMessage: IMessageData = await messageCache.updateChatMessages(senderId, receiverId);

    // Emit to specific users instead of broadcasting globally
    const senderSocketId = connectedUsersMap.get(senderId);
    const receiverSocketId = connectedUsersMap.get(receiverId);

    if (socketIOChatObject) {
      // Emit message read event to sender
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit('message read', updatedMessage);
      }

      // Emit chat list update to both users
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit('chat list', updatedMessage);
      }
      if (receiverSocketId) {
        socketIOChatObject.to(receiverSocketId).emit('chat list', updatedMessage);
      }
    }

    chatQueue.addChatJob('markMessagesAsReadInDB', {
      senderId: new mongoose.Types.ObjectId(senderId),
      receiverId: new mongoose.Types.ObjectId(receiverId)
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Message marked as read' });
  }
}

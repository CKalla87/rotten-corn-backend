import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { MessageCache } from '@service/redis/message.cache';
import { IMessageData } from '@chat/interfaces/chat.interface';
import { socketIOChatObject } from '@socket/chat';
import { connectedUsersMap } from '@socket/user';
import { chatQueue } from '@service/queues/chat.queue';
import { config } from '@root/config';
import Logger from 'bunyan';

const messageCache: MessageCache = new MessageCache();
const log: Logger = config.createLogger('deleteChatMessage');

export class Delete {
  public async markMessageAsDeleted(req: Request, res: Response): Promise<void> {
    const { senderId, receiverId, messageId, type } = req.params;
    const updatedMessage: IMessageData = await messageCache.markMessageAsDeleted(
      senderId,
      receiverId,
      messageId,
      type
    );

    // Emit to specific users instead of broadcasting globally
    const senderSocketId = connectedUsersMap.get(senderId);
    const receiverSocketId = connectedUsersMap.get(receiverId);

    if (socketIOChatObject) {
      // Emit message read event to both users
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit('message read', updatedMessage);
      }
      if (receiverSocketId) {
        socketIOChatObject.to(receiverSocketId).emit('message read', updatedMessage);
      }

      // Emit chat list update to both users
      if (senderSocketId) {
        socketIOChatObject.to(senderSocketId).emit('chat list', updatedMessage);
      }
      if (receiverSocketId) {
        socketIOChatObject.to(receiverSocketId).emit('chat list', updatedMessage);
      }
    }

    chatQueue.addChatJob('markMessageAsDeletedInDB', {
      messageId: new mongoose.Types.ObjectId(messageId),
      type
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Message marked as deleted' });
  }
}

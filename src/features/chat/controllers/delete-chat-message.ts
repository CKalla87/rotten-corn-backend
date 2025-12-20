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
    
    // Add timeout protection to prevent hanging if Redis is slow/unavailable
    let updatedMessage: IMessageData = {} as IMessageData;
    try {
      updatedMessage = await Promise.race([
        messageCache.markMessageAsDeleted(senderId, receiverId, messageId, type),
        new Promise<IMessageData>((resolve) => {
          setTimeout(() => {
            log.warn(`markMessageAsDeleted cache operation timed out for messageId: ${messageId}`);
            resolve({} as IMessageData);
          }, 3000);
        })
      ]);
    } catch (error) {
      log.warn(`Failed to mark message as deleted in cache: ${error}, continuing with queue job`);
    }

    // Only emit socket events if we successfully got the updated message from cache
    // If cache timed out or failed, skip socket events (database update will still happen via queue)
    if (updatedMessage && updatedMessage._id) {
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
    } else {
      log.warn(`Skipping socket events for message deletion due to cache timeout/failure, messageId: ${messageId}`);
    }

    chatQueue.addChatJob('markMessageAsDeletedInDB', {
      messageId: new mongoose.Types.ObjectId(messageId),
      type
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Message marked as deleted' });
  }
}

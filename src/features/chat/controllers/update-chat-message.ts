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
    try {
      const { senderId, receiverId } = req.body;
      
      // Add timeout protection to prevent hanging if Redis is slow/unavailable
      let updatedMessage: IMessageData = {} as IMessageData;
      try {
        updatedMessage = await Promise.race([
          messageCache.updateChatMessages(senderId, receiverId),
          new Promise<IMessageData>((resolve) => {
            setTimeout(() => {
              log.warn(`updateChatMessages cache operation timed out for senderId: ${senderId}, receiverId: ${receiverId}`);
              resolve({} as IMessageData);
            }, 3000);
          })
        ]);
      } catch (error) {
        log.warn(`Failed to update chat messages in cache: ${error}, continuing with queue job`);
      }

      // Only emit socket events if we successfully got the updated message from cache
      // If cache timed out or failed, skip socket events (database update will still happen via queue)
      if (updatedMessage && updatedMessage._id) {
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
      } else {
        log.warn(`Skipping socket events for mark-as-read due to cache timeout/failure, senderId: ${senderId}, receiverId: ${receiverId}`);
      }

      chatQueue.addChatJob('markMessagesAsReadInDB', {
        senderId: new mongoose.Types.ObjectId(senderId),
        receiverId: new mongoose.Types.ObjectId(receiverId)
      });

      res.status(HTTP_STATUS.OK).json({ message: 'Message marked as read' });
    } catch (error) {
      log.error(`Error in mark-as-read endpoint: ${error}`);
      // Ensure response is sent even if there's an error
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
          message: 'Failed to mark message as read',
          error: 'Internal server error'
        });
      }
    }
  }
}

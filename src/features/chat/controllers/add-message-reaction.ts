import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { socketIOChatObject } from '@socket/chat';
import { connectedUsersMap } from '@socket/user';
import { IMessageData } from '@chat/interfaces/chat.interface';
import { config } from '@root/config';
import Logger from 'bunyan';

const messageCache: MessageCache = new MessageCache();
const log: Logger = config.createLogger('addMessageReaction');

export class Message {
  public async reaction(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId, messageId, reaction, type, senderId, receiverId } = req.body;
      
      // Add timeout protection to prevent hanging if Redis is slow/unavailable
      let updatedMessage: IMessageData = {} as IMessageData;
      try {
        updatedMessage = await Promise.race([
          messageCache.updateMessageReaction(
            conversationId,
            messageId,
            reaction,
            `${req.currentUser!.username}`,
            type
          ),
          new Promise<IMessageData>((resolve) => {
            setTimeout(() => {
              log.warn(`updateMessageReaction cache operation timed out for messageId: ${messageId}`);
              resolve({} as IMessageData);
            }, 3000);
          })
        ]);
      } catch (error) {
        log.warn(`Failed to update message reaction in cache: ${error}, continuing with queue job`);
      }

      // Only emit socket events if we successfully got the updated message from cache
      // If cache timed out or failed, skip socket events (database update will still happen via queue)
      if (updatedMessage && updatedMessage._id) {
        if (socketIOChatObject && senderId && receiverId) {
          const senderSocketId = connectedUsersMap.get(senderId);
          const receiverSocketId = connectedUsersMap.get(receiverId);

          // Emit reaction to both users in the conversation
          if (senderSocketId) {
            socketIOChatObject.to(senderSocketId).emit('message reaction', updatedMessage);
          }
          if (receiverSocketId) {
            socketIOChatObject.to(receiverSocketId).emit('message reaction', updatedMessage);
          }
        } else if (socketIOChatObject) {
          // Fallback: broadcast if user IDs not provided
          socketIOChatObject.emit('message reaction', updatedMessage);
        }
      } else {
        log.warn(`Skipping socket events for message reaction due to cache timeout/failure, messageId: ${messageId}`);
      }

      chatQueue.addChatJob('updateMessageReaction', {
        messageId: new mongoose.Types.ObjectId(messageId),
        senderName: req.currentUser!.username,
        reaction,
        type
      });

      res.status(HTTP_STATUS.OK).json({ message: 'Message reaction added' });
    } catch (error) {
      log.error(`Error in reaction endpoint: ${error}`);
      // Ensure response is sent even if there's an error
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
          message: 'Failed to add reaction',
          error: 'Internal server error'
        });
      }
    }
  }
}

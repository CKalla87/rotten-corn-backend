import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { chatService } from '@service/db/chat.service';
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
      
      // Send response immediately - don't wait for database
      res.status(HTTP_STATUS.OK).json({ message: 'Message reaction added' });

      // Save to database in background with timeout - use queue for reliability
      setImmediate(async () => {
        try {
          // Try direct DB save first with short timeout (3 seconds)
          await Promise.race([
            chatService.updateMessageReaction(
              new mongoose.Types.ObjectId(messageId),
              req.currentUser!.username,
              reaction,
              type
            ),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Database save timeout after 3 seconds')), 3000);
            })
          ]);
          log.info('Reaction saved to database successfully', { messageId, reaction, type });
        } catch (dbError) {
          log.warn('Direct DB save failed or timed out, using queue:', dbError);
          // Always queue as fallback/primary mechanism for persistence
          try {
            chatQueue.addChatJob('updateMessageReaction', {
              messageId: new mongoose.Types.ObjectId(messageId),
              senderName: req.currentUser!.username,
              reaction,
              type
            });
            log.info('Reaction queued for database save', { messageId });
          } catch (queueError) {
            log.error('Failed to queue reaction:', queueError);
            // Last resort: try direct save one more time (don't await)
            chatService.updateMessageReaction(
              new mongoose.Types.ObjectId(messageId),
              req.currentUser!.username,
              reaction,
              type
            ).catch((finalError) => {
              log.error('Final attempt to save reaction failed:', finalError);
            });
          }
        }
      });

      // Update cache and emit socket events asynchronously (non-blocking)
      // Cache is just for optimization, database is the source of truth
      setImmediate(async () => {
        try {
          const updatedMessage = await Promise.race([
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

          // Emit socket events if cache update succeeded
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
          }
        } catch (error) {
          log.warn('Failed to update cache or emit socket events for reaction:', error);
        }
      });
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

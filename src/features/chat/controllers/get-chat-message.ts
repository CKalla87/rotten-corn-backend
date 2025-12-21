import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { MessageCache } from '@service/redis/message.cache';
import { chatService } from '@service/db/chat.service';
import { IMessageData } from '@chat/interfaces/chat.interface';
import { config } from '@root/config';
import Logger from 'bunyan';

const messageCache: MessageCache = new MessageCache();
const log: Logger = config.createLogger('getChatMessage');

export class Get {
  public async conversationList(req: Request, res: Response): Promise<void> {
    try {
      // Add timeout to prevent hanging if database is slow/unavailable
      const list: IMessageData[] = await Promise.race([
        chatService.getUserConversationList(
          new mongoose.Types.ObjectId(req.currentUser!.userId)
        ),
        new Promise<IMessageData[]>((_, reject) => {
          setTimeout(() => reject(new Error('Database query timeout after 5 seconds')), 5000);
        })
      ]);

      res.status(HTTP_STATUS.OK).json({ message: 'User conversation list', list });
    } catch (error) {
      log.error('Failed to get conversation list:', error);
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
          message: 'Failed to get conversation list',
          error: 'Database error',
          list: [] 
        });
      }
    }
  }

  public async messages(req: Request, res: Response): Promise<void> {
    try {
      const { receiverId } = req.params;
      
      // Add timeout to prevent hanging if database is slow/unavailable
      const messages: IMessageData[] = await Promise.race([
        chatService.getMessages(
          new mongoose.Types.ObjectId(req.currentUser!.userId),
          new mongoose.Types.ObjectId(receiverId)
        ),
        new Promise<IMessageData[]>((_, reject) => {
          setTimeout(() => reject(new Error('Database query timeout after 5 seconds')), 5000);
        })
      ]);

      res.status(HTTP_STATUS.OK).json({ message: 'User chat messages', messages });
    } catch (error) {
      log.error('Failed to get messages:', error);
      if (!res.headersSent) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
          message: 'Failed to get messages',
          error: 'Database error',
          messages: [] 
        });
      }
    }
  }
}

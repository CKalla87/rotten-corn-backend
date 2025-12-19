import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { MessageCache } from '@service/redis/message.cache';
import { chatService } from '@service/db/chat.service';
import { IMessageData } from '@chat/interfaces/chat.interface';

const messageCache: MessageCache = new MessageCache();

export class Get {
  public async conversationList(req: Request, res: Response): Promise<void> {
    // Skip cache - go directly to database for faster response
    // Database query is now optimized with timeout
    const list: IMessageData[] = await chatService.getUserConversationList(
      new mongoose.Types.ObjectId(req.currentUser!.userId)
    );

    res.status(HTTP_STATUS.OK).json({ message: 'User conversation list', list });
  }

  public async messages(req: Request, res: Response): Promise<void> {
    const { receiverId } = req.params;
    // Skip cache - go directly to database for faster response
    // Database query is now optimized with timeout
    const messages: IMessageData[] = await chatService.getMessages(
      new mongoose.Types.ObjectId(req.currentUser!.userId),
      new mongoose.Types.ObjectId(receiverId)
    );

    res.status(HTTP_STATUS.OK).json({ message: 'User chat messages', messages });
  }
}

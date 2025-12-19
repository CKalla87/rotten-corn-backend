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
    const { conversationId, messageId, reaction, type, senderId, receiverId } = req.body;
    const updatedMessage: IMessageData = await messageCache.updateMessageReaction(
      conversationId,
      messageId,
      reaction,
      `${req.currentUser!.username}`,
      type
    );

    // Emit to specific users in the conversation instead of broadcasting globally
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
    } else {
      // Fallback: broadcast if user IDs not provided
      socketIOChatObject.emit('message reaction', updatedMessage);
    }

    chatQueue.addChatJob('updateMessageReaction', {
      messageId: new mongoose.Types.ObjectId(messageId),
      senderName: req.currentUser!.username,
      reaction,
      type
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Message reaction added' });
  }
}

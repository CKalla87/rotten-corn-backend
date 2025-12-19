import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { socketIOChatObject } from '@socket/chat';
import { connectedUsersMap } from '@socket/user';
import { ITyping } from '@chat/interfaces/chat.interface';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('typingIndicator');

export class Typing {
  public async startTyping(req: Request, res: Response): Promise<void> {
    const { receiverId } = req.body;
    const senderId = `${req.currentUser!.userId}`;
    const senderName = `${req.currentUser!.username}`;

    if (!receiverId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Receiver ID is required' });
      return;
    }

    const typingData: ITyping = {
      sender: senderId,
      receiver: receiverId
    };

    // Emit typing indicator to receiver
    const receiverSocketId = connectedUsersMap.get(receiverId);
    if (receiverSocketId && socketIOChatObject) {
      socketIOChatObject.to(receiverSocketId).emit('typing', {
        sender: senderId,
        senderName,
        isTyping: true
      });
      log.debug(`Typing indicator sent: ${senderName} (${senderId}) is typing to ${receiverId}`);
    } else {
      log.warn(`Receiver ${receiverId} not found in connectedUsersMap`);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Typing indicator sent' });
  }

  public async stopTyping(req: Request, res: Response): Promise<void> {
    const { receiverId } = req.body;
    const senderId = `${req.currentUser!.userId}`;
    const senderName = `${req.currentUser!.username}`;

    if (!receiverId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'Receiver ID is required' });
      return;
    }

    // Emit stop typing indicator to receiver
    const receiverSocketId = connectedUsersMap.get(receiverId);
    if (receiverSocketId && socketIOChatObject) {
      socketIOChatObject.to(receiverSocketId).emit('stop typing', {
        sender: senderId,
        senderName,
        isTyping: false
      });
      log.debug(`Stop typing indicator sent: ${senderName} (${senderId}) stopped typing to ${receiverId}`);
    } else {
      log.warn(`Receiver ${receiverId} not found in connectedUsersMap`);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Stop typing indicator sent' });
  }
}


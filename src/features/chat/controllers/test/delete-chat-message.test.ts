import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { Delete } from '@chat/controllers/delete-chat-message';
import { Server } from 'socket.io';
import * as chatServer from '@socket/chat';
import { chatMockRequest, chatMockResponse, mockMessageId } from '../../../../mocks/chat.mock';
import { existingUser } from '../../../../mocks/user.mock';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { messageDataMock } from '../../../../mocks/chat.mock';
import { connectedUsersMap } from '@socket/user';
import mongoose from 'mongoose';

jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/message.cache');
jest.mock('@socket/user', () => ({
  connectedUsersMap: new Map()
}));

Object.defineProperties(chatServer, {
  socketIOChatObject: {
    value: new Server(),
    writable: true
  }
});

describe('Delete', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // Clear and setup connectedUsersMap for tests
    connectedUsersMap.clear();
    // Add mock socket IDs for sender and receiver
    connectedUsersMap.set(`${existingUser._id}`, 'sender-socket-id');
    connectedUsersMap.set('60263f14648fed5246e322d8', 'receiver-socket-id');
  });

  afterEach(() => {
    jest.clearAllMocks();
    connectedUsersMap.clear();
  });

  describe('markMessageAsDeleted', () => {
    it('should send correct json response (deleteForMe)', async () => {
      const req: Request = chatMockRequest({}, {}, authUserPayload, {
        senderId: `${existingUser._id}`,
        receiverId: '60263f14648fed5246e322d8',
        messageId: `${mockMessageId}`,
        type: 'deleteForMe'
      }) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(MessageCache.prototype, 'markMessageAsDeleted').mockResolvedValue(messageDataMock);

      // Mock the socket.to() method to return an object with emit
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (chatServer.socketIOChatObject as any).to = mockTo;

      jest.spyOn(chatQueue, 'addChatJob');

      await Delete.prototype.markMessageAsDeleted(req, res);

      // Verify socket.to() was called for sender and receiver
      expect(mockTo).toHaveBeenCalledWith('sender-socket-id');
      expect(mockTo).toHaveBeenCalledWith('receiver-socket-id');

      // Verify emit was called for message read and chat list (2 times each = 4 total)
      expect(mockEmit).toHaveBeenCalledWith('message read', messageDataMock);
      expect(mockEmit).toHaveBeenCalledWith('chat list', messageDataMock);

      expect(chatQueue.addChatJob).toHaveBeenCalledWith('markMessageAsDeletedInDB', {
        messageId: new mongoose.Types.ObjectId(mockMessageId),
        type: 'deleteForMe'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message marked as deleted'
      });
    });

    it('should send correct json response (deleteForEveryone)', async () => {
      const req: Request = chatMockRequest({}, {}, authUserPayload, {
        senderId: `${existingUser._id}`,
        receiverId: '60263f14648fed5246e322d8',
        messageId: `${mockMessageId}`,
        type: 'deleteForEveryone'
      }) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(MessageCache.prototype, 'markMessageAsDeleted').mockResolvedValue(messageDataMock);

      // Mock the socket.to() method to return an object with emit
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (chatServer.socketIOChatObject as any).to = mockTo;

      jest.spyOn(chatQueue, 'addChatJob');

      await Delete.prototype.markMessageAsDeleted(req, res);

      // Verify socket.to() was called for sender and receiver
      expect(mockTo).toHaveBeenCalledWith('sender-socket-id');
      expect(mockTo).toHaveBeenCalledWith('receiver-socket-id');

      // Verify emit was called for message read and chat list (2 times each = 4 total)
      expect(mockEmit).toHaveBeenCalledWith('message read', messageDataMock);
      expect(mockEmit).toHaveBeenCalledWith('chat list', messageDataMock);

      expect(chatQueue.addChatJob).toHaveBeenCalledWith('markMessageAsDeletedInDB', {
        messageId: new mongoose.Types.ObjectId(mockMessageId),
        type: 'deleteForEveryone'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message marked as deleted'
      });
    });
  });
});

import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { Update } from '@chat/controllers/update-chat-message';
import { Server } from 'socket.io';
import * as chatServer from '@socket/chat';
import { chatMockRequest, chatMockResponse } from '../../../../mocks/chat.mock';
import { existingUser } from '../../../../mocks/user.mock';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { messageDataMock } from '../../../../mocks/chat.mock';
import { connectedUsersMap } from '@socket/user';

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

describe('Update', () => {
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

  describe('message', () => {
    it('should send correct json response from redis cache', async () => {
      const req: Request = chatMockRequest(
        {},
        {
          senderId: `${existingUser._id}`,
          receiverId: '60263f14648fed5246e322d8'
        },
        authUserPayload
      ) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(MessageCache.prototype, 'updateChatMessages').mockResolvedValue(messageDataMock);

      // Mock the socket.to() method to return an object with emit
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (chatServer.socketIOChatObject as any).to = mockTo;

      await Update.prototype.message(req, res);

      // Verify socket.to() was called for sender and receiver
      expect(mockTo).toHaveBeenCalledWith('sender-socket-id');
      expect(mockTo).toHaveBeenCalledWith('receiver-socket-id');

      // Verify emit was called for message read and chat list
      expect(mockEmit).toHaveBeenCalledWith('message read', messageDataMock);
      expect(mockEmit).toHaveBeenCalledWith('chat list', messageDataMock);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message marked as read'
      });
    });

    it('should call chatQueue addChatJob', async () => {
      const req: Request = chatMockRequest(
        {},
        {
          senderId: `${existingUser._id}`,
          receiverId: '60263f14648fed5246e322d8'
        },
        authUserPayload
      ) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(MessageCache.prototype, 'updateChatMessages').mockResolvedValue(messageDataMock);
      jest.spyOn(chatQueue, 'addChatJob');

      await Update.prototype.message(req, res);
      expect(chatQueue.addChatJob).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message marked as read'
      });
    });
  });
});

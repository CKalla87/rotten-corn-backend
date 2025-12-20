import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { authUserPayload } from '@root/mocks/auth.mock';
import { Server } from 'socket.io';
import * as chatServer from '@socket/chat';
import { chatMockRequest, chatMockResponse, mockMessageId } from '../../../../mocks/chat.mock';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { messageDataMock } from '../../../../mocks/chat.mock';
import { Message } from '@chat/controllers/add-message-reaction';
import { connectedUsersMap } from '@socket/user';
import { chatService } from '@service/db/chat.service';

jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/message.cache');
jest.mock('@service/db/chat.service');
jest.mock('@socket/user', () => ({
  connectedUsersMap: new Map()
}));

Object.defineProperties(chatServer, {
  socketIOChatObject: {
    value: new Server(),
    writable: true
  }
});

describe('Message', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // Clear and setup connectedUsersMap for tests
    connectedUsersMap.clear();
    // Add mock socket IDs for sender and receiver
    connectedUsersMap.set(authUserPayload.userId, 'sender-socket-id');
    connectedUsersMap.set('60263f14648fed5246e322d8', 'receiver-socket-id');
  });

  afterEach(() => {
    jest.clearAllMocks();
    connectedUsersMap.clear();
  });

  describe('message', () => {
    it('should call updateMessageReaction on chatService synchronously', async () => {
      const req: Request = chatMockRequest(
        {},
        {
          conversationId: '602854c81c9ca7939aaeba43',
          messageId: `${mockMessageId}`,
          reaction: 'love',
          type: 'add',
          senderId: authUserPayload.userId,
          receiverId: '60263f14648fed5246e322d8'
        },
        authUserPayload
      ) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(chatService, 'updateMessageReaction').mockResolvedValue();
      jest.spyOn(MessageCache.prototype, 'updateMessageReaction').mockResolvedValue(messageDataMock);
      
      // Mock the socket.to() method to return an object with emit
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (chatServer.socketIOChatObject as any).to = mockTo;

      await Message.prototype.reaction(req, res);
      
      // Verify database save was called synchronously
      expect(chatService.updateMessageReaction).toHaveBeenCalledWith(
        expect.any(mongoose.Types.ObjectId), // messageId as ObjectId
        authUserPayload.username,
        'love',
        'add'
      );
      
      // Wait for setImmediate to complete (cache operations run asynchronously)
      await new Promise(resolve => setImmediate(resolve));
      // Wait a bit more to ensure all async operations complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify cache update was called asynchronously
      expect(MessageCache.prototype.updateMessageReaction).toHaveBeenCalledWith(
        '602854c81c9ca7939aaeba43',
        `${mockMessageId}`,
        'love',
        `${authUserPayload.username}`,
        'add'
      );
      
      // Socket events are only emitted if message has _id (which messageDataMock has)
      // Verify socket.to() was called for sender and receiver
      expect(mockTo).toHaveBeenCalledWith('sender-socket-id');
      expect(mockTo).toHaveBeenCalledWith('receiver-socket-id');
      // Verify emit was called for message reaction
      expect(mockEmit).toHaveBeenCalledWith('message reaction', messageDataMock);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message reaction added'
      });
    }, 10000); // Increase timeout to 10 seconds

    it('should call chatQueue addChatJob as fallback when DB save fails', async () => {
      const req: Request = chatMockRequest(
        {},
        {
          conversationId: '602854c81c9ca7939aaeba43',
          messageId: `${mockMessageId}`,
          reaction: 'love',
          type: 'add',
          senderId: authUserPayload.userId,
          receiverId: '60263f14648fed5246e322d8'
        },
        authUserPayload
      ) as Request;
      const res: Response = chatMockResponse();
      jest.spyOn(chatService, 'updateMessageReaction').mockRejectedValue(new Error('DB error'));
      jest.spyOn(chatQueue, 'addChatJob');

      await Message.prototype.reaction(req, res);
      
      // Verify database save was attempted
      expect(chatService.updateMessageReaction).toHaveBeenCalled();
      
      // Verify queue was called as fallback
      expect(chatQueue.addChatJob).toHaveBeenCalledWith('updateMessageReaction', {
        messageId: expect.any(mongoose.Types.ObjectId), // ObjectId
        senderName: req.currentUser!.username,
        reaction: 'love',
        type: 'add'
      });
      
      // Should return error status
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Failed to add reaction',
        error: 'Database error'
      });
    });
  });
});

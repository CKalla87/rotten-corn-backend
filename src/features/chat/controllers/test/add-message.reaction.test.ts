import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { Server } from 'socket.io';
import * as chatServer from '@socket/chat';
import { chatMockRequest, chatMockResponse, mockMessageId } from '../../../../mocks/chat.mock';
import { MessageCache } from '@service/redis/message.cache';
import { chatQueue } from '@service/queues/chat.queue';
import { messageDataMock } from '../../../../mocks/chat.mock';
import { Message } from '@chat/controllers/add-message-reaction';
import { connectedUsersMap } from '@socket/user';

jest.useFakeTimers();
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
    jest.clearAllTimers();
    connectedUsersMap.clear();
  });

  describe('message', () => {
    it('should call updateMessageReaction', async () => {
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
      jest.spyOn(MessageCache.prototype, 'updateMessageReaction').mockResolvedValue(messageDataMock);
      
      // Mock the socket.to() method to return an object with emit
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (chatServer.socketIOChatObject as any).to = mockTo;

      await Message.prototype.reaction(req, res);
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
    });

    it('should call chatQueue addChatJob', async () => {
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
      jest.spyOn(chatQueue, 'addChatJob');

      await Message.prototype.reaction(req, res);
      expect(chatQueue.addChatJob).toHaveBeenCalledWith('updateMessageReaction', {
        messageId: mockMessageId,
        senderName: req.currentUser!.username,
        reaction: 'love',
        type: 'add'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Message reaction added'
      });
    });
  });
});

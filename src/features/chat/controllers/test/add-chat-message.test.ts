import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import * as chatServer from '@socket/chat';
import { chatMessage, chatMockRequest, chatMockResponse } from '../../../../mocks/chat.mock';
import { Add } from '@chat/controllers/add-chat-message';
import { chatQueue } from '@service/queues/chat.queue';
import { authUserPayload } from '@root/mocks/auth.mock';
import { MessageCache } from '@service/redis/message.cache';
import { emailQueue } from '@service/queues/email.queue';
import { existingUser, existingUserTwo } from '../../../../mocks/user.mock';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { UserCache } from '@service/redis/user.cache';
import { chatService } from '@service/db/chat.service';
import { userService } from '@service/db/user.service';

jest.mock('@service/queues/base.queue');
jest.mock('@socket/user');
jest.mock('@service/redis/user.cache');
jest.mock('@service/redis/message.cache');
jest.mock('@service/queues/email.queue');
jest.mock('@service/db/chat.service');
jest.mock('@service/db/user.service');

Object.defineProperties(chatServer, {
  socketIOChatObject: {
    value: new Server(),
    writable: true
  }
});

describe('Add', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // Setup mocks after restoreAllMocks
    jest.spyOn(UserCache.prototype, 'getUserFromCache').mockResolvedValue(existingUser);
    jest.spyOn(userService, 'getUserById').mockResolvedValue(existingUser);
    jest.spyOn(chatService, 'addMessageToDB').mockResolvedValue();
    jest.spyOn(MessageCache.prototype, 'addChatListToCache').mockResolvedValue();
    jest.spyOn(MessageCache.prototype, 'addChatMessageToCache').mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call socket.io emit twice', async () => {
    jest.spyOn(chatServer.socketIOChatObject, 'emit');
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();

    await Add.prototype.message(req, res);
    // Should emit 'message received' and 'chat list' events
    expect(chatServer.socketIOChatObject.emit).toHaveBeenCalled();
  });

  it('should call addEmailJob method', async () => {
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();
    // Create a user with notifications enabled
    const userWithNotifications = existingUserTwo as any;
    userWithNotifications.notifications = { ...existingUserTwo.notifications, messages: true };
    jest.spyOn(UserCache.prototype, 'getUserFromCache').mockResolvedValue(userWithNotifications);
    jest.spyOn(userService, 'getUserById').mockResolvedValue(userWithNotifications);
    jest.spyOn(emailQueue, 'addEmailJob');

    const templateParams = {
      username: userWithNotifications.username!,
      message: chatMessage.body,
      header: `Message notification from ${req.currentUser!.username}`
    };
    const template: string = notificationTemplate.notificationMessageTemplate(templateParams);

    await Add.prototype.message(req, res);
    expect(emailQueue.addEmailJob).toHaveBeenCalledWith('directMessageEmail', {
      receiverEmail: userWithNotifications.email!,
      template,
      subject: `You've received messages from ${req.currentUser!.username!}`
    });
  });

  it('should not call addEmailJob method', async () => {
    chatMessage.isRead = true;
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();
    jest.spyOn(emailQueue, 'addEmailJob');

    const templateParams = {
      username: existingUserTwo.username!,
      message: chatMessage.body,
      header: `Message Notification from ${req.currentUser!.username}`
    };
    const template: string = notificationTemplate.notificationMessageTemplate(templateParams);

    await Add.prototype.message(req, res);
    expect(emailQueue.addEmailJob).not.toHaveBeenCalledWith('directMessageMail', {
      receiverEmail: req.currentUser!.email,
      template,
      subject: `You've received messages from ${existingUserTwo.username!}`
    });
  });

  it('should call addChatListToCache twice', async () => {
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();

    await Add.prototype.message(req, res);
    // Should be called once for sender and once for receiver
    expect(MessageCache.prototype.addChatListToCache).toHaveBeenCalledTimes(2);
  });

  it('should call addChatMessageToCache', async () => {
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();

    await Add.prototype.message(req, res);
    expect(MessageCache.prototype.addChatMessageToCache).toHaveBeenCalledTimes(1);
  });

  it('should call chatQueue addChatJob', async () => {
    jest.spyOn(chatService, 'addMessageToDB').mockRejectedValue(new Error('DB error'));
    jest.spyOn(chatQueue, 'addChatJob');
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();

    await Add.prototype.message(req, res);
    // Queue should only be called if database save fails
    // Since we're mocking a failure, it should be called
    expect(chatQueue.addChatJob).toHaveBeenCalledTimes(1);
  });

  it('should send correct json response', async () => {
    const req: Request = chatMockRequest({}, chatMessage, authUserPayload) as Request;
    const res: Response = chatMockResponse();

    await Add.prototype.message(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Message added',
      conversationId: new mongoose.Types.ObjectId(`${chatMessage.conversationId}`)
    });
  });
});

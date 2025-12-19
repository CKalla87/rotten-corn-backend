import { Request, Response } from 'express';
import { authUserPayload, authMockRequest, authMockResponse } from '@root/mocks/auth.mock';
import { Server } from 'socket.io';
import * as userServer from '@socket/user';
import { Edit } from '@user/controllers/update-basic-info';
import { UserCache } from '@service/redis/user.cache';
import { userQueue } from '@service/queues/user.queue';
import { userService } from '@service/db/user.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@socket/user');
jest.mock('@service/redis/user.cache');
jest.mock('@service/db/user.service');

Object.defineProperties(userServer, {
  socketIOUserObject: {
    value: new Server(),
    writable: true
  }
});

describe('EditBasicInfo', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('info', () => {
    it('should call updateUserInfo to save to database first', async () => {
      const basicInfo = {
        quote: 'This is cool',
        work: 'KickChat Inc.',
        school: 'Taltech',
        location: 'Tallinn'
      };
      const req: Request = authMockRequest({}, basicInfo, authUserPayload, {}) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateUserInfo').mockResolvedValue();
      jest.spyOn(UserCache.prototype, 'updateSingleUserItemInCache').mockResolvedValue(null);

      await Edit.prototype.info(req, res);
      expect(userService.updateUserInfo).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Updated successfully'
      });
    });

    it('should fallback to queue if database save fails', async () => {
      const basicInfo = {
        quote: 'This is cool',
        work: 'KickChat Inc.',
        school: 'Taltech',
        location: 'Tallinn'
      };
      const req: Request = authMockRequest({}, basicInfo, authUserPayload, {}) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateUserInfo').mockRejectedValue(new Error('Database error'));
      jest.spyOn(userQueue, 'addUserJob');

      await Edit.prototype.info(req, res);
      expect(userService.updateUserInfo).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(userQueue.addUserJob).toHaveBeenCalledWith('updateBasicInfoInDB', {
        key: `${req.currentUser?.userId}`,
        value: req.body
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Updated successfully'
      });
    });
  });

  describe('social', () => {
    it('should call updateSocialLinks to save to database first', async () => {
      const socialInfo = {
        facebook: 'https://facebook.com/tester',
        instagram: 'https://instagram.com',
        youtube: 'https://youtube.com',
        twitter: 'https://twitter.com'
      };
      const req: Request = authMockRequest({}, socialInfo, authUserPayload, {}) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateSocialLinks').mockResolvedValue();
      jest.spyOn(UserCache.prototype, 'updateSingleUserItemInCache').mockResolvedValue(null);

      await Edit.prototype.social(req, res);
      expect(userService.updateSocialLinks).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Updated successfully'
      });
    });

    it('should fallback to queue if database save fails', async () => {
      const socialInfo = {
        facebook: 'https://facebook.com/tester',
        instagram: 'https://instagram.com',
        youtube: 'https://youtube.com',
        twitter: 'https://twitter.com'
      };
      const req: Request = authMockRequest({}, socialInfo, authUserPayload, {}) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateSocialLinks').mockRejectedValue(new Error('Database error'));
      jest.spyOn(userQueue, 'addUserJob');

      await Edit.prototype.social(req, res);
      expect(userService.updateSocialLinks).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(userQueue.addUserJob).toHaveBeenCalledWith('updateSocialLinksInDB', {
        key: `${req.currentUser?.userId}`,
        value: req.body
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Updated successfully'
      });
    });
  });
});

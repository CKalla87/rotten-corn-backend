import { Request, Response } from 'express';
import { authUserPayload, authMockRequest, authMockResponse } from '@root/mocks/auth.mock';
import { UpdateSettings } from '@user/controllers/update-settings';
import { userQueue } from '@service/queues/user.queue';
import { UserCache } from '@service/redis/user.cache';
import { userService } from '@service/db/user.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/user.cache');
jest.mock('@service/db/user.service');

describe('Settings', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('update', () => {
    it('should call updateNotificationSettings to save to database first', async () => {
      const settings = {
        messages: true,
        reactions: false,
        comments: true,
        follows: false
      };
      const req: Request = authMockRequest({}, settings, authUserPayload) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateNotificationSettings').mockResolvedValue(undefined);
      jest.spyOn(UserCache.prototype, 'updateSingleUserItemInCache').mockResolvedValue(null);
      jest.spyOn(userQueue, 'addUserJob');

      await UpdateSettings.prototype.notification(req, res);
      expect(userService.updateNotificationSettings).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(UserCache.prototype.updateSingleUserItemInCache).toHaveBeenCalledWith(`${req.currentUser?.userId}`, 'notifications', req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Notification settings updated successfully', settings: req.body });
    });

    it('should fallback to queue if database save fails', async () => {
      const settings = {
        messages: true,
        reactions: false,
        comments: true,
        follows: false
      };
      const req: Request = authMockRequest({}, settings, authUserPayload) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'updateNotificationSettings').mockRejectedValue(new Error('Database error'));
      jest.spyOn(userQueue, 'addUserJob');
      jest.spyOn(UserCache.prototype, 'updateSingleUserItemInCache').mockResolvedValue(undefined as any);

      await UpdateSettings.prototype.notification(req, res);
      expect(userService.updateNotificationSettings).toHaveBeenCalledWith(`${req.currentUser?.userId}`, req.body);
      expect(userQueue.addUserJob).toHaveBeenCalledWith('updateNotificationSettings', {
        key: `${req.currentUser?.userId}`,
        value: req.body
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Notification settings updated successfully', settings: req.body });
    });
  });
});

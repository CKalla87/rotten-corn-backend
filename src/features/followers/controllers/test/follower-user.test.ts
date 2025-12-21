import { Request, Response } from 'express';
import { Server } from 'socket.io';
import { authUserPayload } from '@root/mocks/auth.mock';
import * as followerServer from '@socket/follower';
import { followersMockRequest, followersMockResponse } from '@root/mocks/followers.mock';
import { existingUser } from '@root/mocks/user.mock';
import { followerQueue } from '@service/queues/follower.queue';
import { Add } from '@root/features/followers/controllers/follower-user';
import { UserCache } from '@service/redis/user.cache';
import { FollowerCache } from '@service/redis/follow.cache';
import { followerService } from '@service/db/follower.service';
import { userService } from '@service/db/user.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/user.cache');
jest.mock('@service/redis/follow.cache');
jest.mock('@service/db/follower.service');
jest.mock('@service/db/user.service');

Object.defineProperties(followerServer, {
  socketIOFollowerObject: {
    value: new Server(),
    writable: true
  }
});

describe('Add', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('follower', () => {
    it('should call addFollowerToDB to save to database first', async () => {
      const req: Request = followersMockRequest({}, authUserPayload, { followerId: '6064861bc25eaa5a5d2f9bf4' }) as unknown as Request;
      const res: Response = followersMockResponse();
      jest.spyOn(followerService, 'addFollowerToDB').mockResolvedValue();
      jest.spyOn(userService, 'getUserById').mockResolvedValue(existingUser);
      jest.spyOn(followerServer.socketIOFollowerObject, 'emit');
      jest.spyOn(FollowerCache.prototype, 'updateFollowersCountInCache').mockResolvedValue();
      jest.spyOn(FollowerCache.prototype, 'saveFollowerToCache').mockResolvedValue();

      await Add.prototype.follower(req, res);
      expect(followerService.addFollowerToDB).toHaveBeenCalledWith(
        `${req.currentUser?.userId}`,
        '6064861bc25eaa5a5d2f9bf4',
        req.currentUser?.username,
        expect.anything() // followerDocumentId
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Following user now'
      });
    });

    it('should fallback to queue if database save fails', async () => {
      const req: Request = followersMockRequest({}, authUserPayload, { followerId: '6064861bc25eaa5a5d2f9bf4' }) as unknown as Request;
      const res: Response = followersMockResponse();
      jest.spyOn(followerService, 'addFollowerToDB').mockRejectedValue(new Error('Database error'));
      jest.spyOn(followerQueue, 'addFollowerJob');

      await Add.prototype.follower(req, res);
      expect(followerService.addFollowerToDB).toHaveBeenCalled();
      expect(followerQueue.addFollowerJob).toHaveBeenCalledWith('addFollowerToDB', {
        keyOne: `${req.currentUser?.userId}`,
        keyTwo: '6064861bc25eaa5a5d2f9bf4',
        username: req.currentUser?.username,
        followerDocumentId: expect.anything()
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Following user now'
      });
    });
  });
});

import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { followersMockRequest, followersMockResponse } from '@root/mocks/followers.mock';
import { existingUser } from '@root/mocks/user.mock';
import { followerQueue } from '@service/queues/follower.queue';
import { FollowerCache } from '@service/redis/follow.cache';
import { Remove } from '@root/features/followers/controllers/unfollow-user';
import { followerService } from '@service/db/follower.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/follow.cache');
jest.mock('@service/db/follower.service');

describe('Remove', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('should call removeFollowerFromDB to save to database first', async () => {
    const req: Request = followersMockRequest({}, authUserPayload, {
      followeeId: `${existingUser._id}`
    }) as unknown as Request;
    const res: Response = followersMockResponse();
    jest.spyOn(followerService, 'removeFollowerFromDB').mockResolvedValue();
    jest.spyOn(FollowerCache.prototype, 'removeFollowerFromCache').mockResolvedValue();
    jest.spyOn(FollowerCache.prototype, 'updateFollowersCountInCache').mockResolvedValue();

    await Remove.prototype.follower(req, res);
    expect(followerService.removeFollowerFromDB).toHaveBeenCalledWith(
      `${req.params.followeeId}`,
      `${req.currentUser!.userId}`
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Unfollowed user now'
    });
  });

  it('should fallback to queue if database save fails', async () => {
    const req: Request = followersMockRequest({}, authUserPayload, {
      followeeId: `${existingUser._id}`
    }) as unknown as Request;
    const res: Response = followersMockResponse();
    jest.spyOn(followerService, 'removeFollowerFromDB').mockRejectedValue(new Error('Database error'));
    jest.spyOn(followerQueue, 'addFollowerJob');

    await Remove.prototype.follower(req, res);
    expect(followerService.removeFollowerFromDB).toHaveBeenCalled();
    expect(followerQueue.addFollowerJob).toHaveBeenCalledWith('removeFollowerFromDB', {
      keyOne: `${req.params.followeeId}`,
      keyTwo: `${req.currentUser!.userId}`
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Unfollowed user now'
    });
  });
});

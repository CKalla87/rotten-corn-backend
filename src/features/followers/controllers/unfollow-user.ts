import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { FollowerCache } from '@service/redis/follow.cache';
import { followerQueue } from '@service/queues/follower.queue';
import { IFollowerJobData } from '../interfaces/follower.interface';

const followerCache: FollowerCache = new FollowerCache();

export class Remove {
  public async follower(req: Request, res: Response): Promise<void> {
    const { followeeId } = req.params;
    const followerId = `${req.currentUser!.userId}`;

    const removeFollowerFromCache: Promise<void> = followerCache.removeFollowerFromCache(
      `followers:${followeeId}`,
      followerId
    );
    const removeFolloweeFromCache: Promise<void> = followerCache.removeFollowerFromCache(
      `following:${followerId}`,
      `${followeeId}`
    );
    const followersCount: Promise<void> = followerCache.updateFollowersCountInCache(
      `${followeeId}`,
      'followersCount',
      -1
    );
    const followeeCount: Promise<void> = followerCache.updateFollowersCountInCache(
      followerId,
      'followingCount',
      -1
    );

    await Promise.all([removeFollowerFromCache, removeFolloweeFromCache, followersCount, followeeCount]);

    const jobData: IFollowerJobData = {
      keyOne: `${followeeId}`,
      keyTwo: followerId
    };
    followerQueue.addFollowerJob('removeFollowerFromDB', jobData);

    res.status(HTTP_STATUS.OK).json({ message: 'Unfollowed user now' });
  }
}

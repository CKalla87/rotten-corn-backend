import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { FollowerCache } from '@service/redis/follow.cache';
import { followerQueue } from '@service/queues/follower.queue';
import { IFollowerJobData } from '../interfaces/follower.interface';
import { followerService } from '@service/db/follower.service';
import { config } from '@root/config';

const followerCache: FollowerCache = new FollowerCache();
const log = config.createLogger('unfollowController');

export class Remove {
  public async follower(req: Request, res: Response): Promise<void> {
    const { followeeId } = req.params;
    const followerId = `${req.currentUser!.userId}`;

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations
    try {
      await followerService.removeFollowerFromDB(followeeId, followerId);
      log.info('Unfollow saved to database successfully', {
        userId: followerId,
        followeeId
      });
    } catch (error) {
      log.error('Failed to remove follower from database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: followerId,
        followeeId
      });
      // Fall back to queue if database save fails
      const jobData: IFollowerJobData = {
        keyOne: followeeId,
        keyTwo: followerId
      };
      followerQueue.addFollowerJob('removeFollowerFromDB', jobData);
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    Promise.all([
      followerCache.removeFollowerFromCache(`followers:${followeeId}`, followerId),
      followerCache.removeFollowerFromCache(`following:${followerId}`, followeeId),
      followerCache.updateFollowersCountInCache(followeeId, 'followersCount', -1),
      followerCache.updateFollowersCountInCache(followerId, 'followingCount', -1)
    ]).catch((cacheError) => {
      log.warn('Failed to update follower cache (non-critical)', cacheError);
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Unfollowed user now' });
  }
}

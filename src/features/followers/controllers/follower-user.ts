import HTTP_STATUS from 'http-status-codes';
import { IUserDocument } from '@user/interfaces/user.interface';
import { Request, Response } from 'express';
import { FollowerCache } from '@service/redis/follow.cache';
import { UserCache } from '@service/redis/user.cache';
import { IFollowerData, IFollowerJobData } from '../interfaces/follower.interface';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { socketIOFollowerObject } from '@socket/follower';
import { followerQueue } from '@service/queues/follower.queue';
import { followerService } from '@service/db/follower.service';
import { userService } from '@service/db/user.service';
import { config } from '@root/config';

const followerCache: FollowerCache = new FollowerCache();
const userCache: UserCache = new UserCache();
const log = config.createLogger('followerController');

export class Add {
  public async follower(req: Request, res: Response): Promise<void> {
    const { followerId } = req.params;
    const followerObjectId: ObjectId = new ObjectId();

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations
    try {
      await followerService.addFollowerToDB(
        `${req.currentUser!.userId}`,
        followerId,
        req.currentUser!.username,
        followerObjectId
      );
      log.info('Follower saved to database successfully', {
        userId: req.currentUser!.userId,
        followerId
      });
    } catch (error) {
      log.error('Failed to save follower to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.currentUser!.userId,
        followerId
      });
      // Fall back to queue if database save fails
      const databasePayload: IFollowerJobData = {
        keyOne: `${req.currentUser!.userId}`,
        keyTwo: followerId,
        username: req.currentUser!.username,
        followerDocumentId: followerObjectId
      };
      followerQueue.addFollowerJob('addFollowerToDB', databasePayload);
    }

    // Get current user profile from database (skip cache for speed)
    // We only need current user for socket emit, not the follower
    let currentUserProfile: IUserDocument | null = null;
    try {
      // Try cache first with timeout, fallback to database
      const cachePromise = userCache.getUserFromCache(`${req.currentUser!.userId}`);
      const timeoutPromise = new Promise<IUserDocument | null>((resolve) => {
        setTimeout(() => resolve(null), 2000);
      });
      currentUserProfile = await Promise.race([cachePromise, timeoutPromise]) as IUserDocument | null;

      // If cache failed or timed out, get from database
      if (!currentUserProfile) {
        currentUserProfile = await userService.getUserById(`${req.currentUser!.userId}`);
      }
    } catch (error) {
      log.warn('Failed to get user profile for socket emit', error);
      // Continue without socket emit if user lookup fails
    }

    // Emit socket event if we have user data
    if (currentUserProfile) {
      const followerData: IFollowerData = Add.prototype.userData(currentUserProfile);
      socketIOFollowerObject.emit('add follower', followerData);
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    Promise.all([
      followerCache.updateFollowersCountInCache(`${followerId}`, 'followersCount', 1),
      followerCache.updateFollowersCountInCache(`${req.currentUser!.userId}`, 'followingCount', 1),
      followerCache.saveFollowerToCache(`followers:${followerId}`, `${req.currentUser!.userId}`),
      followerCache.saveFollowerToCache(`following:${req.currentUser!.userId}`, followerId)
    ]).catch((cacheError) => {
      log.warn('Failed to update follower cache (non-critical)', cacheError);
    });

    res.status(HTTP_STATUS.OK).json({ message: 'Following user now' });
  }

  private userData(user: IUserDocument): IFollowerData  {
    return {
      _id: new mongoose.Types.ObjectId(user._id),
      username: user.username!,
      avatarColor: user.avatarColor!,
      postCount: user.postsCount,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      profilePicture: user.profilePicture,
      uId: user.uId!,
      userProfile: user
    };
  }

}

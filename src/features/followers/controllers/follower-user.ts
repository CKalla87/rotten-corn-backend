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

const followerCache: FollowerCache = new FollowerCache();
const userCache: UserCache = new UserCache();

export class Add {
  public async follower(req: Request, res: Response): Promise<void> {
    const { followerId } = req.params;

    const followersCount: Promise<void> = followerCache.updateFollowersCountInCache(`${followerId}`, 'followersCount', 1);
    const followeeCount: Promise<void> = followerCache.updateFollowersCountInCache(`${req.currentUser!.userId}`, 'followingCount', 1);

    await Promise.all([followersCount, followeeCount]);

    const cachedFollower: Promise<IUserDocument> = userCache.getUserFromCache(followerId) as Promise<IUserDocument>;
    const cachedFollowee: Promise<IUserDocument> = userCache.getUserFromCache(`${req.currentUser!.userId}`) as Promise<IUserDocument>;
    const response: [IUserDocument, IUserDocument] = await Promise.all([cachedFollower, cachedFollowee]);
    const [, currentUserProfile] = response;

    const followerObjectId: ObjectId = new ObjectId();
    const followerData: IFollowerData = Add.prototype.userData(currentUserProfile);
    socketIOFollowerObject.emit('add follower', followerData);

    const addFollowerToCache: Promise<void> = followerCache.saveFollowerToCache(`followers:${followerId}`, `${req.currentUser!.userId}`);
    const addFolloweeToCache: Promise<void> = followerCache.saveFollowerToCache(`following:${req.currentUser!.userId}`, `${followerId}`);
    await Promise.all([addFollowerToCache, addFolloweeToCache]);

    const databasePayload: IFollowerJobData = {
      keyOne: `${req.currentUser!.userId}`,
      keyTwo: `${followerId}`,
      username: req.currentUser!.username,
      followerDocumentId: followerObjectId
    };
    followerQueue.addFollowerJob('addFollowerToDB', databasePayload);

    res.status(HTTP_STATUS.OK).json({ message: 'Following user now' });
  }

  private userData(user: IUserDocument): IFollowerData {
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

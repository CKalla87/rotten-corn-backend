import { FollowerModel } from '@follower/models/follower.schema';
import { IFollowerData } from '@follower/interfaces/follower.interface';
import { UserModel } from '@user/models/user.schema';
import { IUserDocument } from '@user/interfaces/user.interface';
import { INotificationDocument, INotificationTemplate } from '@notification/interfaces/notification.interface';
import { NotificationModel } from '@notification/models/notification.schema';
import { socketIONotificationObject } from '@socket/notification';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { emailQueue } from '@service/queues/email.queue';
import mongoose from 'mongoose';
import { ObjectId, BulkWriteResult } from 'mongodb';

class FollowerService {
  public async addFollowerToDB(userId: string, followeeId: string, username: string, followerDocumentId: ObjectId): Promise<void> {
    const followeeObjectId: ObjectId = new mongoose.Types.ObjectId(followeeId);
    const followerObjectId: ObjectId = new mongoose.Types.ObjectId(userId);

    await FollowerModel.create({
      _id: followerDocumentId,
      followeeId: followeeObjectId,
      followerId: followerObjectId
    });

    const users: Promise<BulkWriteResult> = UserModel.bulkWrite([
      {
        updateOne: {
          filter: { _id: followerObjectId },
          update: { $inc: { followingCount: 1 } }
        }
      },
      {
        updateOne: {
          filter: { _id: followeeObjectId },
          update: { $inc: { followersCount: 1 } }
        }
      }
    ]);

    const response: [BulkWriteResult, IUserDocument | null] = await Promise.all([
      users,
      UserModel.findOne({ _id: followeeObjectId })
    ]);

    if (response[1]?.notifications?.follows && userId !== followeeId) {
      const notificationModel: INotificationDocument = new NotificationModel();
      const notifications: INotificationDocument[] = await notificationModel.insertNotification({
        userFrom: userId,
        userTo: followeeId,
        message: `${username} is now following you.`,
        notificationType: 'follows',
        entityId: new mongoose.Types.ObjectId(userId),
        createdItemId: new mongoose.Types.ObjectId(followerDocumentId),
        createdAt: new Date(),
        comment: '',
        post: '',
        imgId: '',
        imgVersion: '',
        gifUrl: '',
        reaction: ''
      });
      socketIONotificationObject?.emit('insert notification', notifications, { userTo: followeeId });
      const templateParams: INotificationTemplate = {
        username: response[1]?.username ?? 'User',
        message: `${username} is now following you.`,
        header: 'Follower Notification'
      };
      const template: string = notificationTemplate.notificationMessageTemplate(templateParams);
      const receiverEmail = response[1]?.email;
      if (receiverEmail) {
        emailQueue.addEmailJob('followersEmail', {
          receiverEmail,
          template,
          subject: `${username} is now following you.`
        });
      }
    }
  }

  public async removeFollowerFromDB(followeeId: string, followerId: string): Promise<void> {
    const followeeObjectId: ObjectId = new mongoose.Types.ObjectId(followeeId);
    const followerObjectId: ObjectId = new mongoose.Types.ObjectId(followerId);

    await FollowerModel.deleteOne({
      followeeId: followeeObjectId,
      followerId: followerObjectId
    });

    const users: Promise<BulkWriteResult> = UserModel.bulkWrite([
      {
        updateOne: {
          filter: { _id: followeeObjectId },
          update: { $inc: { followersCount: -1 } }
        }
      },
      {
        updateOne: {
          filter: { _id: followerObjectId },
          update: { $inc: { followingCount: -1 } }
        }
      }
    ]);

    await Promise.all([users, UserModel.findOne({ _id: followeeObjectId })]);
  }

  public async getFolloweeData(userObjectId: ObjectId): Promise<IFollowerData[]> {
    // Use find() with populate - much faster than aggregate with $lookup
    try {
      const followers = await FollowerModel.find({ followerId: userObjectId })
        .populate({
          path: 'followeeId',
          populate: { path: 'authId' }
        })
        .lean()
        .maxTimeMS(10000)
        .exec();

      // Transform to IFollowerData format
      return followers.map((follower: any) => {
        const user = follower.followeeId;
        const auth = user?.authId;
        return {
          _id: user?._id,
          username: auth?.username || '',
          avatarColor: auth?.avatarColor || '',
          uId: auth?.uId || '',
          postCount: user?.postsCount || 0,
          followersCount: user?.followersCount || 0,
          followingCount: user?.followingCount || 0,
          profilePicture: user?.profilePicture || '',
          userProfile: user
        } as IFollowerData;
      }).filter((f: IFollowerData) => f._id); // Filter out any invalid entries
    } catch (error) {
      // Fallback to aggregate if populate fails
      const followee: IFollowerData[] = await FollowerModel.aggregate([
        { $match: { followerId: userObjectId } },
        { $lookup: { from: 'User', localField: 'followeeId', foreignField: '_id', as: 'followeeId' } },
        { $unwind: '$followeeId' },
        { $lookup: { from: 'Auth', localField: 'followeeId.authId', foreignField: '_id', as: 'authId' } },
        { $unwind: '$authId' },
        {
          $addFields: {
            _id: '$followeeId._id',
            username: '$authId.username',
            avatarColor: '$authId.avatarColor',
            uId: '$authId.uId',
            postCount: '$followeeId.postsCount',
            followersCount: '$followeeId.followersCount',
            followingCount: '$followeeId.followingCount',
            profilePicture: '$followeeId.profilePicture',
            userProfile: '$followeeId'
          }
        },
        {
          $project: {
            authId: 0,
            followerId: 0,
            followeeId: 0,
            createdAt: 0,
            __v: 0
          }
        }
      ], { allowDiskUse: true, maxTimeMS: 10000 });
      return followee;
    }
  }

  public async getFollowerData(userObjectId: ObjectId): Promise<IFollowerData[]> {
    // Use find() with populate - much faster than aggregate with $lookup
    try {
      const followers = await FollowerModel.find({ followeeId: userObjectId })
        .populate({
          path: 'followerId',
          populate: { path: 'authId' }
        })
        .lean()
        .maxTimeMS(10000)
        .exec();

      // Transform to IFollowerData format
      return followers.map((follower: any) => {
        const user = follower.followerId;
        const auth = user?.authId;
        return {
          _id: user?._id,
          username: auth?.username || '',
          avatarColor: auth?.avatarColor || '',
          uId: auth?.uId || '',
          postCount: user?.postsCount || 0,
          followersCount: user?.followersCount || 0,
          followingCount: user?.followingCount || 0,
          profilePicture: user?.profilePicture || '',
          userProfile: user
        } as IFollowerData;
      }).filter((f: IFollowerData) => f._id); // Filter out any invalid entries
    } catch (error) {
      // Fallback to aggregate if populate fails
      const follower: IFollowerData[] = await FollowerModel.aggregate([
        { $match: { followeeId: userObjectId } },
        { $lookup: { from: 'User', localField: 'followerId', foreignField: '_id', as: 'followerId' } },
        { $unwind: '$followerId' },
        { $lookup: { from: 'Auth', localField: 'followerId.authId', foreignField: '_id', as: 'authId' } },
        { $unwind: '$authId' },
        {
          $addFields: {
            _id: '$followerId._id',
            username: '$authId.username',
            avatarColor: '$authId.avatarColor',
            uId: '$authId.uId',
            postCount: '$followerId.postsCount',
            followersCount: '$followerId.followersCount',
            followingCount: '$followerId.followingCount',
            profilePicture: '$followerId.profilePicture',
            userProfile: '$followerId'
          }
        },
        {
          $project: {
            authId: 0,
            followerId: 0,
            followeeId: 0,
            createdAt: 0,
            __v: 0
          }
        }
      ], { allowDiskUse: true, maxTimeMS: 10000 });
      return follower;
    }
  }

  public async getFolloweesIds(userId: string): Promise<string[]> {
    // Use lean() and only select the field we need for much faster query
    const followees = await FollowerModel.find({ followerId: new mongoose.Types.ObjectId(userId) })
      .select('followeeId')
      .lean()
      .maxTimeMS(5000)
      .exec();
    return followees.map((followee: any) => followee.followeeId.toString());
  }
}

export const followerService: FollowerService = new FollowerService();

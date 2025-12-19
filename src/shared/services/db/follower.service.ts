import { FollowerModel } from '@follower/models/follower.schema';
import { IFollowerData } from '@follower/interfaces/follower.interface';
import { UserModel } from '@user/models/user.schema';
import { IUserDocument } from '@user/interfaces/user.interface';
import { INotificationDocument, INotificationTemplate } from '@notification/interfaces/notification.interface';
import { NotificationModel } from '@notification/models/notification.schema';
import { socketIONotificationObject } from '@socket/notification';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { emailQueue } from '@service/queues/email.queue';
import { AuthModel } from '@auth/models/auth.schema';
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
    // Fast approach: Get follower IDs first, then fetch users in parallel
    // This avoids expensive $lookup operations
    try {
      // Step 1: Get all followee IDs (fast - just IDs)
      const followers = await FollowerModel.find({ followerId: userObjectId })
        .select('followeeId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      if (!followers || followers.length === 0) {
        return [];
      }

      const followeeIds = followers.map((f: any) => f.followeeId);

      // Step 2: Get users (with authId reference)
      const users = await UserModel.find({ _id: { $in: followeeIds } })
        .select('_id postsCount followersCount followingCount profilePicture authId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      if (!users || users.length === 0) {
        return [];
      }

      // Step 3: Get auth IDs from users and fetch auth data in parallel
      const authIds = users.map((u: any) => u.authId).filter(Boolean);
      if (authIds.length === 0) {
        return [];
      }

      const authData = await AuthModel.find({ _id: { $in: authIds } })
        .select('_id username avatarColor uId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      // Step 4: Create maps for quick lookup
      const authMap = new Map(authData.map((a: any) => [a._id.toString(), a]));
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      // Step 5: Combine data
      return followeeIds
        .map((followeeId: any) => {
          const user = userMap.get(followeeId.toString());
          if (!user) return null;

          const auth = authMap.get(user.authId?.toString() || '');
          if (!auth) return null;

          return {
            _id: user._id,
            username: auth.username || '',
            avatarColor: auth.avatarColor || '',
            uId: auth.uId || '',
            postCount: user.postsCount || 0,
            followersCount: user.followersCount || 0,
            followingCount: user.followingCount || 0,
            profilePicture: user.profilePicture || '',
            userProfile: user
          } as IFollowerData;
        })
        .filter((f): f is IFollowerData => f !== null);
    } catch (error) {
      // If parallel approach fails, return empty array to prevent 503
      return [];
    }
  }

  public async getFollowerData(userObjectId: ObjectId): Promise<IFollowerData[]> {
    // Fast approach: Get follower IDs first, then fetch users in parallel
    // This avoids expensive $lookup operations
    try {
      // Step 1: Get all follower IDs (fast - just IDs)
      const followers = await FollowerModel.find({ followeeId: userObjectId })
        .select('followerId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      if (!followers || followers.length === 0) {
        return [];
      }

      const followerIds = followers.map((f: any) => f.followerId);

      // Step 2: Get users (with authId reference)
      const users = await UserModel.find({ _id: { $in: followerIds } })
        .select('_id postsCount followersCount followingCount profilePicture authId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      if (!users || users.length === 0) {
        return [];
      }

      // Step 3: Get auth IDs from users and fetch auth data
      const authIds = users.map((u: any) => u.authId).filter(Boolean);
      if (authIds.length === 0) {
        return [];
      }

      const authData = await AuthModel.find({ _id: { $in: authIds } })
        .select('_id username avatarColor uId')
        .lean()
        .maxTimeMS(3000)
        .exec();

      // Step 4: Create maps for quick lookup
      const authMap = new Map(authData.map((a: any) => [a._id.toString(), a]));
      const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

      // Step 5: Combine data
      return followerIds
        .map((followerId: any) => {
          const user = userMap.get(followerId.toString());
          if (!user) return null;

          const auth = authMap.get(user.authId?.toString() || '');
          if (!auth) return null;

          return {
            _id: user._id,
            username: auth.username || '',
            avatarColor: auth.avatarColor || '',
            uId: auth.uId || '',
            postCount: user.postsCount || 0,
            followersCount: user.followersCount || 0,
            followingCount: user.followingCount || 0,
            profilePicture: user.profilePicture || '',
            userProfile: user
          } as IFollowerData;
        })
        .filter((f): f is IFollowerData => f !== null);
    } catch (error) {
      // If parallel approach fails, return empty array to prevent 503
      return [];
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

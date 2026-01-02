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

    // Create follower relationship and update user counts in parallel for speed
    const [followerDoc, usersResult] = await Promise.all([
      FollowerModel.create({
        _id: followerDocumentId,
        followeeId: followeeObjectId,
        followerId: followerObjectId
      }),
      UserModel.bulkWrite([
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
      ], { maxTimeMS: 5000 })
    ]);

    // Get followee user data only if needed for notifications (with timeout)
    let followeeUser: IUserDocument | null = null;
    if (userId !== followeeId) {
      try {
        followeeUser = await UserModel.findOne({ _id: followeeObjectId })
          .maxTimeMS(3000)
          .lean()
          .exec() as IUserDocument | null;
      } catch (error) {
        // If user lookup fails, continue without notification
        followeeUser = null;
      }
    }

    const response: [BulkWriteResult, IUserDocument | null] = [usersResult, followeeUser];

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

    // Delete follower relationship and update user counts in parallel for speed
    await Promise.all([
      FollowerModel.deleteOne({
        followeeId: followeeObjectId,
        followerId: followerObjectId
      }).maxTimeMS(5000).exec(),
      UserModel.bulkWrite([
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
      ], { maxTimeMS: 5000 })
    ]);
  }

  public async getFolloweeData(userObjectId: ObjectId): Promise<IFollowerData[]> {
    // Fast approach: Get follower IDs first, then fetch users in parallel
    // This avoids expensive $lookup operations
    try {
      // Step 1: Get all followee IDs (fast - just IDs)
      // Use hint to ensure index is used
      const followers = await FollowerModel.find({ followerId: userObjectId })
        .select('followeeId')
        .lean()
        .hint({ followerId: 1 }) // Force use of followerId index
        .maxTimeMS(5000)
        .exec();

      if (!followers || followers.length === 0) {
        return [];
      }

      // Remove duplicates by converting to Set (using string IDs for comparison)
      const uniqueFolloweeIds = Array.from(new Set(followers.map((f: any) => f.followeeId.toString())));
      const followeeIds = uniqueFolloweeIds.map(id => new mongoose.Types.ObjectId(id));

      // Step 2: Get users (with authId reference)
      // _id queries are automatically indexed, no hint needed
      const users = await UserModel.find({ _id: { $in: followeeIds } })
        .select('_id postsCount followersCount followingCount profilePicture authId')
        .lean()
        .maxTimeMS(5000)
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

      // Step 5: Combine data - iterate over unique followeeIds to prevent duplicates
      const followeeDataList = uniqueFolloweeIds
        .map((followeeIdStr: string) => {
          const user = userMap.get(followeeIdStr);
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

      // Additional deduplication by _id as a safety measure
      const uniqueFollowees = new Map<string, IFollowerData>();
      followeeDataList.forEach((followee: IFollowerData) => {
        const id = followee._id?.toString() || '';
        if (id && !uniqueFollowees.has(id)) {
          uniqueFollowees.set(id, followee);
        }
      });

      return Array.from(uniqueFollowees.values());
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
      // Use hint to ensure index is used
      const followers = await FollowerModel.find({ followeeId: userObjectId })
        .select('followerId')
        .lean()
        .hint({ followeeId: 1 }) // Force use of followeeId index
        .maxTimeMS(5000)
        .exec();

      if (!followers || followers.length === 0) {
        return [];
      }

      // Remove duplicates by converting to Set (using string IDs for comparison)
      const uniqueFollowerIds = Array.from(new Set(followers.map((f: any) => f.followerId.toString())));
      const followerIds = uniqueFollowerIds.map(id => new mongoose.Types.ObjectId(id));

      // Step 2: Get users (with authId reference)
      // _id queries are automatically indexed
      const users = await UserModel.find({ _id: { $in: followerIds } })
        .select('_id postsCount followersCount followingCount profilePicture authId')
        .lean()
        .maxTimeMS(5000)
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

      // Step 5: Combine data - iterate over unique followerIds to prevent duplicates
      const followerDataList = uniqueFollowerIds
        .map((followerIdStr: string) => {
          const user = userMap.get(followerIdStr);
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

      // Additional deduplication by _id as a safety measure
      const uniqueFollowers = new Map<string, IFollowerData>();
      followerDataList.forEach((follower: IFollowerData) => {
        const id = follower._id?.toString() || '';
        if (id && !uniqueFollowers.has(id)) {
          uniqueFollowers.set(id, follower);
        }
      });

      return Array.from(uniqueFollowers.values());
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

  public async getActualFollowerCounts(userId: string): Promise<{ followersCount: number; followingCount: number }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // Count distinct followers (people who follow this user) - use distinct to avoid counting duplicates
    const distinctFollowers = await FollowerModel.distinct('followerId', { followeeId: userObjectId })
      .maxTimeMS(5000)
      .exec();
    const followersCount = distinctFollowers ? distinctFollowers.length : 0;
    
    // Count distinct following (people this user follows) - use distinct to avoid counting duplicates
    const distinctFollowing = await FollowerModel.distinct('followeeId', { followerId: userObjectId })
      .maxTimeMS(5000)
      .exec();
    const followingCount = distinctFollowing ? distinctFollowing.length : 0;
    
    return { followersCount, followingCount };
  }
}

export const followerService: FollowerService = new FollowerService();

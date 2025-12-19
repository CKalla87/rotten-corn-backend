import { UserModel } from '@user/models/user.schema';
import { IUserDocument, ISearchUser, IBasicInfo, INotificationSettings, ISocialLinks } from '@user/interfaces/user.interface';
import mongoose from 'mongoose';
import { followerService } from '@service/db/follower.service';
import { AuthModel } from '@auth/models/auth.schema';

class UserService {
  public async addUserData(data: IUserDocument): Promise<void> {
    await UserModel.create(data);
  }

  public async getUserById(userId: string): Promise<IUserDocument> {
    // Use simpler query - find with populate is faster than aggregate for single document
    // Only use aggregate if we need complex transformations
    try {
      const user = await UserModel.findOne({ _id: new mongoose.Types.ObjectId(userId) })
        .populate('authId')
        .lean()
        .maxTimeMS(10000)
        .exec() as IUserDocument;

      if (!user) {
        return null as unknown as IUserDocument;
      }

      // If populate worked, merge auth data into user object
      if (user.authId && typeof user.authId === 'object') {
        const authData = user.authId as any;
        return {
          ...user,
          username: authData.username,
          email: authData.email,
          avatarColor: authData.avatarColor,
          uId: authData.uId,
          createdAt: authData.createdAt || user.createdAt
        } as IUserDocument;
      }

      return user;
    } catch (error) {
      // Fallback to aggregate if populate fails
      const users: IUserDocument[] = await UserModel.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(userId)}},
        { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId'}},
        { $unwind: '$authId'},
        { $project: this.aggregateProject()},
        { $limit: 1 }
      ], { allowDiskUse: true, maxTimeMS: 10000 });
      return users[0];
    }
  }

  public async getUserByAuthId(authId: string): Promise<IUserDocument> {
    // Optimize single user lookup
    const users: IUserDocument[] = await UserModel.aggregate([
      { $match: { authId: new mongoose.Types.ObjectId(authId)}},
      { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId'}},
      { $unwind: '$authId'},
      { $project: this.aggregateProject()},
      { $limit: 1 } // Limit to 1 since we're getting a single user
    ]);
    return users[0];
  }

  public async getAllUsers(userId: string, skip: number, limit: number): Promise<IUserDocument[]> {
    // Use find() with populate - much faster than aggregate for simple queries
    // Only use aggregate if we need complex transformations
    try {
      const users = await UserModel.find({ _id: { $ne: new mongoose.Types.ObjectId(userId) } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authId')
        .lean()
        .maxTimeMS(10000)
        .exec();

      // Transform the populated results to match expected format
      return users.map((user: any) => {
        const authData = user.authId;
        if (authData && typeof authData === 'object') {
          return {
            ...user,
            username: authData.username,
            email: authData.email,
            avatarColor: authData.avatarColor,
            uId: authData.uId,
            createdAt: authData.createdAt || user.createdAt
          } as IUserDocument;
        }
        return user as IUserDocument;
      });
    } catch (error) {
      // Fallback to aggregate if populate fails
      const users: IUserDocument[] = await UserModel.aggregate([
        { $match: { _id: { $ne: new mongoose.Types.ObjectId(userId) } } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId' } },
        { $unwind: '$authId' },
        { $project: this.aggregateProject() }
      ], { allowDiskUse: true, maxTimeMS: 10000 });
      return users;
    }
  }

  public async getRandomUsers(userId: string): Promise<IUserDocument[]> {
    // Fast approach: Get random users without expensive $lookup
    try {
      // Step 1: Get random users (without auth data first - faster)
      // Note: $ne queries can be slow on large collections, but we limit to 50
      const users = await UserModel.find({ _id: { $ne: new mongoose.Types.ObjectId(userId) } })
        .select('_id authId postsCount followersCount followingCount profilePicture')
        .limit(50) // Get more than needed, filter later
        .lean()
        .maxTimeMS(5000)
        .exec();

      if (!users || users.length === 0) {
        return [];
      }

      // Step 2: Shuffle and take 10 random users
      const shuffled = users.sort(() => 0.5 - Math.random());
      const selectedUsers = shuffled.slice(0, 10);

      // Step 3: Get followers list and auth data in parallel
      const [followers, authData] = await Promise.all([
        followerService.getFolloweesIds(`${userId}`),
        AuthModel.find({
          _id: { $in: selectedUsers.map((u: any) => u.authId).filter(Boolean) }
        })
          .select('_id username email avatarColor uId createdAt')
          .lean()
          .maxTimeMS(5000)
          .exec()
      ]);

      // Step 4: Create auth map and filter out followed users
      const authMap = new Map(authData.map((a: any) => [a._id.toString(), a]));
      const followersSet = new Set(followers);

      // Step 5: Combine data and filter
      const randomUsers: IUserDocument[] = [];
      for (const user of selectedUsers) {
        // Skip if user is already followed
        if (followersSet.has(user._id.toString())) {
          continue;
        }

        const auth = authMap.get(user.authId?.toString() || '');
        if (!auth) continue;

        randomUsers.push({
          ...user,
          username: auth.username,
          email: auth.email,
          avatarColor: auth.avatarColor,
          uId: auth.uId,
          createdAt: auth.createdAt
        } as IUserDocument);

        // Stop when we have 10
        if (randomUsers.length >= 10) break;
      }

      return randomUsers;
    } catch (error) {
      // If query fails, return empty array to prevent 503
      return [];
    }
  }

  public async getTotalUsersInDB(): Promise<number> {
    // Use estimatedDocumentCount for much faster count (uses collection metadata)
    // This is approximate but much faster than countDocuments()
    try {
      const totalCount: number = await UserModel.estimatedDocumentCount();
      return totalCount;
    } catch (error) {
      // Fallback to countDocuments if estimatedDocumentCount fails
      const totalCount: number = await UserModel.find({}).countDocuments();
      return totalCount;
    }
  }

  public async searchUsers(regex: RegExp, excludedUserId?: string): Promise<ISearchUser[]> {
    const matchStage = { username: regex };
    const pipeline: mongoose.PipelineStage[] = [{ $match: matchStage }];

    if (excludedUserId) {
      pipeline.push({ $lookup: { from: 'User', localField: '_id', foreignField: 'authId', as: 'user' } });
      pipeline.push({ $unwind: { path: '$user', preserveNullAndEmptyArrays: false } });
      pipeline.push({ $match: { 'user._id': { $ne: new mongoose.Types.ObjectId(excludedUserId) } } });
    } else {
      pipeline.push({ $lookup: { from: 'User', localField: '_id', foreignField: 'authId', as: 'user' } });
      pipeline.push({ $unwind: { path: '$user', preserveNullAndEmptyArrays: false } });
    }

    pipeline.push({
      $project: {
        _id: '$user._id',
        username: 1,
        email: 1,
        avatarColor: 1,
        profilePicture: '$user.profilePicture'
      }
    });

    // Optimize with allowDiskUse for performance
    const users = await AuthModel.aggregate(pipeline).allowDiskUse(true);
    return users;
  }

  public async updatePassword(username: string, hashedPassword: string): Promise<void> {
    await AuthModel.updateOne({ username }, { $set: { password: hashedPassword } }).exec();
  }

  public async updateUserInfo(userId: string, info: IBasicInfo): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          work: info['work'],
          school: info['school'],
          quote: info['quote'],
          location: info['location']
        }
      }
    )
      .maxTimeMS(5000)
      .exec();
  }

  public async updateSocialLinks(userId: string, links: ISocialLinks): Promise<void> {
    // Ensure userId is converted to ObjectId
    const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    await UserModel.updateOne(
      { _id: userIdObj },
      {
        $set: { social: links }
      }
    )
      .maxTimeMS(5000)
      .exec();
  }

  public async updateNotificationSettings(userId: string, settings: INotificationSettings): Promise<void> {
    // Ensure userId is converted to ObjectId
    const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    await UserModel.updateOne(
      { _id: userIdObj },
      {
        $set: { notifications: settings }
      }
    )
      .maxTimeMS(5000)
      .exec();
  }

  private aggregateProject() {
    return {
      _id: 1,
      username: '$authId.username',
      uId: '$authId.uId',
      email: '$authId.email',
      avatarColor: '$authId.avatarColor',
      createdAt: '$authId.createdAt',
      postsCount: 1,
      work: 1,
      school: 1,
      quote: 1,
      location: 1,
      blocked: 1,
      blockedBy: 1,
      followersCount: 1,
      followingCount: 1,
      notifications: 1,
      social: 1,
      bgImageVersion: 1,
      bgImageId: 1,
      profilePicture: 1
    };
  }
}

export const userService: UserService = new UserService();

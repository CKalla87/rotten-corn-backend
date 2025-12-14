import { UserModel } from '@user/models/user.schema';
import { IUserDocument, ISearchUser, IBasicInfo, INotificationSettings, ISocialLinks } from '@user/interfaces/user.interface';
import mongoose from 'mongoose';
import { followerService } from '@service/db/follower.service';
import { AuthModel } from '@auth/models/auth.schema';
import { Helpers } from '@global/helpers/helpers';

class UserService {
  public async addUserData(data: IUserDocument): Promise<void> {
    await UserModel.create(data);
  }

  public async getUserById(userId: string): Promise<IUserDocument> {
    const users: IUserDocument[] = await UserModel.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(userId) } },
      { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId' } },
      { $unwind: '$authId' },
      { $project: this.aggregateProject() },
      { $limit: 1 } // Ensure we only get one result
    ]).allowDiskUse(true); // Allow disk use for better performance with large datasets
    const user = users[0];
    if (user) {
      // Normalize profile picture - replace broken URLs with initials avatar
      user.profilePicture = Helpers.normalizeProfilePicture(user.profilePicture, user.username, user.avatarColor);
    }
    return user;
  }

  public async getUserByAuthId(authId: string): Promise<IUserDocument> {
    const users: IUserDocument[] = await UserModel.aggregate([
      { $match: { authId: new mongoose.Types.ObjectId(authId) } },
      { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId' } },
      { $unwind: '$authId' },
      { $project: this.aggregateProject() },
      { $limit: 1 } // Ensure we only get one result
    ]).allowDiskUse(true); // Allow disk use for better performance
    const user = users[0];
    if (user) {
      // Normalize profile picture - replace broken URLs with initials avatar
      user.profilePicture = Helpers.normalizeProfilePicture(user.profilePicture, user.username, user.avatarColor);
    }
    return user;
  }

  public async getAllUsers(userId: string, skip: number, limit: number): Promise<IUserDocument[]> {
    // Ensure limit is reasonable (max 100)
    const safeLimit = Math.min(limit, 100);
    const users: IUserDocument[] = await UserModel.aggregate([
      { $match: { _id: { $ne: new mongoose.Types.ObjectId(userId) } } },
      { $skip: skip },
      { $limit: safeLimit },
      { $sort: { createdAt: -1 } },
      { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId' } },
      { $unwind: '$authId' },
      { $project: this.aggregateProject() }
    ]).allowDiskUse(true); // Allow disk use for better performance
    // Normalize profile pictures for all users
    return users.map((user) => {
      user.profilePicture = Helpers.normalizeProfilePicture(user.profilePicture, user.username, user.avatarColor);
      return user;
    });
  }

  public async getRandomUsers(userId: string): Promise<IUserDocument[]> {
    const randomUsers: IUserDocument[] = [];
    const users: IUserDocument[] = await UserModel.aggregate([
      { $match: { _id: { $ne: new mongoose.Types.ObjectId(userId) } } },
      { $lookup: { from: 'Auth', localField: 'authId', foreignField: '_id', as: 'authId' } },
      { $unwind: '$authId' },
      { $sample: { size: 10 } },
      {
        $addFields: {
          username: '$authId.username',
          email: '$authId.email',
          avatarColor: '$authId.avatarColor',
          uId: '$authId.uId',
          createdAt: '$authId.createdAt'
        }
      },
      {
        $project: {
          authId: 0,
          __v: 0
        }
      }
    ]).allowDiskUse(true); // Allow disk use for better performance with $sample
    const followers: string[] = await followerService.getFolloweesIds(`${userId}`);
    for (const user of users) {
      const followerIndex = followers.indexOf(user._id.toString());
      if (followerIndex < 0) {
        // Normalize profile picture - replace broken URLs with initials avatar
        user.profilePicture = Helpers.normalizeProfilePicture(user.profilePicture, user.username, user.avatarColor);
        randomUsers.push(user);
      }
    }
    return randomUsers;
  }

  public async getTotalUsersInDB(): Promise<number> {
    const totalCount: number = await UserModel.find({}).countDocuments();
    return totalCount;
  }

  public async searchUsers(regex: RegExp): Promise<ISearchUser[]> {
    const users = await AuthModel.aggregate([
      { $match: { username: regex } },
      { $lookup: { from: 'User', localField: '_id', foreignField: 'authId', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: '$user._id',
          username: 1,
          email: 1,
          avatarColor: 1,
          profilePicture: '$user.profilePicture'
        }
      }
    ]);
    // Normalize profile pictures for search results
    return users.map((user) => ({
      ...user,
      profilePicture: Helpers.normalizeProfilePicture(user.profilePicture, user.username, user.avatarColor)
    }));
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
    ).exec();
  }

  public async updateSocialLinks(userId: string, links: ISocialLinks): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: { social: links }
      }
    ).exec();
  }

  public async updateNotificationSettings(userId: string, settings: INotificationSettings): Promise<void> {
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: { notifications: settings }
      }
    ).exec();
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

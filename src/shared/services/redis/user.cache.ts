import { BaseCache } from '@service/redis/base.cache';
import { IUserDocument } from '@user/interfaces/user.interface';
import { config } from '@root/config';
import Logger from 'bunyan';
import { ServerError } from '@global/helpers/error-handler';
import { Helpers } from '@global/helpers/helpers';
import { RedisCommandRawReply } from '@redis/client/dist/lib/commands';

type UserItem = string | number | boolean | string[] | Record<string, unknown>;
type UserCacheMultiType = string | number | Buffer | RedisCommandRawReply[] | IUserDocument | IUserDocument[];

const log: Logger = config.createLogger('userCache');

export class UserCache extends BaseCache {
  constructor() {
    super('userCache');
  }

  public async saveUserToCache(key: string, userUId: string, createdUser: IUserDocument): Promise<void> {
    const createdAt = new Date();
    const {
      _id,
      uId,
      username,
      email,
      avatarColor,
      blocked,
      blockedBy,
      postsCount,
      profilePicture,
      followersCount,
      followingCount,
      notifications,
      work,
      location,
      school,
      quote,
      bgImageId,
      bgImageVersion,
      profileImageId,
      profileImageVersion,
      social
    } = createdUser;
    const firstList = {
      _id: `${_id}`,
      uId: `${uId}`,
      username: `${username}`,
      email: `${email}`,
      avatarColor: `${avatarColor}`,
      createdAt: `${createdAt}`,
      postsCount: `${postsCount}`
    };
    const secondList = {
      blocked: JSON.stringify(blocked),
      blockedBy: JSON.stringify(blockedBy),
      profilePicture: JSON.stringify(profilePicture),
      followersCount: JSON.stringify(followersCount),
      followingCount: JSON.stringify(followingCount),
      notifications: JSON.stringify(notifications),
      social: JSON.stringify(social)
    };
    const thirdList = {
      work: `${work}`,
      location: `${location}`,
      school: `${school}`,
      quote: `${quote}`,
      bgImageVersion: `${bgImageVersion}`,
      bgImageId: `${bgImageId}`,
      profileImageVersion: `${profileImageVersion || ''}`,
      profileImageId: `${profileImageId || ''}`
    };
    const dataToSave = { ...firstList, ...secondList, ...thirdList };

    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      await this.client.ZADD('user', { score: parseInt(userUId, 10), value: `${key}` });
      for (const [itemKey, value] of Object.entries(dataToSave)) {
        await this.client.HSET(`users:${key}`, `${itemKey}`, `${value}`);
      }
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error.Try again..!');
    }
  }

  public async getUserFromCache(userId: string): Promise<IUserDocument | null> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const response: IUserDocument = (await this.client.HGETALL(`users:${userId}`)) as unknown as IUserDocument;
      response.createdAt = new Date(Helpers.parseJson(`${response.createdAt}`));
      response.postsCount = Helpers.parseJson(`${response.postsCount}`);
      // Ensure blocked and blockedBy are always arrays
      const parsedBlocked = Helpers.parseJson(`${response.blocked}`);
      response.blocked = Array.isArray(parsedBlocked) ? parsedBlocked : [];
      const parsedBlockedBy = Helpers.parseJson(`${response.blockedBy}`);
      response.blockedBy = Array.isArray(parsedBlockedBy) ? parsedBlockedBy : [];
      response.notifications = Helpers.parseJson(`${response.notifications}`);
      response.social = Helpers.parseJson(`${response.social}`);
      response.followersCount = Helpers.parseJson(`${response.followersCount}`);
      response.followingCount = Helpers.parseJson(`${response.followingCount}`);
      response.bgImageId = Helpers.parseJson(`${response.bgImageId}`);
      response.bgImageVersion = Helpers.parseJson(`${response.bgImageVersion}`);
      response.profilePicture = Helpers.parseJson(`${response.profilePicture}`);
      response.profileImageId = Helpers.parseJson(`${response.profileImageId || ''}`);
      response.profileImageVersion = Helpers.parseJson(`${response.profileImageVersion || ''}`);

      // Normalize profile picture - replace broken URLs with initials avatar
      response.profilePicture = Helpers.normalizeProfilePicture(response.profilePicture, response.username, response.avatarColor);

      return response;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updateSingleUserItemInCache(userId: string, prop: string, value: UserItem): Promise<IUserDocument | null> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const dataToSave: string[] = [`${prop}`, JSON.stringify(value)];
      await this.client.HSET(`users:${userId}`, dataToSave);
      const response: IUserDocument = (await this.getUserFromCache(userId)) as IUserDocument;
      return response;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getUsersFromCache(start: number, end: number, excludedUserKey: string): Promise<IUserDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const response: string[] = await this.client.ZRANGE('user', start, end, { REV: true });
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      for (const key of response) {
        if (key !== excludedUserKey) {
          multi.HGETALL(`users:${key}`);
        }
      }
      const replies: UserCacheMultiType = (await multi.exec()) as UserCacheMultiType;
      const userReplies: IUserDocument[] = [];
      for (const reply of replies as IUserDocument[]) {
        reply.createdAt = new Date(Helpers.parseJson(`${reply.createdAt}`));
        reply.postsCount = Helpers.parseJson(`${reply.postsCount}`);
        // Ensure blocked and blockedBy are always arrays
        const parsedBlocked = Helpers.parseJson(`${reply.blocked}`);
        reply.blocked = Array.isArray(parsedBlocked) ? parsedBlocked : [];
        const parsedBlockedBy = Helpers.parseJson(`${reply.blockedBy}`);
        reply.blockedBy = Array.isArray(parsedBlockedBy) ? parsedBlockedBy : [];
        reply.notifications = Helpers.parseJson(`${reply.notifications}`);
        reply.social = Helpers.parseJson(`${reply.social}`);
        reply.followersCount = Helpers.parseJson(`${reply.followersCount}`);
        reply.followingCount = Helpers.parseJson(`${reply.followingCount}`);
        reply.bgImageId = Helpers.parseJson(`${reply.bgImageId}`);
        reply.bgImageVersion = Helpers.parseJson(`${reply.bgImageVersion}`);
        reply.profilePicture = Helpers.parseJson(`${reply.profilePicture}`);
        reply.profileImageId = Helpers.parseJson(`${reply.profileImageId || ''}`);
        reply.profileImageVersion = Helpers.parseJson(`${reply.profileImageVersion || ''}`);

        // Normalize profile picture - replace broken URLs with initials avatar
        reply.profilePicture = Helpers.normalizeProfilePicture(reply.profilePicture, reply.username, reply.avatarColor);

        userReplies.push(reply);
      }
      return userReplies;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getTotalUsersInCache(): Promise<number> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const count: number = await this.client.ZCARD('user');
      return count;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getRandomUsersFromCache(userId: string, excludedUsername: string): Promise<IUserDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const replies: IUserDocument[] = [];
      const followers: string[] = await this.client.LRANGE(`followers:${userId}`, 0, -1);
      const users: string[] = await this.client.ZRANGE('user', 0, -1);
      const randomUsers: string[] = Helpers.shuffle(users).slice(0, 10);
      for (const key of randomUsers) {
        const followerIndex = followers.indexOf(key);
        if (followerIndex < 0) {
          const userHash: IUserDocument = (await this.client.HGETALL(`users:${key}`)) as unknown as IUserDocument;
          replies.push(userHash);
        }
      }
      const excludedUsernameIndex: number = replies.findIndex((user) => user.username === excludedUsername);
      if (excludedUsernameIndex >= 0) {
        replies.splice(excludedUsernameIndex, 1);
      }
      for (const reply of replies) {
        reply.createdAt = new Date(Helpers.parseJson(`${reply.createdAt}`));
        reply.postsCount = Helpers.parseJson(`${reply.postsCount}`);
        // Ensure blocked and blockedBy are always arrays
        const parsedBlocked = Helpers.parseJson(`${reply.blocked}`);
        reply.blocked = Array.isArray(parsedBlocked) ? parsedBlocked : [];
        const parsedBlockedBy = Helpers.parseJson(`${reply.blockedBy}`);
        reply.blockedBy = Array.isArray(parsedBlockedBy) ? parsedBlockedBy : [];
        reply.notifications = Helpers.parseJson(`${reply.notifications}`);
        reply.social = Helpers.parseJson(`${reply.social}`);
        reply.followersCount = Helpers.parseJson(`${reply.followersCount}`);
        reply.followingCount = Helpers.parseJson(`${reply.followingCount}`);
        reply.bgImageId = Helpers.parseJson(`${reply.bgImageId}`);
        reply.bgImageVersion = Helpers.parseJson(`${reply.bgImageVersion}`);
        reply.profilePicture = Helpers.parseJson(`${reply.profilePicture}`);

        // Normalize profile picture - replace broken URLs with initials avatar
        reply.profilePicture = Helpers.normalizeProfilePicture(reply.profilePicture, reply.username, reply.avatarColor);
      }
      return replies;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }
}

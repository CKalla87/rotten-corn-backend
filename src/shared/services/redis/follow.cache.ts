import { BaseCache } from './base.cache';
import Logger from 'bunyan';
import { config } from '@root/config';
import { ServerError } from '@global/helpers/error-handler';
import mongoose from 'mongoose';
import { IFollowerData } from '@root/features/followers/interfaces/follower.interface';
import { IUserDocument } from '@root/features/user/interfaces/user.interface';
import { UserCache } from './user.cache';
import { Helpers } from '@global/helpers/helpers';
import { remove } from 'lodash';

const log: Logger = config.createLogger('followCache');
const userCache: UserCache = new UserCache();

export class FollowerCache extends BaseCache {
  constructor() {
    super('followCache');
  }

  public async saveFollowerToCache(key: string, value: string): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      await this.client.LPUSH(key, value);
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async removeFollowerFromCache(key: string, value: string): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      await this.client.LREM(key, 1, value);
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updateFollowersCountInCache(userId: string, prop: string, value: number): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      await this.client.HINCRBY(`users:${userId}`, prop, value);
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updateBlockedUserPropInCache(key: string, prop: string, value: string, type: 'block' | 'unblock'): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const response: string = (await this.client.HGET(`users:${key}`, prop)) as string;
      let blocked: string[] = (Helpers.parseJson(response) as string[]) || [];

      if (type === 'block') {
        blocked = [...blocked, value];
      } else {
        remove(blocked, (id: string) => id === value);
        blocked = [...blocked];
      }

      await this.client.HSET(`users:${key}`, prop, JSON.stringify(blocked));
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getFollowersFromCache(key: string): Promise<IFollowerData[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const response: string[] = await this.client.LRANGE(key, 0, -1);
      if (!response || response.length === 0) {
        return [];
      }

      const list: IFollowerData[] = [];
      // Batch user cache lookups to avoid sequential blocking
      const userPromises = response.map(item => userCache.getUserFromCache(item));
      const users = await Promise.all(userPromises);

      for (const user of users) {
        if (user) {
          const data: IFollowerData = {
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
          list.push(data);
        }
      }

      return list;
    } catch (error) {
      log.error(error);
      // Return empty array instead of throwing to allow fast fallback to database
      return [];
    }
  }
}

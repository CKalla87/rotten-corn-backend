import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { IUserDocument, IAllUsers, IUserAll } from '@user/interfaces/user.interface';
import { UserCache } from '@service/redis/user.cache';
import { userService } from '@service/db/user.service';
import { FollowerCache } from '@service/redis/follow.cache';
import { followerService } from '@service/db/follower.service';
import { IFollowerData } from '@follower/interfaces/follower.interface';
import mongoose from 'mongoose';
import { Helpers } from '@global/helpers/helpers';
import { PostCache } from '@service/redis/post.cache';
import { IPostDocument } from '@post/interfaces/post.interface';
import { postService } from '@service/db/post.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const PAGE_SIZE = 12;

const userCache: UserCache = new UserCache();
const followerCache: FollowerCache = new FollowerCache();
const postCache: PostCache = new PostCache();
const log: Logger = config.createLogger('getProfile');

export class Get {
  public async all(req: Request, res: Response): Promise<void> {
    const { page } = req.params;
    const skip: number = (parseInt(page, 10) - 1) * PAGE_SIZE;
    const limit: number = PAGE_SIZE * parseInt(page, 10);
    const newSkip: number = skip ? skip + 1 : skip;
    const allUsers: IAllUsers = await Get.prototype.allUsers({
      newSkip,
      limit,
      skip,
      userId: `${req.currentUser!.userId}`
    });
    const followers: IFollowerData[] = await Get.prototype.followers(`${req.currentUser!.userId}`);
    res
      .status(HTTP_STATUS.OK)
      .json({ message: 'Get users', users: allUsers.users, totalUsers: allUsers.totalUsers, followers });
  }

  public async profile(req: Request, res: Response): Promise<void> {
    const cachedUser: IUserDocument = (await userCache.getUserFromCache(`${req.currentUser!.userId}`)) as IUserDocument;
    const existingUser: IUserDocument = cachedUser
      ? cachedUser
      : await userService.getUserById(`${req.currentUser!.userId}`);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile', user: existingUser });
  }

  public async profileByUserId(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    const cachedUser: IUserDocument = (await userCache.getUserFromCache(userId)) as IUserDocument;
    const existingUser: IUserDocument = cachedUser ? cachedUser : await userService.getUserById(userId);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile by id', user: existingUser });
  }

  public async profileAndPosts(req: Request, res: Response): Promise<void> {
    const { userId, username, uId } = req.params;
    const userName: string = Helpers.firstLetterUppercase(username);

    log.info(`Fetching profile and posts: userId=${userId}, username=${username}, uId=${uId}`);

    let existingUser: IUserDocument;
    let userPosts: IPostDocument[] = [];

    // Get user from cache or database
    try {
      const cachedUser: IUserDocument | null = await userCache.getUserFromCache(userId);
      existingUser = cachedUser || await userService.getUserById(userId);
      log.info(`User found: ${existingUser ? 'yes' : 'no'}`);
    } catch (error) {
      log.error('Failed to get user, falling back to database', error);
      existingUser = await userService.getUserById(userId);
    }

    // Get user posts from cache or database
    try {
      const cachedUserPosts: IPostDocument[] = await postCache.getUserPostsFromCache(
        'post',
        parseInt(uId, 10)
      );
      log.info(`Cache returned ${cachedUserPosts.length} posts for user`);

      if (cachedUserPosts.length > 0) {
        userPosts = cachedUserPosts;
      } else {
        // Cache is empty or failed - get from database
        log.info('Cache is empty, fetching user posts from database');
        userPosts = await postService.getPosts({ username: userName }, 0, 100, { createdAt: -1 });
        log.info(`Database returned ${userPosts.length} posts for user`);
      }
    } catch (error) {
      // If cache completely fails, get from database
      log.error('Failed to get user posts from cache, falling back to database', error);
      userPosts = await postService.getPosts({ username: userName }, 0, 100, { createdAt: -1 });
      log.info(`Database returned ${userPosts.length} posts after cache failure`);
    }

    log.info(`Returning ${userPosts.length} posts to client for user ${username}`);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile and posts', user: existingUser, posts: userPosts });
  }

  private async allUsers({ newSkip, limit, skip, userId }: IUserAll): Promise<IAllUsers> {
    let users: IUserDocument[] = [];
    let type = '';
    const cachedUsers: IUserDocument[] = (await userCache.getUsersFromCache(newSkip, limit, userId)) as IUserDocument[];
    if (cachedUsers.length) {
      type = 'redis';
      users = cachedUsers;
    } else {
      type = 'mongodb';
      users = await userService.getAllUsers(userId, skip, limit);
    }
    const totalUsers: number = await Get.prototype.usersCount(type);
    return { users, totalUsers };
  }

  private async usersCount(type: string): Promise<number> {
    const totalUsers: number =
      type === 'redis' ? await userCache.getTotalUsersInCache() : await userService.getTotalUsersInDB();
    return totalUsers;
  }

  public async randomUserSuggestions(req: Request, res: Response): Promise<void> {
    let randomUsers: IUserDocument[] = [];
    const cachedUsers: IUserDocument[] = await userCache.getRandomUsersFromCache(`${req.currentUser!.userId}`, `${req.currentUser!.username}`);
    if (cachedUsers.length) {
      randomUsers = [...cachedUsers];
    } else {
      const users: IUserDocument[] = await userService.getRandomUsers(`${req.currentUser!.userId}`);
      randomUsers = [...users];
    }
    res.status(HTTP_STATUS.OK).json({ message: 'User suggestions', users: randomUsers });
  }

  private async followers(userId: string): Promise<IFollowerData[]> {
    const cachedFollowers: IFollowerData[] = await followerCache.getFollowersFromCache(`followers:${userId}`);
    const result: IFollowerData[] = cachedFollowers.length
      ? cachedFollowers
      : await followerService.getFolloweeData(new mongoose.Types.ObjectId(userId));
    return result;
  }
}

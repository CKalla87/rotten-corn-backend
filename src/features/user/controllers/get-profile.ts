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
const log: Logger = config.createLogger('getProfile');

const userCache: UserCache = new UserCache();
const followerCache: FollowerCache = new FollowerCache();
const postCache: PostCache = new PostCache();

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
    res.status(HTTP_STATUS.OK).json({ message: 'Get users', users: allUsers.users, totalUsers: allUsers.totalUsers, followers });
  }

  public async profile(req: Request, res: Response): Promise<void> {
    // Try cache with fast timeout, skip if slow
    let existingUser: IUserDocument;
    try {
      const cachePromise = userCache.getUserFromCache(`${req.currentUser!.userId}`);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis timeout')), 500);
      });
      const cachedUser = await Promise.race([cachePromise, timeoutPromise]) as IUserDocument | null;
      if (cachedUser && cachedUser._id) {
        existingUser = cachedUser;
      } else {
        throw new Error('Cache miss');
      }
    } catch {
      // Skip cache, go directly to database
      existingUser = await userService.getUserById(`${req.currentUser!.userId}`);
    }
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile', user: existingUser });
  }

  public async profileByUserId(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    const cachedUser: IUserDocument = (await userCache.getUserFromCache(userId)) as IUserDocument;
    const existingUser: IUserDocument = cachedUser ? cachedUser : await userService.getUserById(userId);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile by id', user: existingUser });
  }

  public async profileAndPosts(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const { userId, username, uId } = req.params;
      const userName: string = Helpers.firstLetterUppercase(username);
      let existingUser: IUserDocument;
      let userPosts: IPostDocument[] = [];

      // Skip cache - go directly to database for instant response
      existingUser = await userService.getUserById(userId);

      // Skip cache - go directly to database for instant response
      try {
        userPosts = await postService.getPosts({ username: userName }, 0, 100, { createdAt: -1 });
        log.info('User posts retrieved from database', { userId, username, count: userPosts.length });
      } catch (dbError) {
        log.error('Database operation failed for user posts', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId,
          username
        });
        // Return empty array rather than failing completely
        userPosts = [];
      }

      res.status(HTTP_STATUS.OK).json({ message: 'Get user profile and posts', user: existingUser, posts: userPosts });
    } catch (error) {
      log.error('Unexpected error in profileAndPosts endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.params.userId,
        username: req.params.username
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching user profile and posts',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
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
    const totalUsers: number = type === 'redis' ? await userCache.getTotalUsersInCache() : await userService.getTotalUsersInDB();
    return totalUsers;
  }

  public async randomUserSuggestions(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      let randomUsers: IUserDocument[] = [];

      // Skip cache - go directly to database for instant response
      try {
        const users: IUserDocument[] = await userService.getRandomUsers(`${req.currentUser!.userId}`);
        randomUsers = [...users];
        log.info('User suggestions retrieved from database', { userId: req.currentUser!.userId, count: randomUsers.length });
      } catch (dbError) {
        log.error('Database operation failed for user suggestions', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId: req.currentUser!.userId
        });
        // Return empty array rather than failing completely
        randomUsers = [];
      }

      res.status(HTTP_STATUS.OK).json({ message: 'User suggestions', users: randomUsers });
    } catch (error) {
      log.error('Unexpected error in randomUserSuggestions endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.currentUser?.userId
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching user suggestions',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }

  private async followers(userId: string): Promise<IFollowerData[]> {
    const cachedFollowers: IFollowerData[] = await followerCache.getFollowersFromCache(`followers:${userId}`);
    const result: IFollowerData[] = cachedFollowers.length
      ? cachedFollowers
      : await followerService.getFolloweeData(new mongoose.Types.ObjectId(userId));
    return result;
  }
}

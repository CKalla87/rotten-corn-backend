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
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const { page } = req.params;
      const skip: number = (parseInt(page, 10) - 1) * PAGE_SIZE;
      const limit: number = PAGE_SIZE * parseInt(page, 10);
      const newSkip: number = skip ? skip + 1 : skip;

      // Run queries in parallel for maximum speed
      const [allUsers, followers] = await Promise.all([
        Get.prototype.allUsers({
          newSkip,
          limit,
          skip,
          userId: `${req.currentUser!.userId}`
        }),
        Get.prototype.followers(`${req.currentUser!.userId}`)
      ]);

      res.status(HTTP_STATUS.OK).json({ message: 'Get users', users: allUsers.users, totalUsers: allUsers.totalUsers, followers });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('maxTimeMS');

      log.error('Unexpected error in all users endpoint', {
        error: errorMessage,
        isTimeout,
        errorType: isTimeout ? 'Query timeout' : 'Database error',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Return empty results on timeout/error rather than failing completely
      // This allows the frontend to still render (just with no data) instead of showing an error
      res.status(HTTP_STATUS.OK).json({
        message: 'Get users',
        users: [],
        totalUsers: 0,
        followers: []
      });
    }
  }

  public async profile(req: Request, res: Response): Promise<void> {
    // Skip cache - go directly to database for instant response
    const existingUser: IUserDocument = await userService.getUserById(`${req.currentUser!.userId}`);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile', user: existingUser });
  }

  public async profileByUserId(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    // Skip cache - go directly to database for instant response
    const existingUser: IUserDocument = await userService.getUserById(userId);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile by id', user: existingUser });
  }

  public async profileAndPosts(req: Request, res: Response): Promise<void> {
    const { userId, username, uId } = req.params;
    const userName: string = Helpers.firstLetterUppercase(username);

    log.info(`Fetching profile and posts: userId=${userId}, username=${username}, uId=${uId}`);

    let existingUser: IUserDocument;
    let userPosts: IPostDocument[] = [];

    // Skip cache - go directly to database for instant response
    try {
      existingUser = await userService.getUserById(userId);
      log.info(`User found: ${existingUser ? 'yes' : 'no'}`);
    } catch (error) {
      log.error('Failed to get user from database', error);
      throw error;
    }

    // Get user posts from cache or database
    try {
      // Skip cache - go directly to database for instant response
      userPosts = await postService.getPosts({ username: userName }, 0, 100, { createdAt: -1 });
      log.info(`Database returned ${userPosts.length} posts for user`);
    } catch (error) {
      log.error('Failed to get user posts from database', error);
      userPosts = [];
    }

    log.info(`Returning ${userPosts.length} posts to client for user ${username}`);
    res.status(HTTP_STATUS.OK).json({ message: 'Get user profile and posts', user: existingUser, posts: userPosts });
  }

  private async allUsers({ newSkip, limit, skip, userId }: IUserAll): Promise<IAllUsers> {
    // Skip cache - go directly to database for instant response
    // Cache can be slow, database is faster and more reliable
    let users: IUserDocument[] = [];
    try {
      users = await userService.getAllUsers(userId, skip, limit);
    } catch (dbError) {
      // Return empty array rather than failing completely
      users = [];
    }
    const totalUsers: number = await userService.getTotalUsersInDB();
    return { users, totalUsers };
  }

  private async usersCount(type: string): Promise<number> {
    // Always use database count
    return await userService.getTotalUsersInDB();
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

      // Skip cache - go directly to database
      const users: IUserDocument[] = await userService.getRandomUsers(`${req.currentUser!.userId}`);
      randomUsers = [...users];
      log.info('User suggestions retrieved from database', { userId: req.currentUser!.userId, count: randomUsers.length });

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
    // Skip cache - go directly to database for instant response
    try {
      return await followerService.getFolloweeData(new mongoose.Types.ObjectId(userId));
    } catch (dbError) {
      // Return empty array rather than failing completely
      return [];
    }
  }
}

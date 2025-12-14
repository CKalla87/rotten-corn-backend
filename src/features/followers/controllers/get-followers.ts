import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { Request, Response } from 'express';
import { FollowerCache } from '@service/redis/follow.cache';
import { IFollowerData } from '../interfaces/follower.interface';
import { followerService } from '@service/db/follower.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const followerCache: FollowerCache = new FollowerCache();
const log: Logger = config.createLogger('getFollowers');

export class Get {
  public async userFollowing(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const userObjectId: ObjectId = new mongoose.Types.ObjectId(req.currentUser!.userId);
      let following: IFollowerData[] = [];

      // Skip cache - go directly to database for instant response
      try {
        following = await followerService.getFolloweeData(userObjectId);
        log.info('User following retrieved from database', { userId: req.currentUser!.userId, count: following.length });
      } catch (dbError) {
        log.error('Database operation failed for user following', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId: req.currentUser!.userId
        });
        // Return empty array rather than failing completely
        following = [];
      }

      res.status(HTTP_STATUS.OK).json({ message: 'User following', following });
    } catch (error) {
      log.error('Unexpected error in userFollowing endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.currentUser?.userId
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching user following',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }

  public async userFollowers(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const userObjectId: ObjectId = new mongoose.Types.ObjectId(req.params.userId);
      let followers: IFollowerData[] = [];

      // Skip cache - go directly to database for instant response
      try {
        followers = await followerService.getFollowerData(userObjectId);
        log.info('User followers retrieved from database', { userId: req.params.userId, count: followers.length });
      } catch (dbError) {
        log.error('Database operation failed for user followers', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId: req.params.userId
        });
        // Return empty array rather than failing completely
        followers = [];
      }

      res.status(HTTP_STATUS.OK).json({ message: 'User followers', followers });
    } catch (error) {
      log.error('Unexpected error in userFollowers endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.params.userId
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching user followers',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }
}

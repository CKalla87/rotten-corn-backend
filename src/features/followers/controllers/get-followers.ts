import HTTP_STATUS from 'http-status-codes';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { Request, Response } from 'express';
import { FollowerCache } from '@service/redis/follow.cache';
import { IFollowerData } from '../interfaces/follower.interface';
import { followerService } from '@service/db/follower.service';

const followerCache: FollowerCache = new FollowerCache();

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

      // Skip cache - go directly to database
      following = await followerService.getFolloweeData(userObjectId);

      res.status(HTTP_STATUS.OK).json({ message: 'User following', following });
    } catch (error) {
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

      // Skip cache - go directly to database
      followers = await followerService.getFollowerData(userObjectId);

      res.status(HTTP_STATUS.OK).json({ message: 'User followers', followers });
    } catch (error) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching user followers',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }
}

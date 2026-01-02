import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { IUserDocument } from '@user/interfaces/user.interface';
import { userService } from '@service/db/user.service';
import { followerService } from '@service/db/follower.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('currentUser');

export class CurrentUser {
  public async read(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get ? req.get('origin') : undefined;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      let isUser = false;
      let token = null;
      let user = null;

      if (!req.currentUser?.userId) {
        log.warn('CurrentUser endpoint called without userId', {
          hasCurrentUser: !!req.currentUser,
          origin: req.get ? req.get('origin') : undefined
        });
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          message: 'User not authenticated',
          status: 'error',
          statusCode: HTTP_STATUS.UNAUTHORIZED
        });
        return;
      }

      // Skip cache - go directly to database for instant response
      // This prevents Redis timeout issues that cause the endpoint to hang
      let existingUser: IUserDocument;
      try {
        existingUser = await userService.getUserById(`${req.currentUser?.userId}`);
        if (!existingUser || !existingUser._id) {
          log.warn('User not found in database', { userId: req.currentUser?.userId });
          res.status(HTTP_STATUS.NOT_FOUND).json({
            message: 'User not found',
            status: 'error',
            statusCode: HTTP_STATUS.NOT_FOUND
          });
          return;
        }
        log.info('User retrieved from database', { userId: req.currentUser?.userId });
      } catch (dbError) {
        log.error('Failed to get user from database', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId: req.currentUser?.userId
        });
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          message: 'Error fetching current user',
          status: 'error',
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
        });
        return;
      }

      // At this point, existingUser should be valid
      if (existingUser && Object.keys(existingUser).length > 0) {
        isUser = true;
        token = req.session?.jwt;
        
        // Calculate actual counts from FollowerModel to ensure accuracy
        const actualCounts = await followerService.getActualFollowerCounts(`${req.currentUser?.userId}`);
        
        // Override the stored counts with actual counts
        user = {
          ...existingUser,
          followersCount: actualCounts.followersCount,
          followingCount: actualCounts.followingCount
        };
      } else {
        log.warn('User data is empty', { userId: req.currentUser?.userId });
        res.status(HTTP_STATUS.NOT_FOUND).json({
          message: 'User not found',
          status: 'error',
          statusCode: HTTP_STATUS.NOT_FOUND
        });
        return;
      }

      res.status(HTTP_STATUS.OK).json({ token, isUser, user });
    } catch (error) {
      log.error('Unexpected error in currentUser endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: req.currentUser?.userId
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching current user',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }
}

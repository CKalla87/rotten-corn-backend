import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { UserCache } from '@service/redis/user.cache';
import { userQueue } from '@service/queues/user.queue';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { basicInfoSchema, socialLinksSchema } from '@user/schemes/info';
import { userService } from '@service/db/user.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const userCache: UserCache = new UserCache();
const log: Logger = config.createLogger('updateBasicInfo');

export class Edit {
  @joiValidation(basicInfoSchema)
  public async info(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations and ensure data is immediately available
    try {
      await userService.updateUserInfo(`${req.currentUser!.userId}`, req.body);
      log.info('Basic info saved to database successfully', {
        userId: req.currentUser!.userId,
        fields: Object.keys(req.body)
      });
    } catch (error) {
      log.error('Failed to save basic info to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.currentUser!.userId,
        stack: error instanceof Error ? error.stack : undefined
      });
      // Fall back to queue if database save fails
      userQueue.addUserJob('updateBasicInfoInDB', {
        key: `${req.currentUser!.userId}`,
        value: req.body
      });
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    Promise.all(
      Object.entries(req.body).map(([key, value]) =>
        userCache.updateSingleUserItemInCache(
          `${req.currentUser!.userId}`,
          key,
          value as string | number | boolean | string[] | Record<string, unknown>
        )
      )
    ).catch((cacheError) => {
      log.warn('Failed to update basic info cache (non-critical)', cacheError);
    });

    // Always send response
    res.status(HTTP_STATUS.OK).json({ message: 'Updated successfully' });
  }

  @joiValidation(socialLinksSchema)
  public async social(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations and ensure data is immediately available
    try {
      await userService.updateSocialLinks(`${req.currentUser!.userId}`, req.body);
      log.info('Social links saved to database successfully', {
        userId: req.currentUser!.userId,
        links: Object.keys(req.body)
      });
    } catch (error) {
      log.error('Failed to save social links to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.currentUser!.userId,
        stack: error instanceof Error ? error.stack : undefined
      });
      // Fall back to queue if database save fails
      userQueue.addUserJob('updateSocialLinksInDB', {
        key: `${req.currentUser!.userId}`,
        value: req.body
      });
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    userCache.updateSingleUserItemInCache(`${req.currentUser!.userId}`, 'social', req.body).catch((cacheError) => {
      log.warn('Failed to update social links cache (non-critical)', cacheError);
    });

    // Always send response
    res.status(HTTP_STATUS.OK).json({ message: 'Updated successfully' });
  }
}


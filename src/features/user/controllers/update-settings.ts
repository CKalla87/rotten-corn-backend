import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { UserCache } from '@service/redis/user.cache';
import { userQueue } from '@service/queues/user.queue';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { notificationSettingsSchema } from '@user/schemes/info';
import { userService } from '@service/db/user.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const userCache: UserCache = new UserCache();
const log: Logger = config.createLogger('updateNotificationSettings');

export class UpdateSettings {
  @joiValidation(notificationSettingsSchema)
  public async notification(req: Request, res: Response): Promise<void> {
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
      await userService.updateNotificationSettings(`${req.currentUser!.userId}`, req.body);
      log.info('Notification settings saved to database successfully', {
        userId: req.currentUser!.userId,
        settings: Object.keys(req.body)
      });
    } catch (error) {
      log.error('Failed to save notification settings to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.currentUser!.userId,
        stack: error instanceof Error ? error.stack : undefined
      });
      // Fall back to queue if database save fails
      userQueue.addUserJob('updateNotificationSettings', {
        key: `${req.currentUser!.userId}`,
        value: req.body
      });
    }

    // Update cache asynchronously (don't wait for it) - cache is non-blocking
    userCache.updateSingleUserItemInCache(`${req.currentUser!.userId}`, 'notifications', req.body as string | number | boolean | string[] | Record<string, unknown>).catch((cacheError) => {
      log.warn('Failed to update notification settings cache (non-critical)', cacheError);
    });

    // Always send response
    res.status(HTTP_STATUS.OK).json({
      message: 'Notification settings updated successfully',
      settings: req.body
    });
  }
}


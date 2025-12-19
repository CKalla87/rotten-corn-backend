import Logger from 'bunyan';
import { config } from '@root/config';
import { BaseCache } from '@service/redis/base.cache';

const log: Logger = config.createLogger('redisConnection');

class RedisConnection extends BaseCache {
  constructor() {
    super('redisConnection');
  }

  async connect(): Promise<void> {
    try {
      // Add a timeout to prevent blocking the app startup
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout after 5 seconds')), 5000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      
      const res = await this.client.ping();
      // Only log in local development (not in hosted environments for performance)
      const isLocal = config.NODE_ENV === 'local' || !config.NODE_ENV;
      if (isLocal) {
        log.info(res, 'redis');
      }
      log.info('Redis connection established successfully');
    } catch (error) {
      // Log error but don't throw - allow app to continue without Redis
      log.error('Redis connection failed, app will continue without Redis cache', error);
      // Don't throw the error - allow the app to start even if Redis is unavailable
    }
  }
}

export const redisConnection: RedisConnection = new RedisConnection();

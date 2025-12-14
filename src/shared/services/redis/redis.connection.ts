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
      if (!config.REDIS_HOST) {
        log.warn('REDIS_HOST not configured - Redis features will be disabled');
        return;
      }
      
      // Check if already connected
      if (this.client.isOpen) {
        log.info('Redis already connected');
        return;
      }
      
      // Connect with timeout - use Promise.race to timeout after 10 seconds
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis connection timeout after 10 seconds')), 10000);
      });
      
      try {
        await Promise.race([connectPromise, timeoutPromise]);
        // Only ping if connection succeeded
        if (this.client.isOpen) {
          const res = await this.client.ping();
          log.info(`Redis connection ping: ${res}`);
        }
      } catch (timeoutError) {
        // If timeout occurred, try to disconnect to clean up
        try {
          if (this.client.isOpen) {
            await this.client.disconnect();
          }
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
        throw timeoutError;
      }
    } catch (error) {
      log.error('Redis connection failed:', error);
      log.warn('Redis connection will be retried in background - app will continue without Redis cache');
      // Retry connection after delay (non-blocking)
      setTimeout(() => {
        this.connect().catch((retryError) => {
          log.error('Redis connection retry failed:', retryError);
        });
      }, 5000);
    }
  }
}

export const redisConnection: RedisConnection = new RedisConnection();

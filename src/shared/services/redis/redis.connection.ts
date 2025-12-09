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
      await this.client.connect();
      const res = await this.client.ping();
      log.info(`Redis connection ping: ${res}`);
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

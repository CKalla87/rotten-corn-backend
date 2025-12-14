import { createClient } from 'redis';
import Logger from 'bunyan';
import { config } from '@root/config';

export type RedisCient = ReturnType<typeof createClient>;

export abstract class BaseCache {
  client: RedisCient;
  log: Logger;

  constructor(cacheName: string) {
    this.log = config.createLogger(cacheName);
    // Only create Redis client if REDIS_HOST is configured
    if (config.REDIS_HOST) {
      this.client = createClient({
        url: config.REDIS_HOST,
        socket: {
          connectTimeout: 10000, // 10 seconds - reduced from 30 to fail faster
          reconnectStrategy: (retries: number) => {
            if (retries > 10) {
              this.log.warn('Redis reconnection attempts exceeded, giving up');
              return new Error('Redis reconnection limit reached');
            }
            return Math.min(retries * 100, 3000); // Exponential backoff, max 3 seconds
          }
        }
        // Note: Redis client doesn't auto-connect by default in v4+
        // We call connect() manually in redisConnection.connect()
      });
      this.cacheError();
    } else {
      // Create a dummy client that will fail gracefully
      // This prevents crashes when Redis is not configured
      this.client = createClient({ url: 'redis://localhost:6379' });
      this.log.warn('REDIS_HOST not configured - Redis cache operations will fail gracefully');
    }
  }

  private cacheError(): void {
    this.client.on('error', (error: unknown) => {
      this.log.error(error);
    });
  }
}

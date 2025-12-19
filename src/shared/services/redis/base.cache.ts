import { createClient } from 'redis';
import Logger from 'bunyan';
import { config } from '@root/config';

export type RedisCient = ReturnType<typeof createClient>;

export abstract class BaseCache {
  client: RedisCient;
  log: Logger;

  constructor(cacheName: string) {
    // Optimize Redis connection for hosted environments
    const isHostedEnv = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging' || config.NODE_ENV === 'development';
    const redisOptions = isHostedEnv ? {
      url: config.REDIS_HOST,
      socket: {
        connectTimeout: 5000, // 5 second connection timeout
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            return new Error('Too many retries');
          }
          return Math.min(retries * 100, 3000); // Exponential backoff, max 3 seconds
        }
      },
      // Enable connection pooling
      pingInterval: 30000, // Ping every 30 seconds to keep connection alive
    } : { url: config.REDIS_HOST };

    this.client = createClient(redisOptions);
    this.log = config.createLogger(cacheName);
    this.cacheError();
  }

  private cacheError(): void {
    this.client.on('error', (error: unknown) => {
      this.log.error(error);
    });
  }
}

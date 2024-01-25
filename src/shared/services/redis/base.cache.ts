import { createClient } from 'redis';
import Logger from 'bunyan';
import { config } from '@root/config';

export type RedisCient = ReturnType<typeof createClient>;

export abstract class BaseCache {
  client: RedisCient;
  log: Logger;

  constructor(cacheName: string) {
    this.client = createClient({ url: config.REDIS_HOST });
    this.log = config.createLogger(cacheName);
    this.cacheError();
  }

  private cacheError(): void {
    this.client.on('error', (error: unknown) => {
      this.log.error(error);
    });
  }
}

import { IAuthJob } from '@auth/interfaces/auth.interface';
import Queue, { Job } from 'bull';
import Logger from 'bunyan';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from '@root/config';
import { IEmailJob } from '@user/interfaces/user.interface';
import { IPostJobData } from '@post/interfaces/post.interface';
import { IReactionJob } from '@reaction/interfaces/reaction.interface';
import { ICommentJob } from '@comment/interfaces/comment.interface';
import { IFollowerJobData, IBlockedUserJobData } from '@follower/interfaces/follower.interface';
import { IFileImageJobData } from '@image/interfaces/image.interface';
import { IChatJobData, IMessageData } from '@chat/interfaces/chat.interface';

type IBaseJobData =
  | IAuthJob
  | IEmailJob
  | IPostJobData
  | IReactionJob
  | ICommentJob
  | IFollowerJobData
  | IBlockedUserJobData
  | IFileImageJobData
  | IChatJobData
  | IMessageData;

let bullAdapters: BullAdapter[] = [];
export let serverAdapter: ExpressAdapter;

export abstract class BaseQueue {
  queue: Queue.Queue;
  log: Logger;

  constructor(queueName: string) {
    const redisUrl = config.REDIS_HOST || 'redis://localhost:6379';
    this.queue = new Queue(queueName, redisUrl);
    bullAdapters.push(new BullAdapter(this.queue));
    bullAdapters = [...new Set(bullAdapters)];
    serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/queues');

    createBullBoard({
      queues: bullAdapters,
      serverAdapter
    });

    this.log = config.createLogger(`${queueName}Queue`);

    // Queue event handlers
    this.queue.on('error', (error: Error) => {
      this.log.error(`Queue error: ${error.message}`, error);
    });

    this.queue.on('waiting', (jobId: string | number) => {
      this.log.info(`Job ${jobId} is waiting`);
    });

    this.queue.on('active', (job: Job) => {
      this.log.info(`Job ${job.id} is now active`);
    });

    this.queue.on('completed', (job: Job) => {
      this.log.info(`Job ${job.id} completed`);
      job.remove();
    });

    this.queue.on('failed', (job: Job | undefined, error: Error) => {
      this.log.error(`Job ${job?.id || 'unknown'} failed: ${error.message}`, error);
    });

    this.queue.on('stalled', (jobId: string | number) => {
      this.log.warn(`Job ${jobId} is stalled`);
    });
  }

  protected addJob(name: string, data: IBaseJobData): void {
    this.queue.add(name, data, { attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
  }

  protected processJob(name: string, concurrency: number, callback: Queue.ProcessCallbackFunction<void>): void {
    this.queue.process(name, concurrency, callback);
  }
}

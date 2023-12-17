import { authWorker } from './../../workers/auth.worker';
import { IAuthJob } from './../../../features/auth/interfaces/auth.interface';
import { BaseQueue } from '@service/queues/base.queue';

class AuthQueue extends BaseQueue {
  constructor() {
    super('auth');
    this.processJob('addAuthUserToDB', 5, authWorker.addAuthUserToDB);
  }

  public addAuthUserJob(name: string, data: IAuthJob): void {
    this.addJob(name, data);
  }
}

export const authQueue: AuthQueue = new AuthQueue();

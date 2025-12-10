import { DoneCallback, Job } from 'bull';
import Logger from 'bunyan';
import { config } from '@root/config';
import { mailTransport } from '@service/emails/mail.transport';

const log: Logger = config.createLogger('emalWorker');

class EmailWorker {
  async addNotificationEmail(job: Job, done: DoneCallback): Promise<void> {
    try {
      const { template, receiverEmail, subject } = job.data;
      log.info(`Processing email job ${job.id} for ${receiverEmail} with subject: ${subject}`);
      await mailTransport.sendEmail(receiverEmail, subject, template);
      job.progress(100);
      log.info(`Email job ${job.id} completed successfully`);
      done(null, job.data);
    } catch (error) {
      log.error(`Email job ${job.id} failed:`, error);
      done(error as Error);
    }
  }
}

export const emailWorker: EmailWorker = new EmailWorker();

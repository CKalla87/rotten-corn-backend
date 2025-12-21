import { config } from './../../../config';
import { BaseCache } from '@service/redis/base.cache';
import { ServerError } from '@global/helpers/error-handler';
import Logger from 'bunyan';
import { Helpers } from '@global/helpers/helpers';
import { IReactionDocument, IReactions } from '@reaction/interfaces/reaction.interface';
import { find } from 'lodash';

const log: Logger = config.createLogger('reactionsCache');

export class ReactionCache extends BaseCache {
  constructor() {
    super('reactionsCache');
  }

  public async savePostReactionToCache(
    key: string,
    reaction: IReactionDocument,
    postReactions: IReactions,
    type: string,
    previousReaction: string
  ): Promise<void> {
    try {
      if(!this.client.isOpen) {
        await this.client.connect();
      }

      if (previousReaction) {
        this.removePostReactionFromCache(key, reaction.username, postReactions);
      }

      if (type) {
        await this.client.LPUSH(`reactions:${key}`, JSON.stringify(reaction));
        await this.client.HSET(`posts:${key}`, 'reactions', JSON.stringify(postReactions));
      }
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async removePostReactionFromCache(
    key: string,
    username: string,
    postReactions: IReactions
  ): Promise<void> {
    try {
      if(!this.client.isOpen) {
        await this.client.connect();
      }
      const response: string[] = await this.client.LRANGE(`reactions:${key}`, 0, -1);
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      const userPreviousReaction: IReactionDocument = this.getPreviousReaction(response, username) as IReactionDocument;
      multi.LREM(`reactions:${key}`, 1, JSON.stringify(userPreviousReaction));
      await multi.exec();
      await this.client.HSET(`posts:${key}`, 'reactions', JSON.stringify(postReactions));
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getReactionsFromCache(postId: string): Promise<[IReactionDocument[], number]> {
    try {
      if(!this.client.isOpen) {
        await this.client.connect();
      }
      const reactionsCount: number = await this.client.LLEN(`reactions:${postId}`);
      const response: string[] = await this.client.LRANGE(`reactions:${postId}`, 0, -1);
      const list: IReactionDocument[] = [];
      for(const item of response) {
        list.push(Helpers.parseJson(item));
      }
      return response.length ? [list, reactionsCount] : [[], 0];
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getSingleReactionByUsernameFromCache(postId: string, username: string): Promise<[IReactionDocument, number] | []> {
    try {
      // Normalize username to match database query (first letter uppercase)
      // This ensures cache lookup matches the database query format
      const normalizedUsername = Helpers.firstLetterUppercase(username);

      if(!this.client.isOpen) {
        await this.client.connect();
      }
      const response: string[] = await this.client.LRANGE(`reactions:${postId}`, 0, -1);
      const list: IReactionDocument[] = [];
      for(const item of response) {
        list.push(Helpers.parseJson(item));
      }
      const result: IReactionDocument = find(list, (listItem: IReactionDocument) => {
        // Compare with normalized username to match database query format
        return listItem?.postId === postId && listItem?.username === normalizedUsername;
      }) as IReactionDocument;

      return result ? [result, 1] : [];
    } catch (error) {
      // If cache lookup fails (Redis unavailable/slow), return empty array
      // This allows the controller to fall back to database query
      log.error('Cache lookup failed, will fall back to database:', error);
      return [];
    }
  }

  private getPreviousReaction(response: string[], username: string): IReactionDocument | undefined {
    const list: IReactionDocument[] = [];
    for(const item of response) {
      list.push(Helpers.parseJson(item) as IReactionDocument);
    }
    // Normalize username to match stored format
    const normalizedUsername = Helpers.firstLetterUppercase(username);
    return find(list, (listItem:IReactionDocument) => {
      return listItem.username === normalizedUsername;
    });
  }
}

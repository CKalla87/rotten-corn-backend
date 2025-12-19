import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { IReactionJob } from '@reaction/interfaces/reaction.interface';
import { ReactionCache } from '@service/redis/reaction.cache';
import { reactionQueue } from '@service/queues/reaction.queue';
import { reactionService } from '@service/db/reaction.services';
import { config } from '@root/config';
import Logger from 'bunyan';

const reactionCache: ReactionCache = new ReactionCache();
const log: Logger = config.createLogger('removeReaction');

export class Remove {
  public async reaction(req: Request, res: Response): Promise<void> {
    const { postId, previousReaction, postReactions } = req.params;
    await reactionCache.removePostReactionFromCache(postId, `${req.currentUser!.username}`, JSON.parse(postReactions));
    const databaseReactionData: IReactionJob = {
      postId,
      username: req.currentUser!.username,
      previousReaction,
    };
    
    // Save to database synchronously to ensure persistence
    try {
      await reactionService.removeReactionDataFromDB(databaseReactionData);
    } catch (error) {
      // If synchronous save fails, fall back to queue
      log.error('Failed to remove reaction synchronously, falling back to queue', error);
    reactionQueue.addReactionJob('removeReactionFromToDB', databaseReactionData);
    }
    
    res.status(HTTP_STATUS.OK).json({ message: 'Reaction removed from post' });
  }
}

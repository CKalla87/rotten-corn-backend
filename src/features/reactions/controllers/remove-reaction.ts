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
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { postId, previousReaction, postReactions } = req.params;

    // Remove from cache asynchronously (non-blocking)
    reactionCache.removePostReactionFromCache(postId, `${req.currentUser!.username}`, JSON.parse(postReactions)).catch((error) => {
      log.warn('Failed to remove reaction from cache (non-critical)', error);
    });

    const databaseReactionData: IReactionJob = {
      postId,
      username: req.currentUser!.username,
      previousReaction,
    };

    // Save to database synchronously to ensure persistence
    try {
      await reactionService.removeReactionDataFromDB(databaseReactionData);
      log.info('Reaction removed from database successfully', { postId, username: req.currentUser!.username, previousReaction });
    } catch (error) {
      // If synchronous save fails, fall back to queue
      log.error('Failed to remove reaction synchronously, falling back to queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId,
        username: req.currentUser!.username,
        previousReaction
      });
      reactionQueue.addReactionJob('removeReactionFromToDB', databaseReactionData);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Reaction removed from post' });
  }
}

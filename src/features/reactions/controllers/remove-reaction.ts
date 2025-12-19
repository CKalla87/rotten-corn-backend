import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { IReactionJob } from '@reaction/interfaces/reaction.interface';
import { ReactionCache } from '@service/redis/reaction.cache';
import { reactionQueue } from '@service/queues/reaction.queue';
import { reactionService } from '@service/db/reaction.services';
import { commentService } from '@service/db/comment.service';
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
    const { commentId } = req.body || {};

    // Handle comment reactions differently from post reactions
    if (commentId && commentId.trim()) {
      // This is a reaction removal from a comment
      try {
        await commentService.removeReactionFromComment(
          commentId,
          req.currentUser!.username
        );
        log.info('Comment reaction removed from database successfully', {
          commentId,
          username: req.currentUser!.username
        });
        res.status(HTTP_STATUS.OK).json({ message: 'Reaction removed from comment' });
        return;
      } catch (error) {
        log.error('Failed to remove comment reaction from database', {
          error: error instanceof Error ? error.message : 'Unknown error',
          commentId,
          username: req.currentUser!.username,
          stack: error instanceof Error ? error.stack : undefined
        });
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          message: 'Failed to remove reaction'
        });
        return;
      }
    }

    // This is a reaction removal from a post - use existing post reaction logic
    // Remove from cache asynchronously (non-blocking)
    if (postReactions) {
      reactionCache.removePostReactionFromCache(postId, `${req.currentUser!.username}`, JSON.parse(postReactions)).catch((error) => {
        log.warn('Failed to remove reaction from cache (non-critical)', error);
      });
    }

    const databaseReactionData: IReactionJob = {
      postId,
      username: req.currentUser!.username,
      previousReaction,
    };

    // Save to database synchronously to ensure persistence
    try {
      await reactionService.removeReactionDataFromDB(databaseReactionData);
      log.info('Post reaction removed from database successfully', { postId, username: req.currentUser!.username, previousReaction });
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

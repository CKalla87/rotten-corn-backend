import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import HTTP_STATUS from 'http-status-codes';
import { addReactionSchema } from '@reaction/schemes/reactions';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { IReactionDocument, IReactionJob } from '@reaction/interfaces/reaction.interface';
import { ReactionCache } from '@service/redis/reaction.cache';
import { reactionQueue } from '@service/queues/reaction.queue';
import { reactionService } from '@service/db/reaction.services';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('addReaction');

const reactionCache: ReactionCache = new ReactionCache();

export class Add {
  @joiValidation(addReactionSchema)
  public async reaction(req: Request, response: Response): Promise<void> {
    const { userTo, postId, type, previousReaction, postReactions, profilePicture } = req.body;
    const reactionObject: IReactionDocument = {
      _id: new ObjectId(),
      postId,
      type,
      avatarColor: req.currentUser!.avatarColor,
      username: req.currentUser!.username,
      profilePicture
    } as unknown as IReactionDocument;

    await reactionCache.savePostReactionToCache(postId, reactionObject, postReactions, type, previousReaction);

    const databaseReactionData: IReactionJob = {
      postId,
      userTo,
      userFrom: req.currentUser!.userId,
      username: req.currentUser!.username,
      type,
      previousReaction,
      reactionObject
    };
    
    // Save to database synchronously to ensure persistence
    // This ensures reactions are immediately available after refresh, even if Redis cache is cleared
    try {
      await reactionService.addReactionDataToDB(databaseReactionData);
    } catch (error) {
      // If synchronous save fails, fall back to queue (but log the error)
      log.error('Failed to save reaction synchronously, falling back to queue', error);
      reactionQueue.addReactionJob('addReactionToDB', databaseReactionData);
    }
    
    response.status(HTTP_STATUS.OK).json({ message: 'Reaction added successfully'});
  }
}

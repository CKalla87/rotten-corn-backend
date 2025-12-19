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
import { Helpers } from '@global/helpers/helpers';
import Logger from 'bunyan';

const log: Logger = config.createLogger('addReaction');

const reactionCache: ReactionCache = new ReactionCache();

export class Add {
  @joiValidation(addReactionSchema)
  public async reaction(req: Request, response: Response): Promise<void> {
    const { userTo, postId, type, previousReaction, postReactions, profilePicture } = req.body;

    // Normalize profile picture URL to ensure correct Cloudinary cloud name
    let normalizedProfilePicture = profilePicture;
    if (profilePicture && Helpers.isCloudinaryUrl(profilePicture)) {
      // Extract version and public_id from URL
      const urlParts = profilePicture.split('/');
      const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
      if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
        const version = urlParts[versionIndex];
        const publicId = urlParts[versionIndex + 1];
        // Rebuild URL with correct cloud name
        normalizedProfilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
      }
    }

    const reactionObject: IReactionDocument = {
      _id: new ObjectId(),
      postId,
      type,
      avatarColor: req.currentUser!.avatarColor,
      username: req.currentUser!.username,
      profilePicture: normalizedProfilePicture
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

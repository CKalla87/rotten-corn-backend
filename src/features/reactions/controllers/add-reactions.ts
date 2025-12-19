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
      avataColor: req.currentUser!.avatarColor, // Note: schema uses 'avataColor' (typo but must match schema)
      username: req.currentUser!.username,
      profilePicture: normalizedProfilePicture
    } as unknown as IReactionDocument;

    const databaseReactionData: IReactionJob = {
      postId,
      userTo,
      userFrom: req.currentUser!.userId,
      username: req.currentUser!.username,
      type,
      previousReaction,
      reactionObject
    };

    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      response.header('Access-Control-Allow-Origin', origin);
      response.header('Access-Control-Allow-Credentials', 'true');
      response.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      response.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations and ensure data is immediately available
    try {
      await reactionService.addReactionDataToDB(databaseReactionData);
      log.info('Reaction saved to database successfully', { postId, username: req.currentUser!.username, type });
    } catch (error) {
      log.error('Failed to save reaction to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId,
        username: req.currentUser!.username,
        type,
        stack: error instanceof Error ? error.stack : undefined
      });
      // Fall back to queue if database save fails
      reactionQueue.addReactionJob('addReactionToDB', databaseReactionData);
      // Still return success since queue will handle it, but log the issue
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    reactionCache.savePostReactionToCache(postId, reactionObject, postReactions, type, previousReaction || '').catch((cacheError) => {
      log.warn('Failed to update reaction cache (non-critical)', cacheError);
    });

    // Return the reaction object so the frontend can update immediately
    response.status(HTTP_STATUS.OK).json({
      message: 'Reaction added successfully',
      reaction: reactionObject
    });
  }
}

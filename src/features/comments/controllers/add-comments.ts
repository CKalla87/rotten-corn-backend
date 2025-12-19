import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { ObjectId } from 'mongodb';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { addCommentSchema } from '@comment/schemes/comment';
import { CommentCache } from '@service/redis/comment.cache';
import { ICommentDocument, ICommentJob } from '@comment/interfaces/comment.interface';
import { commentQueue } from '@service/queues/comment.queue';
import { socketIOPostObject } from '@socket/post';
import { config } from '@root/config';
import { Helpers } from '@global/helpers/helpers';

const commentCache: CommentCache = new CommentCache();
const log = config.createLogger('addCommentController');

export class Add {
  @joiValidation(addCommentSchema)
  public async comment(req: Request, res: Response): Promise<void> {
    const { userTo, postId, comment, profilePicture, gifUrl } = req.body;

    // Normalize profile picture URL to ensure correct Cloudinary cloud name
    let normalizedProfilePicture = profilePicture || '';
    if (normalizedProfilePicture && Helpers.isCloudinaryUrl(normalizedProfilePicture)) {
      // Extract version and public_id from URL
      const urlParts = normalizedProfilePicture.split('/');
      const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
      if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
        const version = urlParts[versionIndex];
        const publicId = urlParts[versionIndex + 1];
        // Rebuild URL with correct cloud name
        normalizedProfilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
      }
    }

    const commentObject: ICommentDocument = {
      _id: new ObjectId(),
      username: req.currentUser!.username,
      avatarColor: req.currentUser!.avatarColor,
      postId,
      profilePicture: normalizedProfilePicture,
      comment,
      gifUrl: gifUrl || '',
      createdAt: new Date()
    } as unknown as ICommentDocument;

    const databaseCommentData: ICommentJob = {
      postId,
      userTo,
      userFrom: req.currentUser!.userId,
      username: req.currentUser!.username,
      comment: commentObject
    };

    // Save to database FIRST for immediate persistence
    // Skip cache to avoid slow Redis operations and ensure data is immediately available
    const { commentService } = await import('@service/db/comment.service');
    try {
      await commentService.addCommentToDB(databaseCommentData);
      log.info('Comment saved to database successfully', { postId, username: req.currentUser!.username });
    } catch (error) {
      log.error('Failed to save comment to database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId,
        username: req.currentUser!.username
      });
      // Fall back to queue if database save fails
      commentQueue.addCommentJob('addCommentToDB', databaseCommentData);
    }

    // Update cache asynchronously (don't wait for it) for better performance
    // Cache is just for optimization, database is the source of truth
    commentCache.savePostCommentToCache(postId, JSON.stringify(commentObject)).catch((cacheError) => {
      log.warn('Failed to update comment cache (non-critical)', cacheError);
    });

    if (socketIOPostObject) {
      socketIOPostObject.emit('comment', commentObject);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Comment created successfully' });
  }
}

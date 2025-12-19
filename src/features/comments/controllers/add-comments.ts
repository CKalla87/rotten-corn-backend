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

const commentCache: CommentCache = new CommentCache();
const log = config.createLogger('addCommentController');

export class Add {
  @joiValidation(addCommentSchema)
  public async comment(req: Request, res: Response): Promise<void> {
    const { userTo, postId, comment, profilePicture, gifUrl } = req.body;
    const commentObject: ICommentDocument = {
      _id: new ObjectId(),
      username: req.currentUser!.username,
      avatarColor: req.currentUser!.avatarColor,
      postId,
      profilePicture: profilePicture || '',
      comment,
      gifUrl: gifUrl || '',
      createdAt: new Date()
    } as unknown as ICommentDocument;

    // Save to cache with timeout - don't block request if Redis is slow/hanging
    // Cache is best-effort; comment will still be saved to DB via queue
    Promise.race([
      commentCache.savePostCommentToCache(postId, JSON.stringify(commentObject)),
      new Promise<void>((resolve) => setTimeout(() => {
        log.warn('Comment cache save timed out, continuing without cache');
        resolve();
      }, 5000))
    ]).catch((error) => {
      // Log but don't block - cache failures are non-fatal
      log.error('Comment cache save failed (non-fatal):', error);
    });

    if (socketIOPostObject) {
      socketIOPostObject.emit('comment', commentObject);
    }

    const databaseCommentData: ICommentJob = {
      postId,
      userTo,
      userFrom: req.currentUser!.userId,
      username: req.currentUser!.username,
      comment: commentObject
    };
    commentQueue.addCommentJob('addCommentToDB', databaseCommentData);
    res.status(HTTP_STATUS.OK).json({ message: 'Comment created successfully' });
  }
}

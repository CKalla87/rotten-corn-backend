import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { ObjectId } from 'mongodb';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { addCommentSchema } from '@comment/schemes/comment';
import { CommentCache } from '@service/redis/comment.cache';
import { ICommentDocument, ICommentJob } from '@comment/interfaces/comment.interface';
import { commentQueue } from '@service/queues/comment.queue';
import { socketIOPostObject } from '@socket/post';

const commentCache: CommentCache = new CommentCache();

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

    await commentCache.savePostCommentToCache(postId, JSON.stringify(commentObject));
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

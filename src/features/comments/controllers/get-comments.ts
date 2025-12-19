import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { CommentCache } from '@service/redis/comment.cache';
import { ICommentDocument, ICommentNameList } from '@comment/interfaces/comment.interface';
import { commentService } from '@service/db/comment.service';
import mongoose from 'mongoose';

const commentCache: CommentCache = new CommentCache();

export class Get {
  public async comments(req: Request, res: Response): Promise<void> {
    const { postId } = req.params;
    // Always fetch from database to ensure we get the latest reactions
    // Cache might have stale data without reactions
    // Sort by createdAt: 1 (ascending) so oldest comments appear first, newest at bottom
    const comments: ICommentDocument[] = await commentService.getPostComments({ postId: new mongoose.Types.ObjectId(postId) }, { createdAt: 1 });

    // Comments now have reactions stored directly in the schema
    // Convert mongoose documents to plain objects and ensure reaction array exists
    const commentsWithReactions = comments.map((comment) => {
      const commentObj = comment.toObject ? comment.toObject() : comment;
      const reactionArray = Array.isArray(commentObj.reaction) ? commentObj.reaction : [];

      return {
        ...commentObj,
        reaction: reactionArray
      };
    });

    // Only log in local development (not in hosted environments for performance)
    const isLocal = process.env.NODE_ENV === 'local' || !process.env.NODE_ENV;
    if (isLocal) {
      console.log(`📝 Returning ${commentsWithReactions.length} comments for postId ${postId}, ${commentsWithReactions.filter(c => Array.isArray(c.reaction) && c.reaction.length > 0).length} with reactions`);
    }

    res.status(HTTP_STATUS.OK).json({ message: 'Post comments', comments: commentsWithReactions });
  }

  public async commentsNamesFromCache(req: Request, res: Response): Promise<void> {
    const { postId } = req.params;
    // Skip cache - go directly to database for faster response
    // Database query is now optimized with timeout
    const commentsNames: ICommentNameList[] = await commentService.getPostCommentNames(
      { postId: new mongoose.Types.ObjectId(postId) },
      { createdAt: -1 }
    );

    res.status(HTTP_STATUS.OK).json({ message: 'Post comments names', comments: commentsNames });
  }

  public async singleComment(req: Request, res: Response): Promise<void> {
    const { postId, commentId } = req.params;
    // Skip cache - go directly to database for faster response
    const comments: ICommentDocument[] = await commentService.getPostComments(
      { _id: new mongoose.Types.ObjectId(commentId) },
      { createdAt: -1 }
    );

    res.status(HTTP_STATUS.OK).json({ message: 'Single comment', comments: comments[0] });
  }
}

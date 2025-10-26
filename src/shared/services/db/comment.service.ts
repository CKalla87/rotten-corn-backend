import { CommentsModel } from '@comment/models/comment.schema';
import { ICommentDocument, ICommentJob, ICommentNameList, IQueryComment } from './../../../features/comments/interfaces/comment.interface';
import { UserCache } from '@service/redis/user.cache';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostModel } from '@post/models/post.schema';
import { Query } from 'mongoose';
import { IUserDocument } from '@user/interfaces/user.interface';

const userCache: UserCache = new UserCache();

class CommentService {
  public async addCommentToDB(commentData: ICommentJob): Promise<void> {
    const { postId, userTo, comment } = commentData;
    const commentPromise: Promise<ICommentDocument> = CommentsModel.create(comment);
    const postPromise: Query<IPostDocument, IPostDocument> = PostModel.findOneAndUpdate(
      { _id: postId },
      { $inc: { commentsCount: 1 } },
      { new: true }
    ) as Query<IPostDocument, IPostDocument>;
    const userPromise: Promise<IUserDocument> = userCache.getUserFromCache(userTo) as Promise<IUserDocument>;
    await Promise.all([commentPromise, postPromise, userPromise]);
  }

  public async getPostComments(query: IQueryComment, sort: Record<string, 1 | -1>): Promise<ICommentDocument[]> {
    const comments: ICommentDocument[] = await CommentsModel.aggregate([
      { $match: { query } },
      { $sort: sort },
    ]);
    return comments;
  }

  public async getPostCommentNames(query: IQueryComment, sort: Record<string, 1 | -1>): Promise<ICommentNameList[]> {
    const commentsNameList: ICommentNameList[] = await CommentsModel.aggregate([
      { $match: { query } },
      { $sort: sort },
      { $group: { _id: null, names: { $addToSet: '$username' }, count: { $sum: 1 } } },
      { $project: { _id: 0 } }
    ]);
    return commentsNameList;
  }
}

export const commentService: CommentService = new CommentService();

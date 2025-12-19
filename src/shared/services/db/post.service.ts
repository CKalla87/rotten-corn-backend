import { IGetPostsQuery, IPostDocument, IQueryComplete, IQueryDeleted } from '@post/interfaces/post.interface';
import { PostModel } from '@post/models/post.schema';
import { IUserDocument } from '@user/interfaces/user.interface';
import { UserModel } from '@user/models/user.schema';
import { Query, UpdateQuery } from 'mongoose';

class PostService {
  public async addPostToDB(userId: string, createdPost: IPostDocument): Promise<void> {
    const post: Promise<IPostDocument> = PostModel.create(createdPost);
    const user: UpdateQuery<IUserDocument> = UserModel.updateOne({ _id: userId }, { $inc: { postCount: 1 }});
    await Promise.all([post, user]);
  }

  public async getPosts(query: IGetPostsQuery, skip = 0, limit = 0, sort: Record<string, 1 | -1>): Promise<IPostDocument[]> {
    let postQuery = {};
    if (query?.imgId && query?.gifUrl) {
      postQuery = { $or: [{ imgId: { $ne: ''} }, { gifUrl: { $ne: '' }}] };
    } else if (query?.videoId) {
      postQuery = { $or: [{ videoId: { $ne: ''} }] };
    } else {
      postQuery = query;
    }
    // Optimize aggregation with indexes and limit fields for faster queries
    const posts: IPostDocument[] = await PostModel.aggregate([
      { $match: postQuery },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      // Add projection to only fetch needed fields (reduces data transfer)
      {
        $project: {
          userId: 1,
          username: 1,
          email: 1,
          avatarColor: 1,
          profilePicture: 1,
          post: 1,
          bgColor: 1,
          imgVersion: 1,
          imgId: 1,
          videoVersion: 1,
          videoId: 1,
          feelings: 1,
          gifUrl: 1,
          privacy: 1,
          commentsCount: 1,
          reactions: 1,
          createdAt: 1
        }
      }
    ]);
    
    // Ensure video and image fields are set to empty strings if undefined to prevent undefined in URLs
    for (const post of posts) {
      if (!post.videoVersion) post.videoVersion = '';
      if (!post.videoId) post.videoId = '';
      if (!post.imgVersion) post.imgVersion = '';
      if (!post.imgId) post.imgId = '';
    }
    return posts;
  }

  public async postsCount(): Promise<number> {
    const count: number = await PostModel.find({}).countDocuments();
    return count;
  }

  public async deletePost(postId: string, userId: string): Promise<void> {
    const deletePost: Query<IQueryComplete & IQueryDeleted, IPostDocument> = PostModel.deleteOne({ _id: postId });
    // delete reactions here
    const decrementPostCount: UpdateQuery<IUserDocument> = UserModel.updateOne({ _id: userId }, { $inc: { postsCount: -1 }});
    await Promise.all([deletePost, decrementPostCount]);
  }

  public async editPost(postId: string, updatedPost: IPostDocument): Promise<void> {
    const updatePost: UpdateQuery<IPostDocument> = PostModel.updateOne({ _id: postId }, { $set: updatedPost });
    await Promise.all([updatePost]);
  }
}

export const postService: PostService = new PostService();

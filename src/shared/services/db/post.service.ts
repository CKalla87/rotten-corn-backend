import { IGetPostsQuery, IPostDocument, IQueryComplete, IQueryDeleted } from '@post/interfaces/post.interface';
import { PostModel } from '@post/models/post.schema';
import { IUserDocument } from '@user/interfaces/user.interface';
import { UserModel } from '@user/models/user.schema';
import mongoose, { Query, UpdateQuery } from 'mongoose';
import { Helpers } from '@global/helpers/helpers';
import { config } from '@root/config';

class PostService {
  public async addPostToDB(userId: string, createdPost: IPostDocument): Promise<void> {
    // Ensure userId is converted to ObjectId for database operations
    const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    // Create a copy of createdPost to avoid mutating the original
    // Mongoose will handle ObjectId conversion automatically, but ensure _id is proper type
    const postToCreate = { ...createdPost };

    // Ensure _id is ObjectId if it exists and is a string
    if (postToCreate._id && typeof postToCreate._id === 'string') {
      (postToCreate as any)._id = new mongoose.Types.ObjectId(postToCreate._id);
    }

    const post: Promise<IPostDocument> = PostModel.create(postToCreate);
    const user: Promise<any> = UserModel.updateOne({ _id: userIdObj }, { $inc: { postCount: 1 } }).maxTimeMS(5000).exec();
    await Promise.all([post, user]);
  }

  public async getPosts(query: IGetPostsQuery, skip = 0, limit = 0, sort: Record<string, 1 | -1>): Promise<IPostDocument[]> {
    let postQuery: any = {};
    if (query?.imgId && query?.gifUrl) {
      postQuery = { $or: [{ imgId: { $ne: ''} }, { gifUrl: { $ne: '' }}] };
    } else if (query?.videoId) {
      postQuery = { $or: [{ videoId: { $ne: ''} }] };
    } else {
      postQuery = { ...query };
      // Convert userId to ObjectId if it's a string
      if (postQuery.userId && typeof postQuery.userId === 'string') {
        postQuery.userId = new mongoose.Types.ObjectId(postQuery.userId);
      }
    }
    // Ensure limit is set (max 100 to prevent slow queries)
    const safeLimit = limit > 0 ? Math.min(limit, 100) : 10;

    // Use find() with lean() for much faster queries - no Mongoose overhead
    // Use hint to ensure index is used for sorting
    // If querying by userId, use the compound index { userId: 1, createdAt: -1 }
    const hint = postQuery.userId ? { userId: 1, createdAt: -1 } : { createdAt: -1 };
    const posts: IPostDocument[] = await PostModel.find(postQuery)
      .sort(sort)
      .skip(skip)
      .limit(safeLimit)
      .lean()
      .hint(hint) // Use appropriate index based on query
      .maxTimeMS(10000)
      .exec() as IPostDocument[];

    // Ensure video and image fields are set to empty strings if undefined to prevent undefined in URLs
    // Also ensure reactions object is properly initialized
    // Normalize Cloudinary URLs to fix wrong cloud name issues
    for (const post of posts) {
      if (!post.videoVersion) post.videoVersion = '';
      if (!post.videoId) post.videoId = '';
      if (!post.imgVersion) post.imgVersion = '';
      if (!post.imgId) post.imgId = '';

      // Normalize profile picture URL to fix Cloudinary cloud name issues
      if (post.profilePicture && Helpers.isCloudinaryUrl(post.profilePicture)) {
        const urlParts = post.profilePicture.split('/');
        const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
        if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
          const version = urlParts[versionIndex];
          const publicId = urlParts[versionIndex + 1];
          post.profilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
        }
      }

      // Ensure reactions object has the correct structure
      if (!post.reactions || typeof post.reactions !== 'object') {
        post.reactions = { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
      } else {
        // Ensure all reaction types are present with default 0 if missing
        post.reactions = {
          like: post.reactions.like || 0,
          love: post.reactions.love || 0,
          happy: post.reactions.happy || 0,
          wow: post.reactions.wow || 0,
          sad: post.reactions.sad || 0,
          angry: post.reactions.angry || 0
        };
      }
    }
    return posts;
  }

  public async postsCount(): Promise<number> {
    // Use estimatedDocumentCount for much faster count (uses collection metadata)
    // This is approximate but much faster than countDocuments()
    try {
      const count: number = await PostModel.estimatedDocumentCount();
      return count;
    } catch (error) {
      // Fallback to countDocuments if estimatedDocumentCount fails
      const count: number = await PostModel.find({}).countDocuments().maxTimeMS(5000);
      return count;
    }
  }

  public async deletePost(postId: string, userId: string): Promise<void> {
    const deletePost: Query<IQueryComplete & IQueryDeleted, IPostDocument> = PostModel.deleteOne({ _id: postId });
    // delete reactions here
    const decrementPostCount: UpdateQuery<IUserDocument> = UserModel.updateOne({ _id: userId }, { $inc: { postsCount: -1 }});
    await Promise.all([deletePost, decrementPostCount]);
  }

  public async editPost(postId: string, updatedPost: IPostDocument): Promise<void> {
    // Build update object with only the fields that should be updated
    // This ensures we only update fields that were explicitly provided in the request
    const fieldsToUpdate: Partial<IPostDocument> = {};

    // Check if field exists in updatedPost and update it
    // Use !== undefined to preserve empty strings (which are valid values)
    if ('post' in updatedPost && updatedPost.post !== undefined) {
      fieldsToUpdate.post = updatedPost.post;
    }
    if ('bgColor' in updatedPost && updatedPost.bgColor !== undefined) {
      fieldsToUpdate.bgColor = updatedPost.bgColor;
    }
    if ('privacy' in updatedPost && updatedPost.privacy !== undefined) {
      fieldsToUpdate.privacy = updatedPost.privacy;
    }
    if ('feelings' in updatedPost && updatedPost.feelings !== undefined) {
      fieldsToUpdate.feelings = updatedPost.feelings;
    }
    if ('gifUrl' in updatedPost && updatedPost.gifUrl !== undefined) {
      fieldsToUpdate.gifUrl = updatedPost.gifUrl;
    }
    if ('profilePicture' in updatedPost && updatedPost.profilePicture !== undefined) {
      fieldsToUpdate.profilePicture = updatedPost.profilePicture;
    }
    if ('imgId' in updatedPost && updatedPost.imgId !== undefined) {
      fieldsToUpdate.imgId = updatedPost.imgId;
    }
    if ('imgVersion' in updatedPost && updatedPost.imgVersion !== undefined) {
      fieldsToUpdate.imgVersion = updatedPost.imgVersion;
    }
    if ('videoId' in updatedPost && updatedPost.videoId !== undefined) {
      fieldsToUpdate.videoId = updatedPost.videoId;
    }
    if ('videoVersion' in updatedPost && updatedPost.videoVersion !== undefined) {
      fieldsToUpdate.videoVersion = updatedPost.videoVersion;
    }

    // Only update if there are fields to update
    if (Object.keys(fieldsToUpdate).length === 0) {
      return; // No fields to update
    }

    const updatePost: UpdateQuery<IPostDocument> = PostModel.updateOne({ _id: postId }, { $set: fieldsToUpdate });
    await Promise.all([updatePost]);
  }
}

export const postService: PostService = new PostService();

import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { PostCache } from '@service/redis/post.cache';
import { socketIOPostObject } from '@socket/post';
import { postQueue } from '@service/queues/post.queue';
import { imageQueue } from '@service/queues/image.queue';
import { postService } from '@service/db/post.service';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { postSchema, postWithImageSchema, postWithVideoSchema } from '@post/schemes/post.schemes';
import { IPostDocument } from '@post/interfaces/post.interface';
import { UploadApiResponse } from 'cloudinary';
import { uploads, videoUpload } from '@global/helpers/cloudinary-upload';
import { BadRequestError } from '@global/helpers/error-handler';
import { config } from '@root/config';
import Logger from 'bunyan';

const postCache: PostCache = new PostCache();
const log: Logger = config.createLogger('updatePost');

export class Update {
  @joiValidation(postSchema)
  public async post(req: Request, res: Response): Promise<void> {
    const { post, bgColor, feelings, privacy, gifUrl, imgVersion, imgId, profilePicture, videoId, videoVersion } = req.body;
    const { postId } = req.params;

    log.info(`Updating post ${postId} with data:`, {
      post: post ? post.substring(0, 50) : '(empty)',
      postLength: post?.length || 0,
      bgColor,
      feelings,
      privacy,
      hasImgId: !!imgId,
      hasVideoId: !!videoId
    });

    // Build updatedPost object, only including fields that are explicitly provided
    const updatedPost: Partial<IPostDocument> = {};

    // Only include fields that are explicitly provided (not undefined)
    if (post !== undefined) updatedPost.post = post;
    if (bgColor !== undefined) updatedPost.bgColor = bgColor;
    if (privacy !== undefined) updatedPost.privacy = privacy;
    if (feelings !== undefined) updatedPost.feelings = feelings;
    if (gifUrl !== undefined) updatedPost.gifUrl = gifUrl;
    if (profilePicture !== undefined) updatedPost.profilePicture = profilePicture;
    if (imgId !== undefined) updatedPost.imgId = imgId ? imgId : '';
    if (imgVersion !== undefined) updatedPost.imgVersion = imgVersion ? imgVersion : '';
    if (videoId !== undefined) updatedPost.videoId = videoId ? videoId : '';
    if (videoVersion !== undefined) updatedPost.videoVersion = videoVersion ? videoVersion : '';

    // Try to update cache, but don't fail if cache update fails
    let postUpdated: IPostDocument;
    try {
      // updatePostInCache expects IPostDocument, so we need to cast it
      postUpdated = await postCache.updatePostInCache(postId, updatedPost as IPostDocument);
      log.info(`Post ${postId} updated in cache successfully`);
    } catch (error) {
      log.warn(`Failed to update post ${postId} in cache, using updatedPost directly:`, error);
      postUpdated = { ...updatedPost, _id: postId } as IPostDocument;
    }

    socketIOPostObject.emit('update post', postUpdated, 'posts');

    // Save to database synchronously to ensure persistence
    // Pass updatedPost (only fields from request) instead of postUpdated (full post from cache)
    // This ensures we only update the fields that were explicitly changed
    try {
      await postService.editPost(postId, updatedPost as IPostDocument);
      log.info(`Post ${postId} updated in database successfully with fields:`, Object.keys(updatedPost));
    } catch (error) {
      log.error('Failed to save post update synchronously, falling back to queue', error);
      postQueue.addPostJob('updatePostInDB', { key: postId, value: updatedPost as IPostDocument });
    }

    log.info(`Sending success response for post ${postId} update`);
    res.status(HTTP_STATUS.OK).json({ message: 'Post updated successfully', post: postUpdated });
  }

  @joiValidation(postWithImageSchema)
  public async postWithImage(req: Request, res: Response): Promise<void> {
    const { imgId, imgVersion } = req.body;
    if(imgId && imgVersion) {
      Update.prototype.updatePostWithImage(req);
    } else {
      const result: UploadApiResponse = await Update.prototype.addImageToExistingPost(req);
      if (!result.public_id) {
        throw new BadRequestError(result.message);
      }
    }
    res.status(HTTP_STATUS.OK).json({ message: 'Post with image updated successfully'});
  }

  @joiValidation(postWithVideoSchema)
  public async postWithVideo(req: Request, res: Response): Promise<void> {
    const { videoId, videoVersion } = req.body;
    if (videoId && videoVersion) {
      Update.prototype.updatePost(req);
    } else {
      const result: UploadApiResponse = await Update.prototype.addVideoToExistingPost(req);
      if (!result.public_id) {
        throw new BadRequestError(result.message);
      }
    }
    res.status(HTTP_STATUS.OK).json({ message: 'Post with video updated successfully'});
  }

  private async updatePost(req: Request): Promise<void> {
    const { post, bgColor, feelings, privacy, gifUrl, imgVersion, imgId, profilePicture, videoId, videoVersion } = req.body;
    const { postId } = req.params;

    log.info(`Updating post ${postId} (private method)`);

    const updatedPost: IPostDocument = {
      post,
      bgColor,
      privacy,
      feelings,
      gifUrl,
      profilePicture,
      imgId: imgId ? imgId : '',
      imgVersion: imgVersion ? imgVersion : '',
      videoId: videoId ? videoId : '',
      videoVersion: videoVersion ? videoVersion : ''
    } as IPostDocument;

    // Try to update cache, but don't fail if cache update fails
    let postUpdated: IPostDocument;
    try {
      postUpdated = await postCache.updatePostInCache(postId, updatedPost);
      log.info(`Post ${postId} updated in cache successfully (private method)`);
    } catch (error) {
      log.warn(`Failed to update post ${postId} in cache, using updatedPost directly:`, error);
      postUpdated = { ...updatedPost, _id: postId } as IPostDocument;
    }

    socketIOPostObject.emit('update post', postUpdated, 'posts');

    // Save to database synchronously to ensure persistence
    try {
      await postService.editPost(postId, postUpdated);
      log.info(`Post ${postId} updated in database successfully (private method)`);
    } catch (error) {
      log.error('Failed to save post update synchronously, falling back to queue', error);
      postQueue.addPostJob('updatePostInDB', { key: postId, value: postUpdated });
    }
  }

  private async updatePostWithImage(req: Request): Promise<void> {
    const { post, bgColor, feelings, privacy, gifUrl, imgVersion, imgId, profilePicture } = req.body;
    const { postId } = req.params;

    log.info(`Updating post ${postId} with image`);

    const updatedPost: IPostDocument = {
      post,
      bgColor,
      privacy,
      feelings,
      gifUrl,
      profilePicture,
      imgId,
      imgVersion
    } as IPostDocument;

    // Try to update cache, but don't fail if cache update fails
    let postUpdated: IPostDocument;
    try {
      postUpdated = await postCache.updatePostInCache(postId, updatedPost);
      log.info(`Post ${postId} updated in cache successfully (with image)`);
    } catch (error) {
      log.warn(`Failed to update post ${postId} in cache, using updatedPost directly:`, error);
      postUpdated = { ...updatedPost, _id: postId } as IPostDocument;
    }

    socketIOPostObject.emit('update post', postUpdated, 'posts');

    // Save to database synchronously to ensure persistence
    try {
      await postService.editPost(postId, postUpdated);
      log.info(`Post ${postId} updated in database successfully (with image)`);
    } catch (error) {
      log.error('Failed to save post update synchronously, falling back to queue', error);
      postQueue.addPostJob('updatePostInDB', { key: postId, value: postUpdated });
    }
  }

  private async addImageToExistingPost(req: Request): Promise<UploadApiResponse> {
    const { post, bgColor, feelings, privacy, gifUrl, profilePicture, image } = req.body;
    const { postId } = req.params;

    log.info(`Adding image to post ${postId}`);

    const result: UploadApiResponse = (await uploads(image)) as UploadApiResponse;
    if (!result?.public_id) {
      return result;
    }
    const updatedPost: IPostDocument = {
      post,
      bgColor,
      privacy,
      feelings,
      gifUrl,
      profilePicture,
      imgId: result.public_id,
      imgVersion: result.version.toString()
    } as IPostDocument;

    // Try to update cache, but don't fail if cache update fails
    let postUpdated: IPostDocument;
    try {
      postUpdated = await postCache.updatePostInCache(postId, updatedPost);
      log.info(`Post ${postId} updated in cache successfully (added image)`);
    } catch (error) {
      log.warn(`Failed to update post ${postId} in cache, using updatedPost directly:`, error);
      postUpdated = { ...updatedPost, _id: postId } as IPostDocument;
    }

    socketIOPostObject.emit('update post', postUpdated, 'posts');

    // Save to database synchronously to ensure persistence
    try {
      await postService.editPost(postId, postUpdated);
      log.info(`Post ${postId} updated in database successfully (added image)`);
    } catch (error) {
      log.error('Failed to save post update synchronously, falling back to queue', error);
      postQueue.addPostJob('updatePostInDB', { key: postId, value: postUpdated });
    }

    // call image queue to add image to mongodb database
    imageQueue.addImageJob('addImageToDB', {
      key: `${req.currentUser!.userId}`,
      imgId: result.public_id,
      imgVersion: result.version.toString()
    });

    return result;
  }

  private async addVideoToExistingPost(req: Request): Promise<UploadApiResponse> {
    const { post, bgColor, feelings, privacy, gifUrl, profilePicture, video } = req.body;
    const { postId } = req.params;

    log.info(`Adding video to post ${postId}`);

    const result: UploadApiResponse = (await videoUpload(video)) as UploadApiResponse;
    if (!result?.public_id) {
      return result;
    }
    const updatedPost: IPostDocument = {
      post,
      bgColor,
      privacy,
      feelings,
      gifUrl,
      profilePicture,
      videoId: result.public_id,
      videoVersion: result.version.toString()
    } as IPostDocument;

    // Try to update cache, but don't fail if cache update fails
    let postUpdated: IPostDocument;
    try {
      postUpdated = await postCache.updatePostInCache(postId, updatedPost);
      log.info(`Post ${postId} updated in cache successfully (added video)`);
    } catch (error) {
      log.warn(`Failed to update post ${postId} in cache, using updatedPost directly:`, error);
      postUpdated = { ...updatedPost, _id: postId } as IPostDocument;
    }

    socketIOPostObject.emit('update post', postUpdated, 'posts');

    // Save to database synchronously to ensure persistence
    try {
      await postService.editPost(postId, postUpdated);
      log.info(`Post ${postId} updated in database successfully (added video)`);
    } catch (error) {
      log.error('Failed to save post update synchronously, falling back to queue', error);
      postQueue.addPostJob('updatePostInDB', { key: postId, value: postUpdated });
    }

    return result;
  }
}

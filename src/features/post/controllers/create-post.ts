import { postSchema, postWithImageSchema, postWithVideoSchema } from '@post/schemes/post.schemes';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import HTTP_STATUS from 'http-status-codes';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostCache } from '@service/redis/post.cache';
import { socketIOPostObject } from '@socket/post';
import { postQueue } from '@service/queues/post.queue';
import { postService } from '@service/db/post.service';
import { UploadApiResponse } from 'cloudinary';
import { uploads, videoUpload } from '@global/helpers/cloudinary-upload';
import { BadRequestError } from '@global/helpers/error-handler';
import { config } from '@root/config';
import Logger from 'bunyan';

const postCache: PostCache = new PostCache();
const log: Logger = config.createLogger('createPost');

export class Create {
  @joiValidation(postSchema)
  public async post(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { post, bgColor, privacy, gifUrl, profilePicture, feelings } = req.body;
    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture,
      post,
      bgColor,
      feelings,
      privacy,
      gifUrl,
      commentsCount: 0,
      imgVersion: '',
      imgId: '',
      videoVersion: '',
      videoId: '',
      createdAt: new Date(),
      reactions: { like: 0, love: 0, happy: 0, sad: 0, wow: 0, angry: 0 }
    } as IPostDocument;

    // Emit socket event (non-blocking)
    if (socketIOPostObject) {
      socketIOPostObject.emit('add post', createdPost);
    }

    // Save to cache asynchronously (non-blocking) - don't await
    // Cache is just for optimization, database is the source of truth
    postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    }).catch((cacheError) => {
      log.warn('Failed to save post to cache (non-critical)', cacheError);
    });

    // Save to database synchronously to ensure persistence
    try {
      await postService.addPostToDB(`${req.currentUser!.userId}`, createdPost);
      log.info('Post saved to database successfully', { postId: postObjectId, userId: req.currentUser!.userId });
    } catch (error) {
      log.error('Failed to save post synchronously, falling back to queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId: postObjectId,
        userId: req.currentUser!.userId,
        stack: error instanceof Error ? error.stack : undefined
      });
      postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});
    }

    // Always send response - don't let cache or other async operations block it
    res.status(HTTP_STATUS.CREATED).json({
      message: 'Post created successfully',
      post: createdPost
    });
  }

  @joiValidation(postWithImageSchema)
  public async postWithImage(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { post, bgColor, privacy, gifUrl, profilePicture, feelings, image } = req.body;

    const result: UploadApiResponse = (await uploads(image)) as UploadApiResponse;
    if (!result?.public_id) {
      throw new BadRequestError(result?.message || 'Image upload failed');
    }

    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture,
      post,
      bgColor,
      feelings,
      privacy,
      gifUrl,
      commentsCount: 0,
      imgVersion: result.version.toString(),
      imgId: result.public_id,
      createdAt: new Date(),
      reactions: { like: 0, love: 0, happy: 0, sad: 0, wow: 0, angry: 0 }
    } as IPostDocument;

    // Emit socket event (non-blocking)
    if (socketIOPostObject) {
      socketIOPostObject.emit('add post', createdPost);
    }

    // Save to cache asynchronously (non-blocking) - don't await
    postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    }).catch((cacheError) => {
      log.warn('Failed to save post to cache (non-critical)', cacheError);
    });

    // Save to database synchronously to ensure persistence
    try {
      await postService.addPostToDB(`${req.currentUser!.userId}`, createdPost);
      log.info('Post with image saved to database successfully', { postId: postObjectId, userId: req.currentUser!.userId });
    } catch (error) {
      log.error('Failed to save post synchronously, falling back to queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId: postObjectId,
        userId: req.currentUser!.userId
      });
      postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});
    }

    // Always send response
    res.status(HTTP_STATUS.CREATED).json({
      message: 'Post created with image successfully',
      post: createdPost
    });
  }

  @joiValidation(postWithVideoSchema)
  public async postWithVideo(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { post, bgColor, privacy, gifUrl, profilePicture, feelings, video } = req.body;

    // Check if video is a base64-encoded URL and decode it, or use as-is if it's already a data URI or URL
    let videoInput = video;
    if (!video.startsWith('data:') && !video.startsWith('http://') && !video.startsWith('https://')) {
      // Try to decode base64 string (might be a base64-encoded URL)
      try {
        const decoded = Buffer.from(video, 'base64').toString('utf-8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          videoInput = decoded;
        }
      } catch (e) {
        // If decoding fails, use original string
        videoInput = video;
      }
    }

    const result: UploadApiResponse = (await videoUpload(videoInput)) as UploadApiResponse;
    if (!result?.public_id) {
      throw new BadRequestError(result?.message || 'Video upload failed. Please provide a valid video file as a base64 data URI (data:video/mp4;base64,...) or a direct video URL.');
    }

    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture,
      post,
      bgColor,
      feelings,
      privacy,
      gifUrl,
      commentsCount: 0,
      imgVersion: '',
      imgId: '',
      videoVersion: result.version.toString(),
      videoId: result.public_id,
      createdAt: new Date(),
      reactions: { like: 0, love: 0, happy: 0, sad: 0, wow: 0, angry: 0 }
    } as IPostDocument;

    // Emit socket event (non-blocking)
    if (socketIOPostObject) {
      socketIOPostObject.emit('add post', createdPost);
    }

    // Save to cache asynchronously (non-blocking) - don't await
    postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    }).catch((cacheError) => {
      log.warn('Failed to save post to cache (non-critical)', cacheError);
    });

    // Save to database synchronously to ensure persistence
    try {
      await postService.addPostToDB(`${req.currentUser!.userId}`, createdPost);
      log.info('Post with video saved to database successfully', { postId: postObjectId, userId: req.currentUser!.userId });
    } catch (error) {
      log.error('Failed to save post synchronously, falling back to queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId: postObjectId,
        userId: req.currentUser!.userId
      });
      postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});
    }

    // Always send response
    res.status(HTTP_STATUS.CREATED).json({
      message: 'Post created with video successfully',
      post: createdPost
    });
  }
}

import { postSchema, postWithImageSchema, postWithVideoSchema } from '@post/schemes/post.schemes';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import HTTP_STATUS from 'http-status-codes';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostCache } from '@service/redis/post.cache';
import { socketIOPostObject } from '@socket/post';
import { postQueue } from '@service/queues/post.queue';
import { UploadApiResponse } from 'cloudinary';
import { uploads, videoUpload } from '@global/helpers/cloudinary-upload';
import cloudinary from 'cloudinary';
import { BadRequestError } from '@global/helpers/error-handler';
import { UserCache } from '@service/redis/user.cache';
import { Helpers } from '@global/helpers/helpers';
import Logger from 'bunyan';
import { config } from '@root/config';

const log: Logger = config.createLogger('createPost');
const postCache: PostCache = new PostCache();
const userCache: UserCache = new UserCache();

export class Create {
  @joiValidation(postSchema)
  public async post(req: Request, res: Response): Promise<void> {
    const { post, bgColor, privacy, gifUrl, profilePicture, feelings } = req.body;

    // Normalize profile picture - use from request body if provided, otherwise get from user cache
    let normalizedProfilePicture = '';
    try {
      if (profilePicture) {
        normalizedProfilePicture = Helpers.normalizeProfilePicture(
          profilePicture,
          req.currentUser!.username,
          req.currentUser!.avatarColor
        );
      } else {
        // Try to get from cache, but don't block if it fails
        const currentUser = await userCache.getUserFromCache(`${req.currentUser!.userId}`).catch(() => null);
        normalizedProfilePicture = currentUser
          ? Helpers.normalizeProfilePicture(currentUser.profilePicture, currentUser.username, currentUser.avatarColor)
          : Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
      }
    } catch (error) {
      // Fallback to initials if normalization fails
      normalizedProfilePicture = Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
    }

    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture: normalizedProfilePicture,
      post,
      bgColor,
      feelings,
      privacy,
      gifUrl,
      commentsCount: 0,
      imgVersion: '',
      imgId: '',
      createdAt: new Date(),
      reactions: { like: 0, love: 0, happy: 0, sad: 0, wow: 0, angry: 0 }
    } as IPostDocument;
    socketIOPostObject.emit('add post', createdPost);
    await postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    });
    postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});
    res.status(HTTP_STATUS.CREATED).json({ message: 'Post created successfully'});
  }

  @joiValidation(postWithImageSchema)
  public async postWithImage(req: Request, res: Response): Promise<void> {
    const { post, bgColor, privacy, gifUrl, profilePicture, feelings, image } = req.body;

    const result: UploadApiResponse = (await uploads(image)) as UploadApiResponse;
    if (!result?.public_id) {
      throw new BadRequestError(result.message || 'Image upload failed');
    }

    // Ensure the uploaded image is set to public access mode
    // This is a safety check in case access_mode wasn't properly set during upload
    if (result.access_mode !== 'public') {
      log.warn(`Image ${result.public_id} was not uploaded as public, attempting to update`);
      try {
        await cloudinary.v2.uploader.explicit(result.public_id, {
          resource_type: 'image',
          type: 'upload',
          access_mode: 'public',
        });
        log.info(`Successfully updated ${result.public_id} to public access`);
      } catch (updateError) {
        log.error(`Failed to update access mode for ${result.public_id}`, updateError);
        // Continue anyway - the upload succeeded, just log the warning
      }
    }

    // Normalize profile picture - use from request body if provided, otherwise get from user cache
    let normalizedProfilePicture = '';
    try {
      if (profilePicture) {
        normalizedProfilePicture = Helpers.normalizeProfilePicture(
          profilePicture,
          req.currentUser!.username,
          req.currentUser!.avatarColor
        );
      } else {
        const currentUser = await userCache.getUserFromCache(`${req.currentUser!.userId}`).catch(() => null);
        normalizedProfilePicture = currentUser
          ? Helpers.normalizeProfilePicture(currentUser.profilePicture, currentUser.username, currentUser.avatarColor)
          : Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
      }
    } catch (error) {
      normalizedProfilePicture = Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
    }

    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture: normalizedProfilePicture,
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
    socketIOPostObject.emit('add post', createdPost);
    await postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    });
    postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});
    // call image queue to add image to mongodb database

    res.status(HTTP_STATUS.CREATED).json({ message: 'Post created with image successfully'});
  }

  @joiValidation(postWithVideoSchema)
  public async postWithVideo(req: Request, res: Response): Promise<void> {
    const { post, bgColor, privacy, gifUrl, profilePicture, feelings, video } = req.body;

    if (!video) {
      throw new BadRequestError('Video is required');
    }

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

    log.info('Starting video upload', {
      videoLength: videoInput?.length,
      isDataURI: videoInput?.startsWith('data:'),
      isURL: videoInput?.startsWith('http'),
      firstChars: videoInput?.substring(0, 50)
    });

    let result: UploadApiResponse;
    try {
      result = (await videoUpload(videoInput)) as UploadApiResponse;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (uploadError: any) {
      log.error('Video upload error', uploadError);
      throw new BadRequestError(uploadError?.message || 'Video upload failed. Please provide a valid video file as a base64 data URI (data:video/mp4;base64,...) or a direct video URL.');
    }

    if (!result?.public_id) {
      log.error('Video upload failed - no public_id returned', result);
      throw new BadRequestError(result?.message || 'Video upload failed. Please provide a valid video file as a base64 data URI (data:video/mp4;base64,...) or a direct video URL.');
    }

    log.info('Video upload successful', {
      public_id: result.public_id,
      version: result.version,
      access_mode: result.access_mode
    });

    // Normalize profile picture - use from request body if provided, otherwise get from user cache
    let normalizedProfilePicture = '';
    try {
      if (profilePicture) {
        normalizedProfilePicture = Helpers.normalizeProfilePicture(
          profilePicture,
          req.currentUser!.username,
          req.currentUser!.avatarColor
        );
      } else {
        const currentUser = await userCache.getUserFromCache(`${req.currentUser!.userId}`).catch(() => null);
        normalizedProfilePicture = currentUser
          ? Helpers.normalizeProfilePicture(currentUser.profilePicture, currentUser.username, currentUser.avatarColor)
          : Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
      }
    } catch (error) {
      normalizedProfilePicture = Helpers.normalizeProfilePicture('', req.currentUser!.username, req.currentUser!.avatarColor);
    }

    const postObjectId: ObjectId = new ObjectId();
    const createdPost: IPostDocument = {
      _id: postObjectId,
      userId: req.currentUser!.userId,
      username: req.currentUser!.username,
      email: req.currentUser!.email,
      avatarColor: req.currentUser!.avatarColor,
      profilePicture: normalizedProfilePicture,
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
    socketIOPostObject.emit('add post', createdPost);
    await postCache.savePostToCache({
      key: postObjectId,
      currentUserId: `${req.currentUser!.userId}`,
      uId: `${req.currentUser!.uId}`,
      createdPost
    });
    postQueue.addPostJob('addPostToDB', { key: req.currentUser!.userId, value: createdPost});

    res.status(HTTP_STATUS.CREATED).json({ message: 'Post created with video successfully'});
  }
}

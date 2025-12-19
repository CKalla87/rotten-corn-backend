import { config } from './../../../config';
import { BaseCache } from '@service/redis/base.cache';
import { ServerError } from '@global/helpers/error-handler';
import Logger from 'bunyan';
import { IPostDocument, ISavePostToCache } from '@post/interfaces/post.interface';
import { Helpers } from '@global/helpers/helpers';
import { RedisCommandRawReply } from '@redis/client/dist/lib/commands';
import { IReactions } from '@reaction/interfaces/reaction.interface';

const log: Logger = config.createLogger('postCache');

export type PostCacheMultiType = string | number | Buffer | RedisCommandRawReply[] | IPostDocument | IPostDocument[];

export class PostCache extends BaseCache {
  constructor() {
    super('postCache');
  }

  public async savePostToCache(data: ISavePostToCache): Promise<void> {
    const { key, currentUserId, uId, createdPost } = data;
    const {
      _id,
      userId,
      username,
      email,
      avatarColor,
      profilePicture,
      post,
      bgColor,
      feelings,
      privacy,
      gifUrl,
      commentsCount,
      imgVersion,
      imgId,
      videoId,
      videoVersion,
      reactions,
      createdAt,
    } = createdPost;

    const firstList: string[] = [
      '_id', `${_id}`,
      'userId', `${userId}`,
      'username', `${username}`,
      'email', `${email}`,
      'avatarColor', `${avatarColor}`,
      'profilePicture', `${profilePicture}`,
      'post', `${post}`,
      'bgColor', `${bgColor}`,
      'feelings', `${feelings}`,
      'privacy', `${privacy}`,
      'gifUrl', `${gifUrl}`,
      'imgVersion', `${imgVersion}`,
      'imgId', `${imgId}`,
      'videoId', `${videoId}`,
      'videoVersion', `${videoVersion}`
    ];

    const secondList: string[] = [
      'commentsCount', `${commentsCount}`,
      'reactions', JSON.stringify(reactions),
      'createdAt', `${createdAt}`
    ];

    const dataToSave: string[] = [...firstList, ...secondList];

    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const postCount: string[] = await this.client.HMGET(`users:${currentUserId}`, 'postsCount');
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      await this.client.ZADD('post', { score: parseInt(uId, 10), value: `${key}`});
      multi.HSET(`posts:${key}`, dataToSave);
      const count: number = parseInt(postCount[0], 10) + 1;
      multi.HSET(`users:${currentUserId}`, 'postsCount', count);
      // Add TTL for cache entries (5 minutes for posts in hosted environments)
      const isHostedEnv = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging' || config.NODE_ENV === 'development';
      if (isHostedEnv) {
        multi.EXPIRE(`posts:${key}`, 300); // 5 minutes TTL
      }
      multi.exec();
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getPostsFromCache(key: string, start: number, end: number): Promise<IPostDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const reply: string[] = await this.client.ZRANGE(key, start, end, { REV: true });

      // If no post IDs found in cache, return empty array (will trigger DB fallback)
      if (!reply || reply.length === 0) {
        return [];
      }

      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      for(const value of reply) {
        multi.HGETALL(`posts:${value}`);
      }
      const replies: PostCacheMultiType = await multi.exec() as PostCacheMultiType;
      const postReplies: IPostDocument[] = [];

      // Filter out empty/null posts (in case some cache entries are missing)
      for(const post of replies as IPostDocument[]) {
        // Skip if post is null, undefined, or doesn't have required fields
        if (!post || !post._id) {
          continue;
        }

        post.commentsCount = Helpers.parseJson(`${post.commentsCount}`) as number;
        // Parse reactions and ensure it has the correct structure
        const parsedReactions = Helpers.parseJson(`${post.reactions}`) as IReactions;
        post.reactions = parsedReactions && typeof parsedReactions === 'object'
          ? {
              like: parsedReactions.like || 0,
              love: parsedReactions.love || 0,
              happy: parsedReactions.happy || 0,
              wow: parsedReactions.wow || 0,
              sad: parsedReactions.sad || 0,
              angry: parsedReactions.angry || 0
            }
          : { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
        post.createdAt = new Date(Helpers.parseJson(`${post.createdAt}`)) as Date;
        // Ensure video fields are set to empty strings if undefined to prevent undefined in URLs
        post.videoVersion = post.videoVersion || '';
        post.videoId = post.videoId || '';
        post.imgVersion = post.imgVersion || '';
        post.imgId = post.imgId || '';
        postReplies.push(post);
      }

      return postReplies;
    } catch (error) {
      // If Redis fails, return empty array to trigger database fallback
      // Don't throw error - allow controller to fall back to database
      log.warn('Failed to get posts from cache, will fall back to database:', error);
      return [];
    }
  }

  public async getTotalPostsInCache(): Promise<number> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const count: number = await this.client.ZCARD('post');
      return count || 0;
    } catch (error) {
      // If Redis fails, return 0 to allow database fallback
      log.warn('Failed to get total posts count from cache:', error);
      return 0;
    }
  }

  public async getPostsWithImagesFromCache(key: string, start: number, end: number): Promise<IPostDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const reply: string[] = await this.client.ZRANGE(key, start, end, { REV: true });
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      for(const value of reply) {
        multi.HGETALL(`posts:${value}`);
      }
      const replies: PostCacheMultiType = await multi.exec() as PostCacheMultiType;
      const postWithImages: IPostDocument[] = [];
      for(const post of replies as IPostDocument[]) {
        if ((post.imgId && post.imgVersion) || post.gifUrl) {
          post.commentsCount = Helpers.parseJson(`${post.commentsCount}`) as number;
          // Parse reactions and ensure it has the correct structure
          const parsedReactions = Helpers.parseJson(`${post.reactions}`) as IReactions;
          post.reactions = parsedReactions && typeof parsedReactions === 'object'
            ? {
                like: parsedReactions.like || 0,
                love: parsedReactions.love || 0,
                happy: parsedReactions.happy || 0,
                wow: parsedReactions.wow || 0,
                sad: parsedReactions.sad || 0,
                angry: parsedReactions.angry || 0
              }
            : { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
          post.createdAt = new Date(Helpers.parseJson(`${post.createdAt}`)) as Date;
          // Ensure video fields are set to empty strings if undefined to prevent undefined in URLs
          post.videoVersion = post.videoVersion || '';
          post.videoId = post.videoId || '';
          post.imgVersion = post.imgVersion || '';
          post.imgId = post.imgId || '';
          postWithImages.push(post);
        }
      }
      return postWithImages;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async getUserPostsFromCache(key: string, uId: number): Promise<IPostDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const reply: string[] = await this.client.ZRANGE(key, uId, uId, { REV: true, BY: 'SCORE' });

      // If no post IDs found in cache, return empty array (will trigger DB fallback)
      if (!reply || reply.length === 0) {
        return [];
      }

      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      for(const value of reply) {
        multi.HGETALL(`posts:${value}`);
      }
      const replies: PostCacheMultiType = await multi.exec() as PostCacheMultiType;
      const postReplies: IPostDocument[] = [];

      // Filter out empty/null posts (in case some cache entries are missing)
      for(const post of replies as IPostDocument[]) {
        // Skip if post is null, undefined, or doesn't have required fields
        if (!post || !post._id) {
          continue;
        }

        post.commentsCount = Number(Helpers.parseJson(`${post.commentsCount}`));
        // Parse reactions and ensure it has the correct structure
        const parsedReactions = Helpers.parseJson(`${post.reactions}`) as IReactions;
        post.reactions = parsedReactions && typeof parsedReactions === 'object'
          ? {
              like: parsedReactions.like || 0,
              love: parsedReactions.love || 0,
              happy: parsedReactions.happy || 0,
              wow: parsedReactions.wow || 0,
              sad: parsedReactions.sad || 0,
              angry: parsedReactions.angry || 0
            }
          : { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
        post.createdAt = new Date(Helpers.parseJson(`${post.createdAt}`)) as Date;
        // Ensure video fields are set to empty strings if undefined to prevent undefined in URLs
        post.videoVersion = post.videoVersion || '';
        post.videoId = post.videoId || '';
        post.imgVersion = post.imgVersion || '';
        post.imgId = post.imgId || '';
        postReplies.push(post);
      }
      return postReplies;
    } catch (error) {
      // If Redis fails, return empty array to trigger database fallback
      // Don't throw error - allow controller to fall back to database
      log.warn('Failed to get user posts from cache, will fall back to database:', error);
      return [];
    }
  }

  public async getTotalUserPostsInCache(uId: number): Promise<number> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const count: number = await this.client.ZCOUNT('post', uId, uId);
      return count || 0;
    } catch (error) {
      // If Redis fails, return 0 to allow database fallback
      log.warn('Failed to get total user posts count from cache:', error);
      return 0;
    }
  }

  public async deletePostFromCache(key: string, currentUserId: string): Promise<void> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      const postCount: string[] = await this.client.HMGET(`users:${currentUserId}`, 'postsCount');
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      multi.ZREM('post', `${key}`);
      multi.DEL(`posts:${key}`);
      multi.DEL(`comments:${key}`);
      multi.DEL(`reactions:${key}`);
      const count: number = parseInt(postCount[0], 10) -1;
      multi.HSET(`users:${currentUserId}`, 'postsCount', count);
      await multi.exec();
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }

  public async updatePostInCache(key: string, updatedPost: IPostDocument): Promise<IPostDocument> {
    const { post, bgColor, feelings, privacy, gifUrl, imgVersion, imgId, profilePicture, videoId, videoVersion } = updatedPost;

    const firstList: string[] = [
      'post', `${post}`,
      'bgColor', `${bgColor}`,
      'feelings', `${feelings}`,
      'privacy', `${privacy}`,
      'gifUrl', `${gifUrl}`,
      'videoId', `${videoId || ''}`,
      'videoVersion', `${videoVersion || ''}`
    ];

    const secondList: string[] = [
      'profilePicture', `${profilePicture || ''}`,
      'imgVersion', `${imgVersion || ''}`,
      'imgId', `${imgId || ''}`
    ];

    const dataToSave: string[] = [...firstList, ...secondList];

    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      // Check if post exists in cache first
      const exists = await this.client.EXISTS(`posts:${key}`);
      if (!exists) {
        log.warn(`Post ${key} not found in cache, returning updated post without cache update`);
        // Return the updated post object even if not in cache
        // This allows the database update to proceed
        return {
          ...updatedPost,
          _id: key,
          commentsCount: 0,
          reactions: { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 },
          createdAt: new Date()
        } as IPostDocument;
      }

      await this.client.HSET(`posts:${key}`, dataToSave);
      const multi = this.client.multi();
      multi.HGETALL(`posts:${key}`);
      const reply: PostCacheMultiType = await multi.exec() as PostCacheMultiType;
      const postReply = reply as IPostDocument[];

      // Check if post was retrieved successfully
      if (!postReply || !postReply[0] || !postReply[0]._id) {
        log.warn(`Post ${key} could not be retrieved from cache after update, returning updated post`);
        return {
          ...updatedPost,
          _id: key,
          commentsCount: 0,
          reactions: { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 },
          createdAt: new Date()
        } as IPostDocument;
      }

      postReply[0].commentsCount = Number(Helpers.parseJson(`${postReply[0].commentsCount}`));
      // Parse reactions and ensure it has the correct structure
      const parsedReactions = Helpers.parseJson(`${postReply[0].reactions}`) as IReactions;
      postReply[0].reactions = parsedReactions && typeof parsedReactions === 'object'
        ? {
            like: parsedReactions.like || 0,
            love: parsedReactions.love || 0,
            happy: parsedReactions.happy || 0,
            wow: parsedReactions.wow || 0,
            sad: parsedReactions.sad || 0,
            angry: parsedReactions.angry || 0
          }
        : { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
      postReply[0].createdAt = new Date(Helpers.parseJson(`${postReply[0].createdAt}`)) as Date;

      // Ensure video/image fields are set
      postReply[0].videoVersion = postReply[0].videoVersion || '';
      postReply[0].videoId = postReply[0].videoId || '';
      postReply[0].imgVersion = postReply[0].imgVersion || '';
      postReply[0].imgId = postReply[0].imgId || '';

      return postReply[0];
    } catch (error) {
      // If cache update fails, return the updated post object anyway
      // This allows the database update to proceed
      log.warn(`Failed to update post ${key} in cache, but continuing with database update:`, error);
      return {
        ...updatedPost,
        _id: key,
        commentsCount: 0,
        reactions: { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 },
        createdAt: new Date()
      } as IPostDocument;
    }

  }

  public async getPostsWithVideoFromCache(key: string, start: number, end: number): Promise<IPostDocument[]> {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const reply: string[] = await this.client.ZRANGE(key, start, end, { REV: true });
      const multi: ReturnType<typeof this.client.multi> = this.client.multi();
      for(const value of reply) {
        multi.HGETALL(`posts:${value}`);
      }
      const replies: PostCacheMultiType = await multi.exec() as PostCacheMultiType;
      const postWithVideos: IPostDocument[] = [];
      for(const post of replies as IPostDocument[]) {
        // Ensure video fields are set to empty strings if undefined to prevent undefined in URLs
        post.videoVersion = post.videoVersion || '';
        post.videoId = post.videoId || '';
        post.imgVersion = post.imgVersion || '';
        post.imgId = post.imgId || '';
        if (post.videoId && post.videoVersion) {
          post.commentsCount = Helpers.parseJson(`${post.commentsCount}`) as number;
          // Parse reactions and ensure it has the correct structure
          const parsedReactions = Helpers.parseJson(`${post.reactions}`) as IReactions;
          post.reactions = parsedReactions && typeof parsedReactions === 'object'
            ? {
                like: parsedReactions.like || 0,
                love: parsedReactions.love || 0,
                happy: parsedReactions.happy || 0,
                wow: parsedReactions.wow || 0,
                sad: parsedReactions.sad || 0,
                angry: parsedReactions.angry || 0
              }
            : { like: 0, love: 0, happy: 0, wow: 0, sad: 0, angry: 0 };
          post.createdAt = new Date(Helpers.parseJson(`${post.createdAt}`)) as Date;
          // Ensure video fields are set (should already be set for video posts, but ensure they're not undefined)
          post.videoVersion = post.videoVersion || '';
          post.videoId = post.videoId || '';
          post.imgVersion = post.imgVersion || '';
          post.imgId = post.imgId || '';
          postWithVideos.push(post);
        }
      }
      return postWithVideos;
    } catch (error) {
      log.error(error);
      throw new ServerError('Server error. Try again.');
    }
  }
}

import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostCache } from '@service/redis/post.cache';
import { postService } from '@service/db/post.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const postCache: PostCache = new PostCache();
const log: Logger = config.createLogger('getPosts');
const PAGE_SIZE = 10;

export class Get {
  public async posts(req: Request, res: Response): Promise<void> {
    const { page } = req.params;
    const skip: number = (parseInt(page) - 1) * PAGE_SIZE;
    const limit: number = PAGE_SIZE * parseInt(page);
    const newSkip: number = skip === 0 ? skip : skip + 1;
    let posts: IPostDocument[] = [];
    let totalPosts = 0;

    log.info(`Fetching posts: page=${page}, skip=${skip}, limit=${limit}, newSkip=${newSkip}`);

    // Try cache first, but always fall back to database if cache is empty or fails
    try {
      const cachedPosts: IPostDocument[] = await postCache.getPostsFromCache('post', newSkip, limit);
      log.info(`Cache returned ${cachedPosts.length} posts`);

      if (cachedPosts.length > 0) {
        posts = cachedPosts;
        try {
          totalPosts = await postCache.getTotalPostsInCache();
          log.info(`Total posts from cache: ${totalPosts}`);
        } catch (error) {
          // If cache count fails, get from database
          log.warn('Failed to get total posts from cache, using database', error);
          totalPosts = await postService.postsCount();
        }
      } else {
        // Cache is empty or failed - get from database
        log.info('Cache is empty, fetching from database');
        posts = await postService.getPosts({}, skip, limit, { createdAt: -1 });
        totalPosts = await postService.postsCount();
        log.info(`Database returned ${posts.length} posts, total: ${totalPosts}`);
      }
    } catch (error) {
      // If cache completely fails, get from database
      log.error('Cache operation failed, falling back to database', error);
      posts = await postService.getPosts({}, skip, limit, { createdAt: -1 });
      totalPosts = await postService.postsCount();
      log.info(`Database returned ${posts.length} posts after cache failure, total: ${totalPosts}`);
    }

    log.info(`Returning ${posts.length} posts to client, totalPosts: ${totalPosts}`);
    res.status(HTTP_STATUS.OK).json({ message: 'All posts', posts, totalPosts});
  }

  public async postsWithImages(req: Request, res: Response): Promise<void> {
    const { page } = req.params;
    const skip: number = (parseInt(page) - 1) * PAGE_SIZE;
    const limit: number = PAGE_SIZE * parseInt(page);
    const newSkip: number = skip === 0 ? skip : skip + 1;
    let posts: IPostDocument[] = [];
    const cachedPosts: IPostDocument[] = await postCache.getPostsWithImagesFromCache('post', newSkip, limit);
    posts = cachedPosts.length ? cachedPosts : await postService.getPosts({ imgId: '$ne', gifUrl: '$ne'}, skip, limit, { createdAt: -1 });
    res.status(HTTP_STATUS.OK).json({ message: 'All posts with images', posts });
  }

  public async postsWithVideo(req: Request, res: Response): Promise<void> {
    const { page } = req.params;
    const skip: number = (parseInt(page) - 1) * PAGE_SIZE;
    const limit: number = PAGE_SIZE * parseInt(page);
    const newSkip: number = skip === 0 ? skip : skip + 1;
    let posts: IPostDocument[] = [];
    const cachedPosts: IPostDocument[] = await postCache.getPostsWithVideoFromCache('post', newSkip, limit);
    posts = cachedPosts.length ? cachedPosts : await postService.getPosts({ videoId: '$ne' }, skip, limit, { createdAt: -1 });
    res.status(HTTP_STATUS.OK).json({ message: 'All posts with videos', posts });
  }
}

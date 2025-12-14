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
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const { page } = req.params;
      const skip: number = (parseInt(page) - 1) * PAGE_SIZE;
      const limit: number = PAGE_SIZE * parseInt(page);
      const newSkip: number = skip === 0 ? skip : skip + 1;
      let posts: IPostDocument[] = [];
      let totalPosts = 0;

      // Skip cache entirely - go directly to database for instant response
      // Cache can be slow, database is faster and more reliable
      try {
        posts = await postService.getPosts({}, skip, limit, { createdAt: -1 });
        totalPosts = await postService.postsCount();
        log.info('Posts retrieved from database', { page, count: posts.length });
      } catch (dbError) {
        log.error('Database operation failed', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          page
        });
        // Return empty results rather than failing completely
        posts = [];
        totalPosts = 0;
      }

      res.status(HTTP_STATUS.OK).json({ message: 'All posts', posts, totalPosts });
    } catch (error) {
      log.error('Unexpected error in posts endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        page: req.params.page
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching posts',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
  }

  public async postsWithImages(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    try {
      const { page } = req.params;
      const skip: number = (parseInt(page) - 1) * PAGE_SIZE;
      const limit: number = PAGE_SIZE * parseInt(page);
      const newSkip: number = skip === 0 ? skip : skip + 1;
      let posts: IPostDocument[] = [];

      // Skip cache - go directly to database for instant response
      try {
        posts = await postService.getPosts({ imgId: '$ne', gifUrl: '$ne' }, skip, limit, { createdAt: -1 });
        log.info('Posts with images retrieved from database', { page, count: posts.length });
      } catch (dbError) {
        log.error('Database operation failed', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          page
        });
        // Return empty results rather than failing completely
        posts = [];
      }

      res.status(HTTP_STATUS.OK).json({ message: 'All posts with images', posts });
    } catch (error) {
      log.error('Unexpected error in postsWithImages endpoint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        page: req.params.page
      });
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: 'Error fetching posts with images',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    }
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

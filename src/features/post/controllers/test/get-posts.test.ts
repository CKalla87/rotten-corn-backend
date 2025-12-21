import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { newPost, postMockData, postMockRequest, postMockResponse } from '@root/mocks/post.mock';
import { PostCache } from '@service/redis/post.cache';
import { Get } from '@post/controllers/get-posts';
import { postService } from '@service/db/post.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/post.cache');

describe('Get', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('posts', () => {
    it('should send correct json response with posts from database', async () => {
      const req: Request = postMockRequest(newPost, authUserPayload, { page: '1' }) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postService, 'getPosts').mockResolvedValue([postMockData]);
      jest.spyOn(postService, 'postsCount').mockResolvedValue(1);

      await Get.prototype.posts(req, res);
      expect(postService.getPosts).toHaveBeenCalledWith({}, 0, 10, { createdAt: -1 });
      expect(postService.postsCount).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'All posts',
        posts: [postMockData],
        totalPosts: 1
      });
    });

    it('should send empty posts', async () => {
      const req: Request = postMockRequest(newPost, authUserPayload, { page: '1' }) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postService, 'getPosts').mockResolvedValue([]);
      jest.spyOn(postService, 'postsCount').mockResolvedValue(0);

      await Get.prototype.posts(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'All posts',
        posts: [],
        totalPosts: 0
      });
    });
  });

  describe('postWithImages', () => {
    it('should send correct json response with posts from database', async () => {
      const req: Request = postMockRequest(newPost, authUserPayload, { page: '1' }) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postService, 'getPosts').mockResolvedValue([postMockData]);

      await Get.prototype.postsWithImages(req, res);
      expect(postService.getPosts).toHaveBeenCalledWith({ imgId: '$ne', gifUrl: '$ne' }, 0, 10, { createdAt: -1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'All posts with images',
        posts: [postMockData]
      });
    });

    it('should send empty posts', async () => {
      const req: Request = postMockRequest(newPost, authUserPayload, { page: '1' }) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postService, 'getPosts').mockResolvedValue([]);

      await Get.prototype.postsWithImages(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'All posts with images',
        posts: []
      });
    });
  });
});

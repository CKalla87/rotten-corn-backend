import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { commentNames, commentsData, reactionMockRequest, reactionMockResponse } from '@root/mocks/reactions.mock';
import { CommentCache } from '@service/redis/comment.cache';
import { Get } from '@comment/controllers/get-comments';
import { commentService } from '@service/db/comment.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/comment.cache');

describe('Get', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('comments', () => {
    it('should send correct json response if comments exist in database', async () => {
      const req: Request = reactionMockRequest({}, {}, authUserPayload, {
        postId: '6027f77087c9d9ccb1555268'
      }) as Request;
      const res: Response = reactionMockResponse();
      // Implementation always fetches from database (no cache)
      // Mock returns a mongoose-like document with toObject method
      const mockComment = {
        ...commentsData,
        toObject: jest.fn().mockReturnValue(commentsData)
      };
      jest.spyOn(commentService, 'getPostComments').mockResolvedValue([mockComment] as any);

      await Get.prototype.comments(req, res);
      expect(commentService.getPostComments).toHaveBeenCalledWith(
        { postId: new mongoose.Types.ObjectId('6027f77087c9d9ccb1555268') },
        { createdAt: 1 }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      // Implementation adds reaction array to each comment
      expect(res.json).toHaveBeenCalledWith({
        message: 'Post comments',
        comments: [{ ...commentsData, reaction: [] }]
      });
    });
  });

  describe('commentsNamesFromCache', () => {
    it('should send correct json response from database (cache is skipped)', async () => {
      const req: Request = reactionMockRequest({}, {}, authUserPayload, {
        postId: '6027f77087c9d9ccb1555268'
      }) as Request;
      const res: Response = reactionMockResponse();
      jest.spyOn(commentService, 'getPostCommentNames').mockResolvedValue([commentNames]);

      await Get.prototype.commentsNamesFromCache(req, res);
      expect(commentService.getPostCommentNames).toHaveBeenCalledWith(
        { postId: new mongoose.Types.ObjectId('6027f77087c9d9ccb1555268') },
        { createdAt: -1 }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Post comments names',
        comments: [commentNames]
      });
    });

    it('should send correct json response with empty comments if data does not exist', async () => {
      const req: Request = reactionMockRequest({}, {}, authUserPayload, {
        postId: '6027f77087c9d9ccb1555268'
      }) as Request;
      const res: Response = reactionMockResponse();
      jest.spyOn(commentService, 'getPostCommentNames').mockResolvedValue([]);

      await Get.prototype.commentsNamesFromCache(req, res);
      expect(commentService.getPostCommentNames).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Post comments names',
        comments: []
      });
    });
  });

  describe('singleComment', () => {
    it('should send correct json response from database (cache is skipped)', async () => {
      const req: Request = reactionMockRequest({}, {}, authUserPayload, {
        commentId: '6064861bc25eaa5a5d2f9bf4',
        postId: '6027f77087c9d9ccb1555268'
      }) as Request;
      const res: Response = reactionMockResponse();
      jest.spyOn(commentService, 'getPostComments').mockResolvedValue([commentsData]);

      await Get.prototype.singleComment(req, res);
      expect(commentService.getPostComments).toHaveBeenCalledWith(
        { _id: new mongoose.Types.ObjectId('6064861bc25eaa5a5d2f9bf4') },
        { createdAt: -1 }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Single comment',
        comments: commentsData
      });
    });
  });
});

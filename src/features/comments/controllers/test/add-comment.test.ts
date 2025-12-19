import { Request, Response } from 'express';
import { authUserPayload } from '@root/mocks/auth.mock';
import { reactionMockRequest, reactionMockResponse } from '@root/mocks/reactions.mock';
import { CommentCache } from '@service/redis/comment.cache';
import { commentQueue } from '@service/queues/comment.queue';
import { Add } from '../add-comments';
import { existingUser } from '@root/mocks/user.mock';
import { commentService } from '@service/db/comment.service';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/comment.cache');
jest.mock('@service/db/comment.service');

describe('Add', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('should call addCommentToDB to save to database first', async () => {
    const req: Request = reactionMockRequest(
      {},
      {
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment',
        profilePicture: 'https://place-hold.it/500x500',
        userTo: `${existingUser._id}`
      },
      authUserPayload
    ) as unknown as Request;
    const res: Response = reactionMockResponse();
    jest.spyOn(commentService, 'addCommentToDB').mockResolvedValue();
    jest.spyOn(CommentCache.prototype, 'savePostCommentToCache').mockResolvedValue();

    await Add.prototype.comment(req, res);
    expect(commentService.addCommentToDB).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Comment created successfully',
      comment: expect.objectContaining({
        username: authUserPayload.username,
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment'
      })
    });
  });

  it('should fallback to queue if database save fails', async () => {
    const req: Request = reactionMockRequest(
      {},
      {
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment',
        profilePicture: 'https://place-hold.it/500x500',
        userTo: `${existingUser._id}`
      },
      authUserPayload
    ) as unknown as Request;
    const res: Response = reactionMockResponse();
    jest.spyOn(commentService, 'addCommentToDB').mockRejectedValue(new Error('Database error'));
    jest.spyOn(commentQueue, 'addCommentJob');

    await Add.prototype.comment(req, res);
    expect(commentService.addCommentToDB).toHaveBeenCalled();
    expect(commentQueue.addCommentJob).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Comment created successfully',
      comment: expect.objectContaining({
        username: authUserPayload.username,
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment'
      })
    });
  });

  it('should send correct json response', async () => {
    const req: Request = reactionMockRequest(
      {},
      {
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment',
        profilePicture: 'https://place-hold.it/500x500',
        userTo: `${existingUser._id}`
      },
      authUserPayload
    ) as unknown as Request;
    const res: Response = reactionMockResponse();
    jest.spyOn(commentService, 'addCommentToDB').mockResolvedValue();
    jest.spyOn(CommentCache.prototype, 'savePostCommentToCache').mockResolvedValue();

    await Add.prototype.comment(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Comment created successfully',
      comment: expect.objectContaining({
        username: authUserPayload.username,
        postId: '6027f77087c9d9ccb1555268',
        comment: 'This is a comment'
      })
    });
  });
});

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { authUserPayload } from '@root/mocks/auth.mock';
import { reactionMockRequest, reactionMockResponse } from '@root/mocks/reactions.mock';
import { ReactionCache } from '@service/redis/reaction.cache';
import { reactionQueue } from '@service/queues/reaction.queue';
import { reactionService } from '@service/db/reaction.services';
import { Add } from '@reaction/controllers/add-reactions';
import { config } from '@root/config';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/reaction.cache');
jest.mock('@service/db/reaction.services');
jest.mock('@root/config', () => ({
  config: {
    CLOUD_NAME: 'dajmo61zu',
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }))
  }
}));

describe('AddReaction', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('should send correct json response', async () => {
    const req: Request = reactionMockRequest(
      {},
      {
        postId: '6027f77087c9d9ccb1555268',
        previousReaction: 'love',
        profilePicture: 'http://place-hold.it/500x500',
        userTo: '60263f14648fed5246e322d9',
        type: 'like',
        postReactions: {
          like: 1,
          love: 0,
          happy: 0,
          wow: 0,
          sad: 0,
          angry: 0
        }
      },
      authUserPayload
    ) as unknown as Request;
    const res: Response = reactionMockResponse();
    jest.spyOn(ReactionCache.prototype, 'savePostReactionToCache').mockResolvedValue();
    jest.spyOn(reactionService, 'addReactionDataToDB').mockResolvedValue();
    jest.spyOn(reactionQueue, 'addReactionJob');

    await Add.prototype.reaction(req, res);

    // Verify database was updated synchronously first
    expect(reactionService.addReactionDataToDB).toHaveBeenCalled();

    // Verify cache was updated asynchronously (fire-and-forget)
    expect(ReactionCache.prototype.savePostReactionToCache).toHaveBeenCalled();

    // Verify queue was NOT called (since addReactionDataToDB succeeded)
    expect(reactionQueue.addReactionJob).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json as jest.Mock;
    const responseData = jsonCall.mock.calls[0][0];

    // Verify postId in reaction is now an ObjectId (converted from string)
    expect(responseData.reaction.postId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(responseData.reaction.postId.toString()).toBe('6027f77087c9d9ccb1555268');

    expect(responseData.message).toBe('Reaction added successfully');
    expect(responseData.reaction.username).toBe(authUserPayload.username);
    expect(responseData.reaction.type).toBe('like');
    expect(responseData.reaction.postId.toString()).toBe('6027f77087c9d9ccb1555268');
  });

  it('should normalize Cloudinary URL with wrong cloud name', async () => {
    const wrongCloudNameUrl = 'https://res.cloudinary.com/dyamr9ym3/image/upload/v1764047003/6925389b8984fb7dda7158a0';
    const req: Request = reactionMockRequest(
      {},
      {
        postId: '6027f77087c9d9ccb1555268',
        previousReaction: '',
        profilePicture: wrongCloudNameUrl,
        userTo: '60263f14648fed5246e322d9',
        type: 'like',
        postReactions: {
          like: 1,
          love: 0,
          happy: 0,
          wow: 0,
          sad: 0,
          angry: 0
        }
      },
      authUserPayload
    ) as unknown as Request;
    const res: Response = reactionMockResponse();
    const cacheSpy = jest.spyOn(ReactionCache.prototype, 'savePostReactionToCache').mockResolvedValue();
    const dbSpy = jest.spyOn(reactionService, 'addReactionDataToDB').mockResolvedValue();

    await Add.prototype.reaction(req, res);

    // Verify database was called with normalized URL
    expect(reactionService.addReactionDataToDB).toHaveBeenCalled();
    const dbCall = dbSpy.mock.calls[0][0] as any;

    // Verify postId in reactionObject is now an ObjectId (converted from string)
    expect(dbCall.reactionObject.postId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(dbCall.reactionObject.postId.toString()).toBe('6027f77087c9d9ccb1555268');

    expect(dbCall.reactionObject.profilePicture).toBe(`https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v1764047003/6925389b8984fb7dda7158a0`);
    expect(dbCall.reactionObject.profilePicture).not.toContain('dyamr9ym3');
    expect(dbCall.reactionObject.profilePicture).toContain('dajmo61zu');

    // Verify cache was also called with normalized URL
    expect(ReactionCache.prototype.savePostReactionToCache).toHaveBeenCalled();
    const cacheCall = cacheSpy.mock.calls[0][1] as any;

    // Verify postId in cache reaction is also an ObjectId
    expect(cacheCall.postId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(cacheCall.postId.toString()).toBe('6027f77087c9d9ccb1555268');

    expect(cacheCall.profilePicture).toBe(`https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v1764047003/6925389b8984fb7dda7158a0`);
    expect(cacheCall.profilePicture).not.toContain('dyamr9ym3');
    expect(cacheCall.profilePicture).toContain('dajmo61zu');
  });
});

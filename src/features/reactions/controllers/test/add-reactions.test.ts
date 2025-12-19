import { Request, Response } from 'express';
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
    ) as Request;
    const res: Response = reactionMockResponse();
    const spy = jest.spyOn(ReactionCache.prototype, 'savePostReactionToCache');
    jest.spyOn(reactionService, 'addReactionDataToDB').mockResolvedValue();
    const reactionSpy = jest.spyOn(reactionQueue, 'addReactionJob');

    await Add.prototype.reaction(req, res);

    // Verify cache was updated
    expect(ReactionCache.prototype.savePostReactionToCache).toHaveBeenCalledWith(
      spy.mock.calls[0][0],
      spy.mock.calls[0][1],
      spy.mock.calls[0][2],
      spy.mock.calls[0][3],
      spy.mock.calls[0][4]
    );

    // Verify database was updated synchronously
    expect(reactionService.addReactionDataToDB).toHaveBeenCalled();

    // Verify queue was NOT called (since addReactionDataToDB succeeded)
    expect(reactionQueue.addReactionJob).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Reaction added successfully'
    });
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
    const spy = jest.spyOn(ReactionCache.prototype, 'savePostReactionToCache');
    jest.spyOn(reactionService, 'addReactionDataToDB').mockResolvedValue();

    await Add.prototype.reaction(req, res);

    // Verify the profile picture URL was normalized to use correct cloud name
    const savedReaction = spy.mock.calls[0][1];
    expect(savedReaction.profilePicture).toBe(`https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v1764047003/6925389b8984fb7dda7158a0`);
    expect(savedReaction.profilePicture).not.toContain('dyamr9ym3');
    expect(savedReaction.profilePicture).toContain('dajmo61zu');
  });
});

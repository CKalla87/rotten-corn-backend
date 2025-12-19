import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { IReactionDocument } from '@reaction/interfaces/reaction.interface';
import { ReactionCache } from '@service/redis/reaction.cache';
import { reactionService } from '@service/db/reaction.services';
import mongoose from 'mongoose';
import { BadRequestError } from '@global/helpers/error-handler';
import { config } from '@root/config';
import Logger from 'bunyan';

const reactionCache: ReactionCache = new ReactionCache();
const log: Logger = config.createLogger('getReactions');

export class Get {
  public async reactions(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { postId } = req.params;

    // Validate postId format
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError('Invalid post ID format');
    }

    try {
      // Skip cache - go directly to database for immediate consistency
      // Database query is now optimized with find() and indexes
      const reactions: [IReactionDocument[], number] = await reactionService.getPostReactions(
        { postId: new mongoose.Types.ObjectId(postId) },
        { createdAt: -1 }
      );
      res.status(HTTP_STATUS.OK).json({ message: 'Post reactions', reactions: reactions[0], count: reactions[1] });
    } catch (error) {
      log.error('Failed to get post reactions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  public async singleReactionByUsername(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { postId, username } = req.params;

    // Validate postId format
    if (!postId || !mongoose.Types.ObjectId.isValid(postId)) {
      throw new BadRequestError('Invalid post ID format');
    }

    if (!username || username.trim() === '') {
      throw new BadRequestError('Username is required');
    }

    try {
      // Skip cache - go directly to database for faster response
      // Database query is now optimized with findOne() and compound index
      const reactions: [IReactionDocument, number] | [] = await reactionService.getSinglePostReactionByUsername(postId, username);
      res.status(HTTP_STATUS.OK).json({
        message: 'Single post reaction by username',
        reactions: reactions.length ? reactions[0] : {},
        count: reactions.length ? reactions[1] : 0
      });
    } catch (error) {
      log.error('Failed to get single post reaction by username', {
        error: error instanceof Error ? error.message : 'Unknown error',
        postId,
        username,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  public async reactionsByUsername(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const { username } = req.params;

    if (!username || username.trim() === '') {
      throw new BadRequestError('Username is required');
    }

    try {
      const reactions: IReactionDocument[] = await reactionService.getReactionsByUsername(username);
      res.status(HTTP_STATUS.OK).json({
        message: 'All user reactions by username',
        reactions
      });
    } catch (error) {
      log.error('Failed to get reactions by username', {
        error: error instanceof Error ? error.message : 'Unknown error',
        username,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { authUserPayload } from '@root/mocks/auth.mock';
import * as postServer from '@socket/post';
import { newPost, postMockRequest, postMockResponse } from '@root/mocks/post.mock';
import { postQueue } from '@service/queues/post.queue';
import { postService } from '@service/db/post.service';
import { Create } from '@post/controllers/create-post';
import { PostCache } from '@service/redis/post.cache';
import { CustomError } from '@global/helpers/error-handler';
import * as cloudinaryUploads from '@global/helpers/cloudinary-upload';

jest.useFakeTimers();
jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/post.cache');
jest.mock('@service/db/post.service');
jest.mock('@global/helpers/cloudinary-upload');

Object.defineProperties(postServer, {
  socketIOPostObject: {
    value: new Server(),
    writable: true
  }
});

describe('Create', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('post', () => {
    it('should send correct json response', async () => {
      const req: Request = postMockRequest(newPost, authUserPayload) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postServer.socketIOPostObject, 'emit');
      const spy = jest.spyOn(PostCache.prototype, 'savePostToCache').mockResolvedValue();
      jest.spyOn(postService, 'addPostToDB').mockResolvedValue();
      jest.spyOn(postQueue, 'addPostJob');

      await Create.prototype.post(req, res);
      const createdPost = spy.mock.calls[0][0].createdPost;

      // Verify socket emit
      expect(postServer.socketIOPostObject.emit).toHaveBeenCalledWith('add post', createdPost);

      // Verify cache was saved
      expect(PostCache.prototype.savePostToCache).toHaveBeenCalledWith({
        key: spy.mock.calls[0][0].key,
        currentUserId: `${req.currentUser?.userId}`,
        uId: `${req.currentUser?.uId}`,
        createdPost
      });

      // Verify database was saved synchronously
      expect(postService.addPostToDB).toHaveBeenCalledWith(`${req.currentUser?.userId}`, createdPost);

      // Verify userId in createdPost is now an ObjectId (converted from string)
      expect(createdPost.userId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(createdPost.userId.toString()).toBe(req.currentUser?.userId);

      // Verify queue was NOT called (since addPostToDB succeeded)
      expect(postQueue.addPostJob).not.toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Post created successfully',
        post: createdPost
      });
    });
  });

  describe('postWithImage', () => {
    it('should throw an error if image is not available', () => {
      delete newPost.image;
      const req: Request = postMockRequest(newPost, authUserPayload) as unknown as Request;
      const res: Response = postMockResponse();

      Create.prototype.postWithImage(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Image is a required field');
      });
    });

    it('should throw an upload error', () => {
      newPost.image = 'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==';
      const req: Request = postMockRequest(newPost, authUserPayload) as unknown as Request;
      const res: Response = postMockResponse();
      jest
        .spyOn(cloudinaryUploads, 'uploads')
        .mockImplementation((): any => Promise.resolve({ version: '', public_id: '', message: 'Upload error' }));

      Create.prototype.postWithImage(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Upload error');
      });
    });

    it('should send correct json response', async () => {
      newPost.image = 'testing image';
      const req: Request = postMockRequest(newPost, authUserPayload) as unknown as Request;
      const res: Response = postMockResponse();
      jest.spyOn(postServer.socketIOPostObject, 'emit');
      const spy = jest.spyOn(PostCache.prototype, 'savePostToCache').mockResolvedValue();
      jest.spyOn(postService, 'addPostToDB').mockResolvedValue();
      jest.spyOn(postQueue, 'addPostJob');
      jest.spyOn(cloudinaryUploads, 'uploads').mockImplementation((): any => Promise.resolve({ version: '1234', public_id: '123456' }));

      await Create.prototype.postWithImage(req, res);
      const createdPost = spy.mock.calls[0][0].createdPost;

      // Verify socket emit
      expect(postServer.socketIOPostObject.emit).toHaveBeenCalledWith('add post', createdPost);

      // Verify cache was saved
      expect(PostCache.prototype.savePostToCache).toHaveBeenCalledWith({
        key: spy.mock.calls[0][0].key,
        currentUserId: `${req.currentUser?.userId}`,
        uId: `${req.currentUser?.uId}`,
        createdPost
      });

      // Verify database was saved synchronously
      expect(postService.addPostToDB).toHaveBeenCalledWith(`${req.currentUser?.userId}`, createdPost);

      // Verify userId in createdPost is now an ObjectId (converted from string)
      expect(createdPost.userId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(createdPost.userId.toString()).toBe(req.currentUser?.userId);

      // Verify queue was NOT called (since addPostToDB succeeded)
      expect(postQueue.addPostJob).not.toHaveBeenCalled();

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Post created with image successfully',
        post: createdPost
      });
    });
  });
});

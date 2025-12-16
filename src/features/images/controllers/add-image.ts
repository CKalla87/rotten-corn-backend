import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { UploadApiResponse } from 'cloudinary';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import { addImageSchema } from '@image/schemes/image.schemes';
import { uploads } from '@global/helpers/cloudinary-upload';
import { BadRequestError } from '@global/helpers/error-handler';
import { UserCache } from '@service/redis/user.cache';
import { IUserDocument } from '@user/interfaces/user.interface';
import { socketIOImageObject } from '@socket/image';
import { imageQueue } from '@service/queues/image.queue';
import { config } from '@root/config';
import { IBgUploadResponse } from '@image/interfaces/image.interface';
import { Helpers } from '@global/helpers/helpers';

const userCache: UserCache = new UserCache();

export class Add {
  @joiValidation(addImageSchema)
  public async profileImage(req: Request, res: Response): Promise<void> {
    const result: UploadApiResponse = (await uploads(
      req.body.image,
      req.currentUser!.userId,
      true,
      true
    )) as UploadApiResponse;

    if (!result?.public_id) {
      throw new BadRequestError('File upload: Error occurred. Try again.');
    }

    const url = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/v${result.version}/${result.public_id}`;
    const cachedUser: IUserDocument = (await userCache.updateSingleUserItemInCache(
      `${req.currentUser!.userId}`,
      'profilePicture',
      url
    )) as IUserDocument;

    socketIOImageObject.emit('update user', cachedUser);
    imageQueue.addImageJob('addUserProfileImageToDB', {
      key: `${req.currentUser!.userId}`,
      value: url,
      imgId: result.public_id,
      imgVersion: result.version.toString()
    });
    res.status(HTTP_STATUS.OK).json({ message: 'Image added successfully' });
  }

  @joiValidation(addImageSchema)
  public async backgroundImage(req: Request, res: Response): Promise<void> {
    const { version, publicId }: IBgUploadResponse = await Add.backgroundUpload(req.body.image);
    await userCache.updateSingleUserItemInCache(`${req.currentUser!.userId}`, 'bgImageVersion', version);
    const cachedUser: IUserDocument = (await userCache.updateSingleUserItemInCache(
      `${req.currentUser!.userId}`,
      'bgImageId',
      publicId
    )) as IUserDocument;
    socketIOImageObject.emit('update user', cachedUser);
    imageQueue.addImageJob('updateBGImageInDB', {
      key: `${req.currentUser!.userId}`,
      value: '',
      imgId: publicId,
      imgVersion: version
    });
    res.status(HTTP_STATUS.OK).json({ message: 'Image added successfully' });
  }

  private static async backgroundUpload(image: string): Promise<IBgUploadResponse> {
    const isDataURL = Helpers.isDataURL(image);
    const isCloudinaryUrl = Helpers.isCloudinaryUrl(image);
    let version = '';
    let publicId = '';

    if (isDataURL || !isCloudinaryUrl) {
      const result: UploadApiResponse = (await uploads(image)) as UploadApiResponse;
      if (!result?.public_id) {
        throw new BadRequestError(result?.message || 'File upload: Error occurred. Try again.');
      } else {
        version = result.version.toString();
        publicId = result.public_id;
      }
    } else {
      const value = image.split('/');
      version = value[value.length - 2];
      publicId = value[value.length - 1];
    }

    return { version: version.replace(/v/g, ''), publicId };
  }
}

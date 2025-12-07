import cloudinary, { UploadApiResponse, UploadApiErrorResponse} from 'cloudinary';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('cloudinaryUpload');

export function uploads(
  file: string,
  public_id?: string,
  overwrite?: boolean,
  invalidate?: boolean,
): Promise<UploadApiResponse | UploadApiErrorResponse | undefined> {
  return new Promise((resolve) => {
    const uploadOptions: any = {
      public_id,
      overwrite,
      invalidate,
      access_mode: 'public',
      resource_type: 'image',
      type: 'upload',
      // Explicitly set to ensure public access
      eager: [],
      eager_async: false,
    };

    log.info('Uploading to Cloudinary', {
      public_id,
      overwrite,
      invalidate,
      access_mode: 'public',
      resource_type: 'image',
    });

    cloudinary.v2.uploader.upload(
      file,
      uploadOptions,
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
         if (error) {
           log.error('Cloudinary upload error', error);
           resolve(error);
         }
         if (result) {
           log.info('Cloudinary upload success', {
             public_id: result.public_id,
             version: result.version,
             secure_url: result.secure_url,
             access_mode: result.access_mode,
             url: result.url
           });

           // Immediately update to public if not already public
           if (result.access_mode !== 'public' && result.public_id) {
             log.info(`Updating ${result.public_id} to public access immediately after upload`);
             cloudinary.v2.uploader.explicit(
               result.public_id,
               {
                 resource_type: 'image',
                 type: 'upload',
                 access_mode: 'public',
               },
               (updateError, updateResult) => {
                 if (updateError) {
                   log.error(`Failed to update ${result.public_id} to public`, updateError);
                 } else {
                   log.info(`Successfully updated ${result.public_id} to public access`);
                 }
               }
             );
           }
         }
         resolve(result);
      }
    );
  });
}

export function videoUpload(
  file: string,
  public_id?: string,
  overwrite?: boolean,
  invalidate?: boolean
): Promise<UploadApiResponse | UploadApiErrorResponse | undefined> {
  return new Promise((resolve) => {
    const uploadOptions: any = {
      resource_type: 'video',
      chunk_size: 50000,
      public_id,
      overwrite,
      invalidate,
      access_mode: 'public',
      type: 'upload',
    };

    log.info('Uploading video to Cloudinary', {
      public_id,
      overwrite,
      invalidate,
      access_mode: 'public',
      resource_type: 'video',
      fileLength: file?.length,
      isDataURI: file?.startsWith('data:'),
    });

    cloudinary.v2.uploader.upload(
      file,
      uploadOptions,
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
         if (error) {
           log.error('Cloudinary video upload error', {
             message: error.message,
             http_code: error.http_code,
             name: error.name,
             error
           });
           resolve(error);
           return;
         }
         if (result) {
           log.info('Cloudinary video upload success', {
             public_id: result.public_id,
             version: result.version,
             secure_url: result.secure_url,
             access_mode: result.access_mode,
             url: result.url,
             format: result.format,
             resource_type: result.resource_type
           });

           // Immediately update to public if not already public
           if (result.access_mode !== 'public' && result.public_id) {
             log.info(`Updating video ${result.public_id} to public access immediately after upload`);
             cloudinary.v2.uploader.explicit(
               result.public_id,
               {
                 resource_type: 'video',
                 type: 'upload',
                 access_mode: 'public',
               },
               (updateError, updateResult) => {
                 if (updateError) {
                   log.error(`Failed to update video ${result.public_id} to public`, updateError);
                 } else {
                   log.info(`Successfully updated video ${result.public_id} to public access`);
                 }
               }
             );
           }
         }
         resolve(result);
      }
    );
  });
}

/**
 * Generate a Cloudinary URL for an image using the Cloudinary SDK URL helper
 * @param publicId - The public ID of the image
 * @param version - Optional version number
 * @returns The Cloudinary URL for the image
 */
export function getCloudinaryImageUrl(publicId: string, version?: string | number): string {
  if (!publicId) {
    return '';
  }

  try {
    const url = cloudinary.v2.url(publicId, {
      resource_type: 'image',
      type: 'upload',
      version: version ? Number(version) : undefined,
      secure: true,
    });
    return url;
  } catch (error) {
    // Fallback to manual URL construction if SDK fails
    const versionStr = version ? `/v${version}` : '';
    const cloudName = config.CLOUD_NAME || 'dajmo61zu';
    return `https://res.cloudinary.com/${cloudName}/image/upload${versionStr}/${publicId}`;
  }
}

/**
 * Generate a Cloudinary URL for a video using the Cloudinary SDK URL helper
 * @param publicId - The public ID of the video
 * @param version - Optional version number
 * @returns The Cloudinary URL for the video
 */
export function getCloudinaryVideoUrl(publicId: string, version?: string | number): string {
  if (!publicId) {
    return '';
  }

  try {
    const url = cloudinary.v2.url(publicId, {
      resource_type: 'video',
      type: 'upload',
      version: version ? Number(version) : undefined,
      secure: true,
    });
    return url;
  } catch (error) {
    // Fallback to manual URL construction if SDK fails
    const versionStr = version ? `/v${version}` : '';
    const cloudName = config.CLOUD_NAME || 'dajmo61zu';
    return `https://res.cloudinary.com/${cloudName}/video/upload${versionStr}/${publicId}`;
  }
}

/**
 * Update an existing Cloudinary asset to public access mode
 * @param publicId - The public ID of the asset
 * @param resourceType - The resource type ('image' or 'video')
 * @returns Promise with the update result
 */
export async function updateAssetAccessMode(
  publicId: string,
  resourceType: 'image' | 'video' = 'image'
): Promise<any> {
  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.explicit(
      publicId,
      {
        resource_type: resourceType,
        type: 'upload',
        access_mode: 'public',
      },
      (error, result) => {
        if (error) {
          log.error(`Failed to update access mode for ${publicId}`, error);
          reject(error);
        } else {
          log.info(`Successfully updated access mode for ${publicId} to public`);
          resolve(result);
        }
      }
    );
  });
}

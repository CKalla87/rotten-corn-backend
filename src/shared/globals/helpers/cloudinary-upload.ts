import cloudinary, { UploadApiResponse, UploadApiErrorResponse} from 'cloudinary';

export function uploads(
  file: string,
  public_id?: string,
  overwrite?: boolean,
  invalidate?: boolean,
  resource_type?: string,
): Promise<UploadApiResponse | UploadApiErrorResponse | undefined> {
  return new Promise((resolve) => {
    console.info({file, public_id, overwrite,invalidate, resource_type});
    cloudinary.v2.uploader.upload(
      file,
      {
        public_id,
        overwrite,
        invalidate,
      },
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
         if (error) resolve(error);
         resolve(result);
      }
    );
  });
}



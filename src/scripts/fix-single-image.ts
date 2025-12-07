/**
 * Quick script to fix a single Cloudinary image to public access
 * Usage: tsx src/scripts/fix-single-image.ts <public_id>
 * Example: tsx src/scripts/fix-single-image.ts jt7wi66urspgtzsyzru9
 */

import cloudinary from 'cloudinary';
import { config } from '../config';

// Initialize Cloudinary
config.cloudinaryConfig();

const publicId = process.argv[2];

if (!publicId) {
  console.error('Usage: tsx src/scripts/fix-single-image.ts <public_id>');
  console.error('Example: tsx src/scripts/fix-single-image.ts jt7wi66urspgtzsyzru9');
  process.exit(1);
}

async function fixImage() {
  console.log(`Attempting to update ${publicId} to public access...`);

  // First, try to get the current asset info
  cloudinary.v2.api.resource(publicId, { resource_type: 'image' }, (error, result) => {
    if (error) {
      console.error('Error fetching asset info:', error);
      return;
    }
    console.log('Current asset info:', {
      public_id: result.public_id,
      access_mode: result.access_mode,
      url: result.url,
      secure_url: result.secure_url
    });

    // Now update to public
    cloudinary.v2.uploader.explicit(
      publicId,
      {
        resource_type: 'image',
        type: 'upload',
        access_mode: 'public'
      },
      (updateError, updateResult) => {
        if (updateError) {
          console.error('Failed to update:', updateError);
          console.error('\nPossible causes:');
          console.error('1. Check Cloudinary Dashboard > Settings > Security');
          console.error('2. Ensure "Restricted media types" allows images');
          console.error('3. Check if "Strict Transformations" is enabled');
          console.error('4. Verify API credentials are correct');
          process.exit(1);
        } else {
          console.log('\n✓ Successfully updated to public access!');
          console.log('New URL:', updateResult.secure_url || updateResult.url);
          console.log('Access mode:', updateResult.access_mode);
          process.exit(0);
        }
      }
    );
  });
}

fixImage();

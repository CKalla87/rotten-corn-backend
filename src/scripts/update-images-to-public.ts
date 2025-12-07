/**
 * Script to update all existing Cloudinary images to public access mode
 * Run this script to fix 401 errors on existing images
 *
 * Usage: npx ts-node src/scripts/update-images-to-public.ts
 */

import cloudinary from 'cloudinary';
import { config } from '../config';
import { PostModel } from '../features/post/models/post.schema';
import { ImageModel } from '../features/images/models/image.schema';
import { UserModel } from '../features/user/models/user.schema';
import databaseConnection from '../setupDatabase';
import mongoose from 'mongoose';

// Initialize Cloudinary
config.cloudinaryConfig();

interface UpdateResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

async function updateImageAccessMode(publicId: string, resourceType: 'image' | 'video' = 'image'): Promise<boolean> {
  return new Promise((resolve) => {
    cloudinary.v2.uploader.explicit(
      publicId,
      {
        resource_type: resourceType,
        type: 'upload',
        access_mode: 'public',
      },
      (error) => {
        if (error) {
          console.error(`Failed to update ${publicId}:`, error.message);
          resolve(false);
        } else {
          console.log(`✓ Updated ${publicId} to public access`);
          resolve(true);
        }
      }
    );
  });
}

async function updateAllImages(): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Update images from posts
    console.log('Updating images from posts...');
    const posts = await PostModel.find({
      $or: [
        { imgId: { $exists: true, $ne: '' } },
        { videoId: { $exists: true, $ne: '' } },
      ],
    }).exec();

    for (const post of posts) {
      if (post.imgId) {
        const success = await updateImageAccessMode(post.imgId as string, 'image');
        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({ id: post._id.toString(), error: `Failed to update imgId: ${post.imgId}` });
        }
      }
      if (post.videoId) {
        const success = await updateImageAccessMode(post.videoId as string, 'video');
        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({ id: post._id.toString(), error: `Failed to update videoId: ${post.videoId}` });
        }
      }
    }

    // Update images from image collection
    console.log('Updating images from image collection...');
    const images = await ImageModel.find({ imgId: { $exists: true, $ne: '' } }).exec();

    for (const image of images) {
      if (image.imgId) {
        const success = await updateImageAccessMode(image.imgId as string, 'image');
        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({ id: image._id.toString(), error: `Failed to update imgId: ${image.imgId}` });
        }
      }
    }

    // Update user profile pictures and background images
    console.log('Updating user profile images...');
    const users = await UserModel.find({
      $or: [
        { profilePicture: { $exists: true, $ne: '' } },
        { bgImageId: { $exists: true, $ne: '' } },
      ],
    }).exec();

    for (const user of users) {
      // Profile pictures are usually full URLs, so we skip those
      // But if bgImageId exists, update it
      if (user.bgImageId && typeof user.bgImageId === 'string' && !user.bgImageId.startsWith('http')) {
        const success = await updateImageAccessMode(user.bgImageId, 'image');
        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push({ id: user._id.toString(), error: `Failed to update bgImageId: ${user.bgImageId}` });
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Error updating images:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('Connecting to database...');
    databaseConnection();

    // Wait for database connection
    await new Promise((resolve) => {
      if (mongoose.connection.readyState === 1) {
        resolve(true);
      } else {
        mongoose.connection.once('connected', resolve);
      }
    });
    console.log('Database connected.');

    console.log('Starting image access mode update...\n');
    const result = await updateAllImages();

    console.log('\n=== Update Summary ===');
    console.log(`Successfully updated: ${result.success}`);
    console.log(`Failed: ${result.failed}`);
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((err) => {
        console.log(`  - ${err.id}: ${err.error}`);
      });
    }

    console.log('\nDone!');
    process.exit(0);
  } catch (error) {
    console.error('Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

export { updateAllImages, updateImageAccessMode };


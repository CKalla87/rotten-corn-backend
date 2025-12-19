import mongoose, { model, Model, Schema } from 'mongoose';
import { IPostDocument } from '@post/interfaces/post.interface';

const postSchema: Schema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  username: { type: String, index: true },
  email: { type: String },
  avatarColor: { type: String },
  profilePicture: { type: String },
  post: { type: String, default: '' },
  bgColor: { type: String, default: '' },
  imgVersion: { type: String, default: '' },
  imgId: { type: String, default: '' },
  videoVersion: { type: String, default: '' },
  videoId: { type: String, default: '' },
  feelings: { type: String, default: '' },
  gifUrl: { type: String, default: '' },
  privacy: { type: String, default: '' },
  commentsCount: { type: Number, default: 0 },
  reactions: {
    like: { type: Number, default: 0 },
    love: { type: Number, default: 0 },
    happy: { type: Number, default: 0 },
    wow: { type: Number, default: 0 },
    sad: { type: Number, default: 0 },
    angry: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now, index: true }
});

// Compound indexes for common query patterns
postSchema.index({ userId: 1, createdAt: -1 }); // For user's posts sorted by date
postSchema.index({ createdAt: -1 }); // For all posts sorted by date

const PostModel: Model<IPostDocument> = model<IPostDocument>('Post', postSchema, 'Post');

export { PostModel };

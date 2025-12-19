import mongoose, { model, Model, Schema } from 'mongoose';
import { ICommentDocument } from '@comment/interfaces/comment.interface';

const commentSchema: Schema = new Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', index: true },
  comment: { type: String, default: '' },
  username: { type: String, index: true },
  avataColor: { type: String },
  profilePicture: { type: String },
  gifUrl: { type: String, default: '' },
  reaction: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now(), index: true }
});

// Compound index for common query: get comments by postId sorted by createdAt
commentSchema.index({ postId: 1, createdAt: 1 }); // Ascending for chronological order

const CommentsModel: Model<ICommentDocument> = model<ICommentDocument>('Comment', commentSchema, 'Comment');
export { CommentsModel };

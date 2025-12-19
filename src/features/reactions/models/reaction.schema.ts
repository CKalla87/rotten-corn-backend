import { IReactionDocument } from '@reaction/interfaces/reaction.interface';
import mongoose, { model, Model, Schema } from 'mongoose';

const reactionSchema: Schema = new Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', index: true },
  type: { type: String, default: '' },
  username: { type: String, default: '' },
  avataColor: { type: String, default: '' },
  profilePicture: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now() }
});

// Compound index for fast queries by postId and username
reactionSchema.index({ postId: 1, username: 1 });
// Index for username queries
reactionSchema.index({ username: 1 });

const ReactionModel: Model<IReactionDocument> = model<IReactionDocument>('Reaction', reactionSchema, 'Reaction');

export { ReactionModel };

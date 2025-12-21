import { IFollowerDocument } from '../interfaces/follower.interface';
import mongoose, { model, Model, Schema } from 'mongoose';

const followerSchema: Schema = new Schema({
  followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  followeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  createdAt: { type: Date, default: Date.now() }
});

// Compound indexes for common query patterns
followerSchema.index({ followerId: 1, followeeId: 1 }); // For checking if user follows another
followerSchema.index({ followeeId: 1, createdAt: -1 }); // For getting followers sorted by date

const FollowerModel: Model<IFollowerDocument> = model<IFollowerDocument>('Follower', followerSchema, 'Follower');
export { FollowerModel };

import mongoose, { Model, Schema, model } from 'mongoose';
import { IConversationDocument } from '@chat/interfaces/conversation.interface';

const conversationSchema: Schema = new Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }
});

// Compound index for finding conversations between two users
conversationSchema.index({ senderId: 1, receiverId: 1 });
conversationSchema.index({ receiverId: 1, senderId: 1 }); // Reverse for bidirectional lookup

const ConversationModel: Model<IConversationDocument> = model<IConversationDocument>('Conversation', conversationSchema, 'Conversation');
export { ConversationModel };

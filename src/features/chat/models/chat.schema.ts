import mongoose, { Model, model, Schema } from 'mongoose';
import { IMessageDocument } from '@chat/interfaces/chat.interface';

const messageSchema: Schema = new Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  senderUsername: { type: String, default: '' },
  senderAvatarColor: { type: String, default: '' },
  senderProfilePicture: { type: String, default: '' },
  receiverUsername: { type: String, default: '' },
  receiverAvatarColor: { type: String, default: '' },
  receiverProfilePicture: { type: String, default: '' },
  body: { type: String, default: '' },
  gifUrl: { type: String, default: '' },
  isRead: { type: Boolean, default: false },
  deleteForMe: { type: Boolean, default: false },
  deleteForEveryone: { type: Boolean, default: false },
  selectedImage: { type: String, default: '' },
  reaction: Array,
  createdAt: { type: Date, default: Date.now, index: true }
});

// Compound indexes for common query patterns
messageSchema.index({ conversationId: 1, createdAt: 1 }); // For messages in a conversation sorted by date
messageSchema.index({ senderId: 1, receiverId: 1 }); // For finding messages between two users

const MessageModel: Model<IMessageDocument> = model<IMessageDocument>('Message', messageSchema, 'Message');
export { MessageModel };

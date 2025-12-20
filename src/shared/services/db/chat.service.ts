import mongoose from 'mongoose';
import { ConversationModel } from '@chat/models/conversation.schema';
import { MessageModel } from '@chat/models/chat.schema';
import { IConversationDocument } from '@chat/interfaces/conversation.interface';
import { IMessageData } from '@chat/interfaces/chat.interface';
import { remove } from 'lodash';
import { IReaction } from '@reaction/interfaces/reaction.interface';

class ChatService {
  public async addMessageToDB(data: IMessageData): Promise<void> {
    const conversation: IConversationDocument[] = await ConversationModel.find({
      _id: data.conversationId
    }).exec();

    // Convert senderId and receiverId to ObjectId if they're strings
    const senderIdObjectId = typeof data.senderId === 'string'
      ? new mongoose.Types.ObjectId(data.senderId)
      : data.senderId;
    const receiverIdObjectId = typeof data.receiverId === 'string'
      ? new mongoose.Types.ObjectId(data.receiverId)
      : data.receiverId;

    if (!conversation.length) {
      await ConversationModel.create({
        _id: data.conversationId,
        senderId: senderIdObjectId,
        receiverId: receiverIdObjectId
      });
    }

    // Create message with ObjectId fields
    const messageData = {
      ...data,
      senderId: senderIdObjectId,
      receiverId: receiverIdObjectId
    };
    await MessageModel.create(messageData);
  }

  public async getUserConversationList(userId: mongoose.Types.ObjectId): Promise<IMessageData[]> {
    // Optimized aggregation with proper indexes, projection, and timeout
    const messages: IMessageData[] = await MessageModel.aggregate([
      {
        $match: {
          $or: [{ senderId: userId }, { receiverId: userId }]
        }
      },
      {
        $group: {
          _id: '$conversationId',
          result: { $last: '$$ROOT' }
        }
      },
      {
        $project: {
          _id: '$result._id',
          conversationId: '$result.conversationId',
          receiverId: '$result.receiverId',
          receiverUsername: '$result.receiverUsername',
          receiverAvatarColor: '$result.receiverAvatarColor',
          receiverProfilePicture: '$result.receiverProfilePicture',
          senderUsername: '$result.senderUsername',
          senderId: '$result.senderId',
          senderAvatarColor: '$result.senderAvatarColor',
          senderProfilePicture: '$result.senderProfilePicture',
          body: '$result.body',
          isRead: '$result.isRead',
          gifUrl: '$result.gifUrl',
          selectedImage: '$result.selectedImage',
          reaction: '$result.reaction',
          createdAt: '$result.createdAt',
          deleteForMe: '$result.deleteForMe',
          deleteForEveryone: '$result.deleteForEveryone'
        }
      },
      { $sort: { createdAt: -1 } }
    ], { allowDiskUse: true, maxTimeMS: 5000 }); // Add timeout to prevent hanging

    return messages;
  }

  public async getMessages(senderId: mongoose.Types.ObjectId, receiverId: mongoose.Types.ObjectId): Promise<IMessageData[]> {
    const query = {
      $or: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId }
      ]
    };
    // Optimize with projection, allowDiskUse, and timeout for large conversations
    const messages: IMessageData[] = await MessageModel.aggregate([
      { $match: query },
      { $sort: { createdAt: 1 } },
      {
        $project: {
          conversationId: 1,
          senderId: 1,
          receiverId: 1,
          senderUsername: 1,
          senderAvatarColor: 1,
          senderProfilePicture: 1,
          receiverUsername: 1,
          receiverAvatarColor: 1,
          receiverProfilePicture: 1,
          body: 1,
          gifUrl: 1,
          isRead: 1,
          selectedImage: 1,
          reaction: 1,
          createdAt: 1,
          deleteForMe: 1,
          deleteForEveryone: 1
        }
      }
    ], { allowDiskUse: true, maxTimeMS: 5000 }); // Add timeout to prevent hanging
    return messages;
  }

  public async markMessageAsDeleted(messageId: string, type: string): Promise<void> {
    if (type === 'deleteForMe') {
      await MessageModel.updateOne({ _id: messageId }, { $set: { deleteForMe: true } }).maxTimeMS(5000).exec();
    } else {
      await MessageModel.updateOne(
        { _id: messageId },
        { $set: { deleteForMe: true, deleteForEveryone: true } }
      ).maxTimeMS(5000).exec();
    }
  }

  public async markMessagesAsRead(senderId: mongoose.Types.ObjectId | string, receiverId: mongoose.Types.ObjectId | string): Promise<void> {
    const query = {
      $or: [
        { senderId, receiverId, isRead: false },
        { senderId: receiverId, receiverId: senderId, isRead: false }
      ]
    };
    await MessageModel.updateMany(query, { $set: { isRead: true } }).exec();
  }

  public async updateMessageReaction(
    messageId: mongoose.Types.ObjectId | string,
    senderName: string,
    reaction: string,
    type: string
  ): Promise<void> {
    const message = await MessageModel.findOne({ _id: messageId }).maxTimeMS(5000).exec();

    // If message found, update it (for chat messages)
    if (message) {
      const reactions: IReaction[] = Array.isArray(message.reaction) ? message.reaction : [];
      remove(reactions, (reactionData: IReaction) => reactionData.senderName === senderName);
      if (type === 'add') {
        reactions.push({ senderName, type: reaction });
      }
      message.reaction = reactions;
      await message.save();
    } else {
      // If message not found, it might be a comment - try to update comment instead
      const { CommentsModel } = await import('@comment/models/comment.schema');
      const comment = await CommentsModel.findOne({ _id: messageId }).maxTimeMS(5000).exec();

      if (comment) {
        const reactions: IReaction[] = Array.isArray(comment.reaction)
          ? (comment.reaction as unknown as IReaction[])
          : [];
        remove(reactions, (reactionData: IReaction) => reactionData.senderName === senderName);
        if (type === 'add') {
          reactions.push({ senderName, type: reaction });
        }
        (comment as { reaction?: IReaction[] }).reaction = reactions;
        await comment.save();
        console.log(`✅ Comment reaction saved: commentId=${messageId}, senderName=${senderName}, reaction=${reaction}, type=${type}, totalReactions=${reactions.length}`);
      } else {
        console.log(`⚠️ Neither message nor comment found for ID: ${messageId}`);
      }
    }
  }
}

export const chatService: ChatService = new ChatService();

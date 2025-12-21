import { Helpers } from '@global/helpers/helpers';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostModel } from '@post/models/post.schema';
import { IQueryReaction, IReactionDocument, IReactionJob } from '@reaction/interfaces/reaction.interface';
import { ReactionModel } from '@reaction/models/reaction.schema';
import { UserCache } from '@service/redis/user.cache';
import { IUserDocument } from '@user/interfaces/user.interface';
import { INotificationDocument, INotificationTemplate } from '@notification/interfaces/notification.interface';
import { NotificationModel } from '@notification/models/notification.schema';
import { socketIONotificationObject } from '@socket/notification';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { emailQueue } from '@service/queues/email.queue';
import { omit } from 'lodash';
import mongoose from 'mongoose';
import { config } from '@root/config';

const userCache: UserCache = new UserCache();

class ReactionService {
  public async addReactionDataToDB(reactionData: IReactionJob): Promise<void> {
    const { postId, userTo, userFrom, username, type, previousReaction, reactionObject } = reactionData;

    // Ensure postId is converted to ObjectId
    const postIdObj = typeof postId === 'string' ? new mongoose.Types.ObjectId(postId) : postId;

    // Normalize username to ensure consistent storage and retrieval
    // This matches how usernames are stored in the database (first letter uppercase)
    const normalizedUsername = Helpers.firstLetterUppercase(username);

    // Map UI reaction types to database schema types
    // UI uses "haha" but database schema uses "happy"
    const normalizeReactionType = (reactionType: string): string => {
      if (reactionType === 'haha') {
        return 'happy';
      }
      return reactionType;
    };
    const normalizedType = type ? normalizeReactionType(type) : '';
    const normalizedPreviousReaction = previousReaction ? normalizeReactionType(previousReaction) : previousReaction;

    let updatedReactionObject: IReactionDocument = reactionObject as IReactionDocument;
    if (previousReaction) {
      updatedReactionObject = omit(reactionObject, ['_id']);
    }

    // Ensure postId in reaction object is ObjectId
    if (updatedReactionObject.postId && typeof updatedReactionObject.postId === 'string') {
      updatedReactionObject.postId = postIdObj as any;
    }

    // Ensure username in reaction object is normalized
    if (updatedReactionObject.username) {
      updatedReactionObject.username = normalizedUsername;
    }

    // Ensure reaction type is normalized (haha -> happy)
    if (updatedReactionObject.type) {
      updatedReactionObject.type = normalizedType;
    }

    // Optimize: Skip cache lookup for user - fetch directly from database if needed
    // Save reaction and update post in parallel for speed
    // Build $inc update object - only include previousReaction decrement if it exists and is valid
    const updateIncrement: Record<string, number> = {
      [`reactions.${normalizedType}`]: 1
    };

    // Only decrement previous reaction if it's a valid non-empty string
    if (normalizedPreviousReaction && normalizedPreviousReaction.trim() && normalizedPreviousReaction !== normalizedType) {
      updateIncrement[`reactions.${normalizedPreviousReaction}`] = -1;
    }

    const [reactionDoc, postDoc] = await Promise.all([
      ReactionModel.findOneAndUpdate(
        { postId: postIdObj, username: normalizedUsername },
        updatedReactionObject,
        { upsert: true, new: true }
      ).maxTimeMS(5000).exec(),
      PostModel.findOneAndUpdate(
        { _id: postIdObj },
        { $inc: updateIncrement },
        { new: true }
      ).maxTimeMS(5000).exec()
    ]);

    // Get user data only if needed for notifications (skip cache to avoid slow Redis)
    let userDoc: IUserDocument | null = null;
    if (userTo && userFrom && userTo !== userFrom) {
      try {
        // Try cache first with timeout, fallback to database
        const cachePromise = userCache.getUserFromCache(`${userTo}`);
        const timeoutPromise = new Promise<IUserDocument | null>((resolve) => {
          setTimeout(() => resolve(null), 2000);
        });
        userDoc = await Promise.race([cachePromise, timeoutPromise]) as IUserDocument | null;

        // If cache failed or timed out, get from database
        if (!userDoc) {
          const { userService } = await import('@service/db/user.service');
          userDoc = await userService.getUserById(userTo);
        }
      } catch (error) {
        // If user lookup fails, continue without notification
        userDoc = null;
      }
    }

    // Only create notification if we have user data
    if (userTo && userFrom && userDoc && userDoc.notifications?.reactions && userTo !== userFrom) {
      const reactionDocId = (reactionDoc as IReactionDocument)?._id ?? reactionObject?._id ?? new mongoose.Types.ObjectId();
      const createdItemId: mongoose.Types.ObjectId =
        reactionDocId instanceof mongoose.Types.ObjectId ? reactionDocId : new mongoose.Types.ObjectId(reactionDocId);
      const notificationModel: INotificationDocument = new NotificationModel();
      const postDocTyped = postDoc as IPostDocument;
      const notifications: INotificationDocument[] = await notificationModel.insertNotification({
        userFrom,
        userTo,
        message: `${username} reacted to your post.`,
        notificationType: 'reactions',
        entityId: new mongoose.Types.ObjectId(postId),
        createdItemId,
        createdAt: new Date(),
        comment: '',
        post: postDocTyped?.post ?? '',
        imgId: postDocTyped?.imgId ?? '',
        imgVersion: postDocTyped?.imgVersion ?? '',
        gifUrl: postDocTyped?.gifUrl ?? '',
        reaction: type ?? ''
      });
      socketIONotificationObject?.emit('insert notification', notifications, { userTo });
      const templateParams: INotificationTemplate = {
        username: userDoc.username ?? 'User',
        message: `${username} reacted to your post.`,
        header: 'Post reaction notification'
      };
      const recipientEmail = userDoc.email;
      if (recipientEmail) {
        const template: string = notificationTemplate.notificationMessageTemplate(templateParams);
        emailQueue.addEmailJob('reactionsEmail', {
          receiverEmail: recipientEmail,
          template,
          subject: 'Post reaction notification'
        });
      }
    }
  }

  public async removeReactionDataFromDB(reactionData: IReactionJob): Promise<void> {
    const { postId, previousReaction, username } = reactionData;

    // Ensure postId is converted to ObjectId
    const postIdObj = typeof postId === 'string' ? new mongoose.Types.ObjectId(postId) : postId;

    // Normalize username to ensure consistent storage and retrieval
    // This matches how usernames are stored in the database (first letter uppercase)
    const normalizedUsername = Helpers.firstLetterUppercase(username);

    // Map UI reaction types to database schema types
    // UI uses "haha" but database schema uses "happy"
    const normalizeReactionType = (reactionType: string): string => {
      if (reactionType === 'haha') {
        return 'happy';
      }
      return reactionType;
    };
    const normalizedPreviousReaction = previousReaction ? normalizeReactionType(previousReaction) : previousReaction;

    // Build update operations
    const operations: Promise<any>[] = [
      ReactionModel.deleteOne({ postId: postIdObj, type: normalizedPreviousReaction, username: normalizedUsername }).maxTimeMS(5000).exec()
    ];

    // Only decrement reaction count if previousReaction is valid
    if (normalizedPreviousReaction && normalizedPreviousReaction.trim()) {
      operations.push(
        PostModel.updateOne(
          { _id: postIdObj },
          {
            $inc: {
              [`reactions.${normalizedPreviousReaction}`]: -1
            }
          },
          { new: true }
        ).maxTimeMS(5000).exec()
      );
    }

    await Promise.all(operations);
  }

  public async getPostReactions(query: IQueryReaction, sort: Record<string, 1 | -1>): Promise<[IReactionDocument[], number]> {
    // Use find() instead of aggregate - much faster with indexes
    const reactions: IReactionDocument[] = await ReactionModel.find(query)
      .sort(sort)
      .lean()
      .maxTimeMS(5000)
      .exec() as IReactionDocument[];

    // Normalize profile picture URLs to fix Cloudinary cloud name issues
    // Also map database reaction types back to UI format (happy -> haha)
    reactions.forEach((reaction) => {
      if (reaction.profilePicture && Helpers.isCloudinaryUrl(reaction.profilePicture)) {
        const urlParts = reaction.profilePicture.split('/');
        const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
        if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
          const version = urlParts[versionIndex];
          const publicId = urlParts[versionIndex + 1];
          reaction.profilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
        }
      }
      // Map database reaction type back to UI format (happy -> haha)
      if (reaction.type === 'happy') {
        reaction.type = 'haha';
      }
    });

    return [reactions, reactions.length];
  }

  public async getSinglePostReactionByUsername(postId: string, username: string): Promise<[IReactionDocument, number] | []> {
    // Normalize username for query
    const normalizedUsername = Helpers.firstLetterUppercase(username);
    const postIdObj = new mongoose.Types.ObjectId(postId);

    // Try normalized username first (how new reactions are stored)
    let reaction: IReactionDocument | null = await ReactionModel.findOne({
      postId: postIdObj,
      username: normalizedUsername
    })
      .lean()
      .maxTimeMS(5000)
      .exec() as IReactionDocument | null;

    // If not found with normalized username, try original username format
    // This handles reactions saved before the normalization fix
    if (!reaction && username !== normalizedUsername) {
      reaction = await ReactionModel.findOne({
        postId: postIdObj,
        username: username
      })
        .lean()
        .maxTimeMS(5000)
        .exec() as IReactionDocument | null;
    }

    // Also try case-insensitive search as a fallback
    if (!reaction) {
      const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      reaction = await ReactionModel.findOne({
        postId: postIdObj,
        username: { $regex: new RegExp(`^${escapedUsername}$`, 'i') }
      })
        .lean()
        .maxTimeMS(5000)
        .exec() as IReactionDocument | null;
    }

    if (reaction) {
      // Normalize profile picture URL to fix Cloudinary cloud name issues
      if (reaction.profilePicture && Helpers.isCloudinaryUrl(reaction.profilePicture)) {
        const urlParts = reaction.profilePicture.split('/');
        const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
        if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
          const version = urlParts[versionIndex];
          const publicId = urlParts[versionIndex + 1];
          reaction.profilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
        }
      }
      // Map database reaction type back to UI format (happy -> haha)
      // This ensures the UI receives the format it expects
      if (reaction.type === 'happy') {
        reaction.type = 'haha';
      }
      return [reaction, 1];
    }
    return [];
  }

  public async getReactionsByUsername(username: string): Promise<IReactionDocument[]> {
    // Use find() instead of aggregate - much faster with index
    const reactions: IReactionDocument[] = await ReactionModel.find({
      username: Helpers.firstLetterUppercase(username)
    })
      .lean()
      .maxTimeMS(5000)
      .exec() as IReactionDocument[];
    return reactions;
  }
}

export const reactionService: ReactionService = new ReactionService();

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
    let updatedReactionObject: IReactionDocument = reactionObject as IReactionDocument;
    if (previousReaction) {
      updatedReactionObject = omit(reactionObject, ['_id']);
    }

    // Optimize: Skip cache lookup for user - fetch directly from database if needed
    // Save reaction and update post in parallel for speed
    const [reactionDoc, postDoc] = await Promise.all([
      ReactionModel.findOneAndUpdate(
        { postId, username },
        updatedReactionObject,
        { upsert: true, new: true }
      ).maxTimeMS(5000).exec(),
      PostModel.findOneAndUpdate(
        { _id: postId },
        {
          $inc: {
            [`reactions.${previousReaction}`]: -1,
            [`reactions.${type}`]: 1,
          }
        },
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
    await Promise.all([
      ReactionModel.deleteOne({ postId, type: previousReaction, username }),
      PostModel.updateOne(
        { _id: postId },
        {
          $inc: {
            [`reactions.${previousReaction}`]: -1
          },
        },
        { new: true }
      )
    ]);
  }

  public async getPostReactions(query: IQueryReaction, sort: Record<string, 1 | -1>): Promise<[IReactionDocument[], number]> {
    // Use find() instead of aggregate - much faster with indexes
    const reactions: IReactionDocument[] = await ReactionModel.find(query)
      .sort(sort)
      .lean()
      .maxTimeMS(5000)
      .exec() as IReactionDocument[];

    // Normalize profile picture URLs to fix Cloudinary cloud name issues
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
    });

    return [reactions, reactions.length];
  }

  public async getSinglePostReactionByUsername(postId: string, username: string): Promise<[IReactionDocument, number] | []> {
    // Use findOne() instead of aggregate - much faster with compound index
    const reaction: IReactionDocument | null = await ReactionModel.findOne({
      postId: new mongoose.Types.ObjectId(postId),
      username: Helpers.firstLetterUppercase(username)
    })
      .lean()
      .maxTimeMS(5000)
      .exec() as IReactionDocument | null;

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

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const updatedReaction: [IUserDocument, IReactionDocument, IPostDocument] = await Promise.all([
      userCache.getUserFromCache(`${userTo}`),
      ReactionModel.findOneAndUpdate(
        { postId, username },
        updatedReactionObject,
        { upsert: true, new: true }
      ),
      PostModel.findOneAndUpdate(
        { _id: postId },
        {
          $inc: {
            [`reactions.${previousReaction}`]: -1,
            [`reactions.${type}`]: 1,
          }
        },
        { new: true }
      )
    ]) as unknown as [IUserDocument, IReactionDocument, IPostDocument];

    if (userTo && userFrom && updatedReaction[0]?.notifications?.reactions && userTo !== userFrom) {
      const reactionDocId = updatedReaction[1]?._id ?? reactionObject?._id ?? new mongoose.Types.ObjectId();
      const createdItemId: mongoose.Types.ObjectId =
        reactionDocId instanceof mongoose.Types.ObjectId ? reactionDocId : new mongoose.Types.ObjectId(reactionDocId);
      const notificationModel: INotificationDocument = new NotificationModel();
      const notifications: INotificationDocument[] = await notificationModel.insertNotification({
        userFrom,
        userTo,
        message: `${username} reacted to your post.`,
        notificationType: 'reactions',
        entityId: new mongoose.Types.ObjectId(postId),
        createdItemId,
        createdAt: new Date(),
        comment: '',
        post: updatedReaction[2]?.post ?? '',
        imgId: updatedReaction[2]?.imgId ?? '',
        imgVersion: updatedReaction[2]?.imgVersion ?? '',
        gifUrl: updatedReaction[2]?.gifUrl ?? '',
        reaction: type ?? ''
      });
      socketIONotificationObject?.emit('insert notification', notifications, { userTo });
      const templateParams: INotificationTemplate = {
        username: updatedReaction[0]?.username ?? 'User',
        message: `${username} reacted to your post.`,
        header: 'Post reaction notification'
      };
      const recipientEmail = updatedReaction[0]?.email;
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

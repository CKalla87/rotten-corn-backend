import { CommentsModel } from '@comment/models/comment.schema';
import { ICommentDocument, ICommentJob, ICommentNameList, IQueryComment } from './../../../features/comments/interfaces/comment.interface';
import { UserCache } from '@service/redis/user.cache';
import { IPostDocument } from '@post/interfaces/post.interface';
import { PostModel } from '@post/models/post.schema';
import mongoose, { Query } from 'mongoose';
import { IUserDocument } from '@user/interfaces/user.interface';
import { INotificationDocument, INotificationTemplate } from '@notification/interfaces/notification.interface';
import { NotificationModel } from '@notification/models/notification.schema';
import { socketIONotificationObject } from '@socket/notification';
import { notificationTemplate } from '@service/emails/templates/notifications/notification-template';
import { emailQueue } from '@service/queues/email.queue';
import { Helpers } from '@global/helpers/helpers';
import { config } from '@root/config';

const userCache: UserCache = new UserCache();

class CommentService {
  public async addCommentToDB(commentData: ICommentJob): Promise<void> {
    const { postId, userTo, userFrom, username, comment } = commentData;

    // Save comment and update post in parallel for speed
    const [commentDoc, postDoc] = await Promise.all([
      CommentsModel.create(comment),
      PostModel.findOneAndUpdate(
        { _id: postId },
        { $inc: { commentsCount: 1 } },
        { new: true }
      ).maxTimeMS(5000).exec()
    ]);

    // Get user data only if needed for notifications (skip cache to avoid slow Redis)
    let userDoc: IUserDocument | null = null;
    if (userTo && userFrom && userTo !== userFrom) {
      try {
        // Try cache first with timeout, fallback to database
        const cachePromise = userCache.getUserFromCache(userTo);
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

    const response: [ICommentDocument, IPostDocument, IUserDocument | null] = [
      commentDoc,
      postDoc as IPostDocument,
      userDoc
    ];

    if (response[2] && response[2]?.notifications?.comments && userFrom !== userTo) {
      const notificationModel: INotificationDocument = new NotificationModel();
      const notifications: INotificationDocument[] = await notificationModel.insertNotification({
        userFrom,
        userTo,
        message: `${username} commented on your post.`,
        notificationType: 'comment',
        entityId: new mongoose.Types.ObjectId(postId),
        createdItemId: new mongoose.Types.ObjectId(response[0]._id),
        createdAt: new Date(),
        comment: comment.comment,
        post: response[1]?.post ?? '',
        imgId: response[1]?.imgId ?? '',
        imgVersion: response[1]?.imgVersion ?? '',
        gifUrl: response[1]?.gifUrl ?? '',
        reaction: ''
      });
      socketIONotificationObject?.emit('insert notification', notifications, { userTo });

      const templateParams: INotificationTemplate = {
        username: response[2]?.username ?? 'User',
        message: `${username} commented on your post.`,
        header: 'Comment Notification'
      };
      const recipientEmail = response[2]?.email;
      if (recipientEmail) {
        const template: string = notificationTemplate.notificationMessageTemplate(templateParams);
        emailQueue.addEmailJob('commentsEmail', { receiverEmail: recipientEmail, template, subject: 'Post notification' });
      }
    }
  }

  public async getPostComments(query: IQueryComment, sort: Record<string, 1 | -1>): Promise<ICommentDocument[]> {
    // Use find() instead of aggregate - much faster with indexes
    const comments: ICommentDocument[] = await CommentsModel.find(query)
      .sort(sort)
      .lean()
      .maxTimeMS(5000)
      .exec() as ICommentDocument[];

    // Normalize profile picture URLs to fix Cloudinary cloud name issues
    comments.forEach((comment) => {
      if (comment.profilePicture && Helpers.isCloudinaryUrl(comment.profilePicture)) {
        const urlParts = comment.profilePicture.split('/');
        const versionIndex = urlParts.findIndex((part: string) => part.startsWith('v'));
        if (versionIndex !== -1 && versionIndex < urlParts.length - 1) {
          const version = urlParts[versionIndex];
          const publicId = urlParts[versionIndex + 1];
          comment.profilePicture = `https://res.cloudinary.com/${config.CLOUD_NAME}/image/upload/${version}/${publicId}`;
        }
      }
    });

    return comments;
  }

  public async getPostCommentNames(query: IQueryComment, sort: Record<string, 1 | -1>): Promise<ICommentNameList[]> {
    // Use aggregate but with timeout and optimized
    const commentsNameList: ICommentNameList[] = await CommentsModel.aggregate([
      { $match: query },
      { $sort: sort },
      { $group: { _id: null, names: { $addToSet: '$username' }, count: { $sum: 1 } } },
      { $project: { _id: 0 } }
    ], { allowDiskUse: true, maxTimeMS: 5000 });
    return commentsNameList;
  }
}

export const commentService: CommentService = new CommentService();

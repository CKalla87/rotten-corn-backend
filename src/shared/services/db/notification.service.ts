import { INotificationDocument } from '@notification/interfaces/notification.interface';
import { NotificationModel } from '@notification/models/notification.schema';
import mongoose from 'mongoose';

class NotificationService {
  public async getNotifications(userId: string): Promise<INotificationDocument[]> {
    const notifications: INotificationDocument[] = await NotificationModel.aggregate([
      { $match: { userTo: new mongoose.Types.ObjectId(userId) } },
      { $sort: { createdAt: -1 } }, // Sort by newest first
      // Group by _id to remove duplicates before lookups
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $lookup: { from: 'User', localField: 'userFrom', foreignField: '_id', as: 'userFrom' } },
      { $unwind: { path: '$userFrom', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'Auth', localField: 'userFrom.authId', foreignField: '_id', as: 'authId' } },
      { $unwind: { path: '$authId', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          message: 1,
          comment: 1,
          createdAt: 1,
          createdItemId: 1,
          entityId: 1,
          notificationType: 1,
          gifUrl: 1,
          imgId: 1,
          imgVersion: 1,
          post: 1,
          reaction: 1,
          read: 1,
          userTo: 1,
          userFrom: {
            profilePicture: '$userFrom.profilePicture',
            username: '$authId.username',
            avatarColor: '$authId.avatarColor',
            uId: '$authId.uId'
          }
        }
      },
      { $sort: { createdAt: -1 } } // Sort again after projection
    ], { allowDiskUse: true, maxTimeMS: 5000 });

    // Additional deduplication by _id as a safety measure
    const uniqueNotifications = new Map<string, INotificationDocument>();
    notifications.forEach((notification: any) => {
      const id = notification._id?.toString() || '';
      if (id && !uniqueNotifications.has(id)) {
        uniqueNotifications.set(id, notification);
      }
    });

    return Array.from(uniqueNotifications.values());
  }

  public async updateNotification(notificationId: string): Promise<void> {
    await NotificationModel.updateOne({ _id: notificationId }, { $set: { read: true } }).exec();
  }

  public async deleteNotification(notificationId: string): Promise<void> {
    await NotificationModel.deleteOne({ _id: notificationId }).exec();
  }
}

export const notificationService: NotificationService = new NotificationService();

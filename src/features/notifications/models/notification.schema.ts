import { INotification, INotificationDocument } from '@notification/interfaces/notification.interface';
import mongoose, { model, Schema, Model } from 'mongoose';

const notificationSchema: Schema = new Schema({
  userTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  userFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  read: { type: Boolean, default: false },
  message: { type: String, default: '' },
  notificationType: { type: String },
  entityId: mongoose.Types.ObjectId,
  createdItemId: mongoose.Types.ObjectId,
  comment: { type: String, default: '' },
  reaction: { type: String, default: '' },
  post: { type: String, default: '' },
  imgId: { type: String, default: '' },
  imgVersion: { type: String, default: '' },
  gifUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now() }
});

notificationSchema.methods.insertNotification = async function(body: INotification): Promise<INotificationDocument[]> {
  const {
    userTo,
    userFrom,
    message,
    notificationType,
    entityId,
    createdItemId,
    createdAt,
    comment,
    reaction,
    post,
    imgId,
    imgVersion,
    gifUrl
  } = body;

  // Check if a duplicate notification already exists to prevent duplicates
  // Look for notifications with the same userTo, userFrom, notificationType, and entityId created in the last 5 seconds
  // This prevents race conditions where multiple requests create the same notification
  const fiveSecondsAgo = new Date(Date.now() - 5000);
  const existingNotification = await NotificationModel.findOne({
    userTo,
    userFrom,
    notificationType,
    entityId,
    createdAt: { $gte: fiveSecondsAgo }
  }).maxTimeMS(2000);

  // Only create if no duplicate exists within the last 5 seconds
  if (!existingNotification) {
    await NotificationModel.create({
      userTo,
      userFrom,
      message,
      notificationType,
      entityId,
      createdItemId,
      createdAt,
      comment,
      reaction,
      post,
      imgId,
      imgVersion,
      gifUrl
    });
  }

  try {
    const { notificationService } = await import('@service/db/notification.service');
    const notifications: INotificationDocument[] = await notificationService.getNotifications(userTo);
    return notifications;
  } catch (error) {
    return error as INotificationDocument[];
  }
};

const NotificationModel: Model<INotificationDocument> = model<INotificationDocument>(
  'Notification',
  notificationSchema,
  'Notification'
);

export { NotificationModel };

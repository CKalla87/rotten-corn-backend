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

  // Convert userTo and userFrom strings to ObjectId for Mongoose schema compatibility
  const userToObjectId = typeof userTo === 'string'
    ? new mongoose.Types.ObjectId(userTo)
    : (userTo as any) instanceof mongoose.Types.ObjectId ? (userTo as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId(String(userTo));
  const userFromObjectId = typeof userFrom === 'string'
    ? new mongoose.Types.ObjectId(userFrom)
    : (userFrom as any) instanceof mongoose.Types.ObjectId ? (userFrom as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId(String(userFrom));

  // Convert entityId to ObjectId if it's not already one
  const entityIdObjectId = entityId instanceof mongoose.Types.ObjectId
    ? entityId
    : (typeof entityId === 'string' ? new mongoose.Types.ObjectId(entityId) : new mongoose.Types.ObjectId(String(entityId)));

  // Convert createdItemId to ObjectId if it's not already one
  const createdItemIdObjectId = createdItemId instanceof mongoose.Types.ObjectId
    ? createdItemId
    : (typeof createdItemId === 'string' ? new mongoose.Types.ObjectId(createdItemId) : new mongoose.Types.ObjectId(String(createdItemId)));

  // Check if a duplicate notification already exists to prevent duplicates
  // Look for notifications with the same userTo, userFrom, notificationType, and entityId created in the last 5 seconds
  // This prevents race conditions where multiple requests create the same notification
  const fiveSecondsAgo = new Date(Date.now() - 5000);
  const existingNotification = await NotificationModel.findOne({
    userTo: userToObjectId,
    userFrom: userFromObjectId,
    notificationType,
    entityId: entityIdObjectId,
    createdAt: { $gte: fiveSecondsAgo }
  }).maxTimeMS(2000);

  // Only create if no duplicate exists within the last 5 seconds
  if (!existingNotification) {
    await NotificationModel.create({
      userTo: userToObjectId,
      userFrom: userFromObjectId,
      message,
      notificationType,
      entityId: entityIdObjectId,
      createdItemId: createdItemIdObjectId,
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

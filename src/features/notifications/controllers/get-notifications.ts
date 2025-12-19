import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { notificationService } from '@service/db/notification.service';
import { INotificationDocument } from '@notification/interfaces/notification.interface';

export class Get {
  public async notifications(req: Request, res: Response): Promise<void> {
    // Set CORS headers immediately
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }

    const notifications: INotificationDocument[] = await notificationService.getNotifications(req.currentUser!.userId);

    // Additional client-side deduplication as final safety measure
    const uniqueNotifications = new Map<string, INotificationDocument>();
    notifications.forEach((notification: any) => {
      const id = notification._id?.toString() || notification._id || '';
      if (id && !uniqueNotifications.has(id)) {
        uniqueNotifications.set(id, notification);
      }
    });

    const deduplicatedNotifications = Array.from(uniqueNotifications.values());

    res.status(HTTP_STATUS.OK).json({
      message: 'User notifications',
      notifications: deduplicatedNotifications
    });
  }
}

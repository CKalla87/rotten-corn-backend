import { Request, Response } from 'express';
import HTTP_STATUS from 'http-status-codes';
import { notificationService } from '@service/db/notification.service';
import { INotificationDocument } from '@notification/interfaces/notification.interface';

export class Get {
  public async notifications(req: Request, res: Response): Promise<void> {
    const notifications: INotificationDocument[] = await notificationService.getNotifications(req.currentUser!.userId);
    res.status(HTTP_STATUS.OK).json({ message: 'User notifications', notifications });
  }
}

import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { userService } from '@service/db/user.service';
import { Helpers } from '@global/helpers/helpers';

export class Search {
  public async user(req: Request, res: Response): Promise<void> {
    const { query } = req.params;
    // Escape regex special characters but allow partial matching
    const escapedQuery = Helpers.escapeRegex(query);
    const regex = new RegExp(escapedQuery, 'i');
    const users = await userService.searchUsers(regex);
    res.status(HTTP_STATUS.OK).json({ message: 'Search results', search: users });
  }
}

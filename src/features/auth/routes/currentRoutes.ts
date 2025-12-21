import { CurrentUser } from '@auth/controllers/current-user';
import { authMiddleware } from '@global/helpers/auth-middleware';
import express, { Router } from 'express';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('currentRoutes');

class CurrentUserRoutes {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  public routes(): Router {
    // Support both /currentUser and /currentuser for compatibility
    // Add logging middleware to see if route is being hit
    const logMiddleware = (req: any, res: any, next: any) => {
      log.error('CurrentUser route hit', { url: req.url, method: req.method, hasCurrentUser: !!req.currentUser });
      next();
    };
    
    this.router.get('/currentUser', logMiddleware, authMiddleware.checkAuthentication, CurrentUser.prototype.read);
    this.router.get('/currentuser', logMiddleware, authMiddleware.checkAuthentication, CurrentUser.prototype.read);

    return this.router;
  }
};

export const currentUserRoutes: CurrentUserRoutes = new CurrentUserRoutes();

import { CurrentUser } from '@auth/controllers/current-user';
import { authMiddleware } from '@global/helpers/auth-middleware';
import express, { Router } from 'express';

class CurrentUserRoutes {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  public routes(): Router {
    // Support both /currentUser and /currentuser for compatibility
    this.router.get('/currentUser', authMiddleware.checkAuthentication, CurrentUser.prototype.read);
    this.router.get('/currentuser', authMiddleware.checkAuthentication, CurrentUser.prototype.read);

    return this.router;
  }
};

export const currentUserRoutes: CurrentUserRoutes = new CurrentUserRoutes();

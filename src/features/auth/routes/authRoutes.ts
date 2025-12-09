import { Password } from '@auth/controllers/password';
import { SignIn } from '@auth/controllers/signin';
import { SignOut } from '@auth/controllers/signout';
import { SignUp } from '@auth/controllers/signup';
import { OAuthController } from '@auth/controllers/oauth';
import express, { Router } from 'express';

class AuthRoutes {
  private router: Router;
  private oauthController: OAuthController;

  constructor() {
    this.router = express.Router();
    this.oauthController = new OAuthController();
  }

  public routes(): Router {
    this.router.post('/signup', SignUp.prototype.create);
    this.router.post('/signin', SignIn.prototype.read);
    this.router.post('/forgot-password', Password.prototype.create);
    this.router.post('/reset-password/:token', Password.prototype.update);

    // OAuth routes - register AFTER specific routes to avoid route conflicts
    this.router.get('/auth/:provider', this.oauthController.initiate.bind(this.oauthController));
    this.router.get('/auth/:provider/callback', this.oauthController.callback.bind(this.oauthController));
    this.router.post('/auth/:provider/callback', this.oauthController.exchangeCode.bind(this.oauthController));

    // Signout route
    this.router.get('/signout', SignOut.prototype.update);

    return this.router;
  }

  public signoutRoute(): Router {
    // Return a new router to avoid conflicts
    const signoutRouter = express.Router();
    signoutRouter.get('/signout', SignOut.prototype.update);
    return signoutRouter;
  }
}

export const authRoutes: AuthRoutes = new AuthRoutes();

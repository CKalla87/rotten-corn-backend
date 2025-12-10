import { Password } from '@auth/controllers/password';
import { SignIn } from '@auth/controllers/signin';
import { SignOut } from '@auth/controllers/signout';
import { SignUp } from '@auth/controllers/signup';
import { OAuthController } from '@auth/controllers/oauth';
import express, { Router, Request, Response } from 'express';
import { authCodeService } from '@service/oauth/auth-code.service';
import { config } from '@root/config';

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

    // OAuth health check endpoint
    this.router.get('/health/oauth', async (req: Request, res: Response) => {
      const getCallbackUrl = (provider: string): string => {
        if (config.CLIENT_URL && !config.CLIENT_URL.includes('169.254.169.254')) {
          return `${config.CLIENT_URL.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
        }
        if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') &&
            (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
          return `${config.EC2_URL.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
        }
        return config.NODE_ENV === 'development'
          ? `http://localhost:5000/api/v1/auth/${provider}/callback`
          : `https://dev.chatappserver.space/api/v1/auth/${provider}/callback`;
      };

      const health = {
        redis: await authCodeService.isRedisAvailable(),
        providers: {
          google: {
            configured: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
            callbackUrl: getCallbackUrl('google'),
            clientId: config.GOOGLE_CLIENT_ID ? `${config.GOOGLE_CLIENT_ID.substring(0, 10)}...` : undefined
          },
          github: {
            configured: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
            callbackUrl: getCallbackUrl('github'),
            clientId: config.GITHUB_CLIENT_ID ? `${config.GITHUB_CLIENT_ID.substring(0, 10)}...` : undefined
          },
          facebook: {
            configured: !!(config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET),
            callbackUrl: getCallbackUrl('facebook'),
            appId: config.FACEBOOK_APP_ID ? `${config.FACEBOOK_APP_ID.substring(0, 10)}...` : undefined
          }
        },
        environment: {
          nodeEnv: config.NODE_ENV,
          clientUrl: config.CLIENT_URL,
          ec2Url: config.EC2_URL
        },
        timestamp: new Date().toISOString()
      };
      res.status(health.redis ? 200 : 503).json(health);
    });

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

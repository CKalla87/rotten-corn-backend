import { Password } from '@auth/controllers/password';
import { SignIn } from '@auth/controllers/signin';
import { SignOut } from '@auth/controllers/signout';
import { SignUp } from '@auth/controllers/signup';
import { OAuthController } from '@auth/controllers/oauth';
import express, { Router, Request, Response, NextFunction } from 'express';
import { authCodeService } from '@service/oauth/auth-code.service';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('authRoutes');

class AuthRoutes {
  private router: Router;
  private oauthController: OAuthController;

  constructor() {
    this.router = express.Router();
    this.oauthController = new OAuthController();
  }

  /**
   * Helper function to check if origin is allowed (same logic as setupServer.ts)
   */
  private isOriginAllowed(origin: string): boolean {
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://dev.chatappserver.space',
      'https://staging.chatappserver.space',
      'https://api.dev.chatappserver.space',
      'https://api.staging.chatappserver.space',
      'https://chatappserver.space',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080'
    ].filter(Boolean);

    const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
    const originHost = normalizedOrigin.replace(/^https?:\/\//, '');

    return allowedOrigins.some(allowed => {
      if (!allowed) return false;
      const normalizedAllowed = allowed.replace(/\/$/, '').toLowerCase();
      const allowedHost = normalizedAllowed.replace(/^https?:\/\//, '');

      // Exact match (case-insensitive)
      if (normalizedOrigin === normalizedAllowed) {
        return true;
      }

      // Host match (case-insensitive)
      if (originHost === allowedHost) {
        return true;
      }

      // Subdomain match - check if both share the same base domain
      const baseDomain = allowedHost.split('.').slice(-2).join('.');
      const originBaseDomain = originHost.split('.').slice(-2).join('.');

      if (originBaseDomain === baseDomain && baseDomain === 'chatappserver.space') {
        return true;
      }

      return false;
    });
  }

  /**
   * Set CORS headers on response
   */
  private setCorsHeaders(req: Request, res: Response): void {
    const origin = req.get('origin');
    if (origin && this.isOriginAllowed(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
      res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Set-Cookie');
      log.info(`CORS headers set for origin: ${origin}`);
    } else if (!origin) {
      // Allow requests with no origin (like health checks)
      res.header('Access-Control-Allow-Origin', '*');
    }
  }

  /**
   * CORS middleware for all auth routes
   */
  private corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    this.setCorsHeaders(req, res);
    next();
  }

  public routes(): Router {
    // Apply CORS middleware to all routes - this runs first and sets headers
    this.router.use(this.corsMiddleware.bind(this));

    // Define OAuth providers list (used for routes and OPTIONS handlers)
    const oauthProviders = ['google', 'github', 'facebook'];

    // Handle OPTIONS preflight for specific routes first (order matters in Express)
    this.router.options('/signup', (req: Request, res: Response) => {
      this.setCorsHeaders(req, res);
      res.status(200).end();
    });

    this.router.options('/signin', (req: Request, res: Response) => {
      this.setCorsHeaders(req, res);
      res.status(200).end();
    });

    // OPTIONS handlers for OAuth routes (specific providers only)
    oauthProviders.forEach(provider => {
      this.router.options(`/auth/${provider}`, (req: Request, res: Response) => {
        this.setCorsHeaders(req, res);
        res.status(200).end();
      });
      this.router.options(`/auth/${provider}/callback`, (req: Request, res: Response) => {
        this.setCorsHeaders(req, res);
        res.status(200).end();
      });
    });

    // Handle OPTIONS preflight for all other auth routes (catch-all)
    this.router.options('*', (req: Request, res: Response) => {
      this.setCorsHeaders(req, res);
      res.status(200).end();
    });

    // Actual route handlers
    this.router.post('/signup', SignUp.prototype.create);
    this.router.post('/signin', SignIn.prototype.read);
    this.router.post('/forgot-password', Password.prototype.create);
    this.router.post('/reset-password/:token', Password.prototype.update);

    // Test endpoint to verify cookie-session is working - MUST be before parameterized routes
    this.router.get('/test-cookie', (req: Request, res: Response) => {
      // Set a test value in session
      if (!req.session) {
        req.session = {} as any;
      }
      Object.assign(req.session as any, { test: 'cookie-works' });

      // Log session state
      log.info('Test cookie endpoint', {
        hasSession: !!req.session,
        sessionTest: (req.session as any)?.test,
        cookies: req.headers.cookie
      });

      res.status(200).json({
        message: 'Cookie test',
        session: req.session,
        cookies: req.headers.cookie,
        setCookieHeader: res.getHeader('Set-Cookie')
      });
    });

    // OAuth routes - register AFTER specific routes to avoid route conflicts
    // Only match known OAuth providers to prevent conflicts with other routes
    // Routes will be: /api/v1/auth/google, /api/v1/auth/github, /api/v1/auth/facebook
    oauthProviders.forEach(provider => {
      this.router.get(`/auth/${provider}`, this.oauthController.initiate.bind(this.oauthController));
      this.router.get(`/auth/${provider}/callback`, this.oauthController.callback.bind(this.oauthController));
      this.router.post(`/auth/${provider}/callback`, this.oauthController.exchangeCode.bind(this.oauthController));
    });

    // OAuth health check endpoint
    this.router.get('/health/oauth', async (req: Request, res: Response) => {
      const getCallbackUrl = (provider: string): string => {
        // Check if we're truly in local development (not deployed)
        // Local development is: 'development' (or undefined) with no EC2_URL or CLIENT_URL with chatappserver.space
        const isTrulyLocal = config.NODE_ENV === 'development' &&
                            !config.EC2_URL &&
                            !config.CLIENT_URL?.includes('chatappserver.space');

        if (isTrulyLocal) {
          return `http://localhost:5000/api/v1/auth/${provider}/callback`;
        }

        // For production, use the backend API URL
        // Check EC2_URL first (backend server URL)
        if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') &&
            (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
          return `${config.EC2_URL.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
        }

        // Fallback: use CLIENT_URL if it looks like a backend URL
        if (config.CLIENT_URL && !config.CLIENT_URL.includes('169.254.169.254')) {
          if (config.CLIENT_URL.includes(':5000') || config.CLIENT_URL.includes('/api')) {
            return `${config.CLIENT_URL.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
          }
        }

        // Final fallback - use the dev API domain (NOT frontend)
        return `https://api.dev.chatappserver.space/api/v1/auth/${provider}/callback`;
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
      // Set CORS headers before sending response
      this.setCorsHeaders(req, res);
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

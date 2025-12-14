import { serverAdapter } from './shared/services/queues/base.queue';
import { authRoutes } from './features/auth/routes/authRoutes';
import { Application, Router } from 'express';
import { currentUserRoutes } from '@auth/routes/currentRoutes';
import { authMiddleware } from '@global/helpers/auth-middleware';
import { postRoutes } from '@post/routes/postRoutes';
import { reactionRoutes } from '@reaction/routes/reactionRoutes';
import { commentRoutes } from '@comment/routes/commentRoutes';
import { followerRoutes } from '@follower/routes/followerRoutes';
import { notificationRoutes } from '@notification/routes/notificationRoutes';
import { imageRoutes } from '@image/routes/imageRoutes';
import { chatRoutes } from '@chat/routes/chatRoutes';
import { userRoutes } from '@user/routes/userRoutes';
import { healthRoutes } from '@user/routes/healthRoutes';
import { SignUp } from '@auth/controllers/signup';
import { SignIn } from '@auth/controllers/signin';
import { SignOut } from '@auth/controllers/signout';
import { OAuthController } from '@auth/controllers/oauth';

const BASE_PATH = '/api/v1';

export default (app: Application) => {
  const routes = () => {
    app.use('/queues', serverAdapter.getRouter());
    app.use('', healthRoutes.routes());

    // Handle OAuth callbacks at root level /auth/:provider/callback
    // This handles cases where Google OAuth redirects to dev.chatappserver.space/auth/google/callback
    // instead of api.dev.chatappserver.space/api/v1/auth/google/callback
    // MUST be registered BEFORE other routes to catch these requests early
    const oauthController = new OAuthController();
    const oauthRedirectRouter = Router();

    // Handle OPTIONS preflight
    oauthRedirectRouter.options('/auth/:provider/callback', (req, res) => {
      const origin = req.get('origin') || 'https://dev.chatappserver.space';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
      res.status(200).end();
    });

    oauthRedirectRouter.get('/auth/:provider/callback', (req, res, next) => {
      // Set CORS headers immediately
      const origin = req.get('origin') || 'https://dev.chatappserver.space';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');

      // Call the OAuth callback handler directly
      oauthController.callback(req, res, next);
    });

    // Register this router early, before other routes
    app.use('', oauthRedirectRouter);

    // Register auth routes (signup, signin, etc.) WITHOUT middleware
    // Use /auth prefix to match frontend expectations: /api/v1/auth/signup, /api/v1/auth/signin
    app.use(`${BASE_PATH}/auth`, authRoutes.routes());
    // Note: signoutRoute is now included in routes() above, but keeping for backward compatibility
    app.use(`${BASE_PATH}/auth`, authRoutes.signoutRoute());

    // Backward compatibility: Also support /api/v1/signup, /api/v1/signin, and /api/v1/signout (without /auth prefix)
    // This allows frontend to work with either path during transition
    const backwardCompatRouter = Router();
    backwardCompatRouter.post('/signup', SignUp.prototype.create);
    backwardCompatRouter.post('/signin', SignIn.prototype.read);
    backwardCompatRouter.get('/signout', SignOut.prototype.update);
    app.use(BASE_PATH, backwardCompatRouter);

    // All routes below require authentication
    app.use(BASE_PATH, authMiddleware.verifyUser, currentUserRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, postRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, reactionRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, commentRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, followerRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, notificationRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, imageRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, chatRoutes.routes());
    app.use(BASE_PATH, authMiddleware.verifyUser, userRoutes.routes());
  };
  routes();
};

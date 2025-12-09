import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import HTTP_STATUS from 'http-status-codes';
import { BadRequestError } from '@global/helpers/error-handler';
import { IAuthDocument } from '@auth/interfaces/auth.interface';
import { IUserDocument } from '@user/interfaces/user.interface';
import { authCodeService } from '@service/oauth/auth-code.service';
import { userService } from '@service/db/user.service';
import JWT from 'jsonwebtoken';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('oauthController');

export class OAuthController {
  /**
   * Initiate OAuth flow - redirect to provider
   */
  public initiate(req: Request, res: Response, next: NextFunction): void {
    try {
      const { provider } = req.params;
      const redirectUri = req.query.redirect_uri as string;

      log.info(`OAuth initiate request: provider=${provider}, redirect_uri=${redirectUri}`, {
        origin: req.get('origin'),
        referer: req.get('referer'),
        method: req.method,
        path: req.path
      });

      if (!redirectUri) {
        throw new BadRequestError('redirect_uri is required');
      }

      const validProviders = ['google', 'github', 'facebook'];
      if (!validProviders.includes(provider)) {
        throw new BadRequestError(`Invalid provider. Must be one of: ${validProviders.join(', ')}`);
      }

      // Check if OAuth credentials are configured
      if (provider === 'google' && (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET)) {
        log.error('Google OAuth credentials not configured');
        throw new BadRequestError('OAuth provider not configured');
      }
      if (provider === 'github' && (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET)) {
        log.error('GitHub OAuth credentials not configured');
        throw new BadRequestError('OAuth provider not configured');
      }
      if (provider === 'facebook' && (!config.FACEBOOK_APP_ID || !config.FACEBOOK_APP_SECRET)) {
        log.error('Facebook OAuth credentials not configured');
        throw new BadRequestError('OAuth provider not configured');
      }

      // Store redirect_uri in state parameter (base64 encoded)
      const state = Buffer.from(redirectUri).toString('base64');

      log.info(`Initiating ${provider} OAuth with state: ${state.substring(0, 20)}...`);

      // Authenticate with the provider
      // Note: passport.authenticate will redirect to the OAuth provider
      // This is a GET request that should redirect, not return JSON
      passport.authenticate(provider, {
        scope: provider === 'google' ? ['profile', 'email'] : provider === 'github' ? ['user:email'] : ['email'],
        state
      })(req, res, next);
    } catch (error) {
      log.error('Error in OAuth initiate:', error);
      next(error);
    }
  }

  /**
   * Handle OAuth provider callback (GET)
   * This is called by the OAuth provider after user authorization
   */
  public async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { provider } = req.params;

    passport.authenticate(
      provider,
      { session: false, failureRedirect: '/login' },
      async (err: Error | null, user: IAuthDocument | null) => {
        try {
          if (err || !user) {
            const errorMessage = err?.message || 'Authentication failed';
            const redirectUri = req.query.state
              ? Buffer.from(req.query.state as string, 'base64').toString()
              : `${req.protocol}://${req.get('host')}/auth/${provider}/callback`;
            res.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
            return;
          }

          // Get redirect_uri from state
          const redirectUri = req.query.state
            ? Buffer.from(req.query.state as string, 'base64').toString()
            : `${req.protocol}://${req.get('host')}/auth/${provider}/callback`;

          // Get user document
          const userDocument: IUserDocument = await userService.getUserByAuthId(`${user._id}`);

          if (!userDocument) {
            log.error(`User document not found for authId: ${user._id}`);
            const redirectUri = req.query.state
              ? Buffer.from(req.query.state as string, 'base64').toString()
              : `${req.protocol}://${req.get('host')}/auth/${provider}/callback`;
            res.redirect(`${redirectUri}?error=${encodeURIComponent('User profile not found')}`);
            return;
          }

          // Generate JWT token
          const token = JWT.sign(
            {
              userId: userDocument._id,
              uId: user.uId,
              email: user.email,
              username: user.username,
              avatarColor: user.avatarColor
            },
            config.JWT_TOKEN!
          );

          // Generate authorization code
          const code = await authCodeService.generateCode(`${userDocument._id}`, token);

          // Redirect to frontend with code
          res.redirect(`${redirectUri}?code=${code}`);
        } catch (error) {
          const redirectUri = req.query.state
            ? Buffer.from(req.query.state as string, 'base64').toString()
            : `${req.protocol}://${req.get('host')}/auth/${provider}/callback`;
          res.redirect(`${redirectUri}?error=${encodeURIComponent((error as Error).message)}`);
        }
      }
    )(req, res, next);
  }

  /**
   * Exchange authorization code for token and user data (POST)
   * This is called by the frontend after receiving the code
   */
  public async exchangeCode(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.body;

      if (!code) {
        throw new BadRequestError('Authorization code is required');
      }

      // Exchange code for user data and token
      const authData = await authCodeService.exchangeCode(code);

      if (!authData) {
        throw new BadRequestError('Invalid or expired authorization code');
      }

      // Get user from database
      const user: IUserDocument = await userService.getUserById(authData.userId);

      if (!user) {
        throw new BadRequestError('User not found');
      }

      // Set session cookie (same as regular signin)
      req.session = { jwt: authData.token };

      // Return token and user data
      res.status(HTTP_STATUS.OK).json({
        token: authData.token,
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          avatarColor: user.avatarColor,
          avatarImage: user.profilePicture,
          profilePicture: user.profilePicture,
          createdAt: user.createdAt
        }
      });
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new BadRequestError((error as Error).message);
    }
  }
}

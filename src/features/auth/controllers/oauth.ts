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

// Helper function for structured OAuth error logging
const logOAuthError = (provider: string, error: Error, context: Record<string, any>): void => {
  log.error(`OAuth error for ${provider}:`, {
    provider,
    error: error.message,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
};

export class OAuthController {
  /**
   * Validate redirect URI to prevent open redirects
   */
  private validateRedirectUri(redirectUri: string): boolean {
    try {
      const url = new URL(redirectUri);
      // Allow localhost for development
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return true;
      }
      // Check against allowed origins from config
      const allowedOrigins = [
        config.CLIENT_URL,
        config.EC2_URL,
        'https://dev.chatappserver.space',
        'https://api.dev.chatappserver.space',
        'https://staging.chatappserver.space',
        'https://api.staging.chatappserver.space',
        'https://chatappserver.space',
        'https://api.chatappserver.space'
      ].filter(Boolean);

      return allowedOrigins.some(origin => {
        if (!origin) return false;
        try {
          const originUrl = new URL(origin);
          // Check if same protocol, hostname, and port
          return url.protocol === originUrl.protocol &&
                 url.hostname === originUrl.hostname &&
                 url.port === originUrl.port;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  /**
   * Get the expected callback URL for a provider
   * NOTE: Callback URL must point to the BACKEND server, not the frontend CLIENT_URL
   */
  private getExpectedCallbackUrl(provider: string): string {
    // Check if we're truly in local development (not deployed)
    // Local development is: 'development' (or undefined) with no EC2_URL or CLIENT_URL with chatappserver.space
    const isTrulyLocal = config.NODE_ENV === 'development' &&
                        !config.EC2_URL &&
                        !config.CLIENT_URL?.includes('chatappserver.space');
    
    if (isTrulyLocal) {
      return `http://localhost:5000/api/v1/auth/${provider}/callback`;
    }

    // For staging and production, check EC2_URL first (backend server URL)
    if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') &&
        (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
      return `${config.EC2_URL.replace(/\/$/, '')}/api/v1/auth/${provider}/callback`;
    }

    // Environment-specific fallbacks based on NODE_ENV
    if (config.NODE_ENV === 'staging') {
      return `https://api.staging.chatappserver.space/api/v1/auth/${provider}/callback`;
    }

    if (config.NODE_ENV === 'production') {
      return `https://api.chatappserver.space/api/v1/auth/${provider}/callback`;
    }

    // Final fallback for development (deployed)
    return `https://api.dev.chatappserver.space/api/v1/auth/${provider}/callback`;
  }

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

      // Validate redirect URI to prevent open redirects
      if (!this.validateRedirectUri(redirectUri)) {
        log.error(`Invalid redirect_uri: ${redirectUri}`, {
          provider,
          origin: req.get('origin'),
          allowedOrigins: [config.CLIENT_URL, config.EC2_URL].filter(Boolean)
        });
        throw new BadRequestError('Invalid redirect_uri. The redirect URI must be from an allowed origin.');
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

      // Log the expected callback URL for debugging
      const expectedCallbackUrl = this.getExpectedCallbackUrl(provider);
      log.info(`Expected OAuth callback URL for ${provider}: ${expectedCallbackUrl}`);
      log.warn(`IMPORTANT: Make sure this callback URL is registered in your ${provider} OAuth app settings: ${expectedCallbackUrl}`);

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
    
    // Log callback request for debugging
    log.info(`OAuth callback received for ${provider}`, {
      path: req.path,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      query: req.query,
      origin: req.get('origin'),
      referer: req.get('referer'),
      userAgent: req.get('user-agent')
    });

    passport.authenticate(
      provider,
      { session: false, failureRedirect: '/login' },
      async (err: Error | null, user: IAuthDocument | null) => {
        // Helper function to safely get redirect URI
        const getRedirectUri = (): string => {
          try {
            if (req.query.state) {
              return Buffer.from(req.query.state as string, 'base64').toString();
            }
          } catch (error) {
            log.error('Error decoding state parameter:', error);
          }
          return `${req.protocol}://${req.get('host')}/auth/${provider}/callback`;
        };

        try {
          if (err || !user) {
            let errorMessage = err?.message || 'Authentication failed';

            // Provide more helpful error messages for common OAuth errors
            if (err?.message?.includes('redirect_uri_mismatch') ||
                err?.message?.includes('redirect_uri') ||
                err?.message?.includes('invalid_request')) {
              const expectedCallbackUrl = this.getExpectedCallbackUrl(provider);
              errorMessage = `OAuth callback URL mismatch. Expected: ${expectedCallbackUrl}. Please verify this URL is registered in your ${provider} OAuth app settings.`;
              log.error(`OAuth callback URL mismatch for ${provider}:`, {
                expected: expectedCallbackUrl,
                error: err?.message,
                hasState: !!req.query.state,
                userAgent: req.get('user-agent'),
                ip: req.ip
              });
            }

            const redirectUri = getRedirectUri();
            if (err) {
              logOAuthError(provider, err, {
                redirectUri,
                hasState: !!req.query.state,
                userAgent: req.get('user-agent'),
                ip: req.ip,
                expectedCallbackUrl: this.getExpectedCallbackUrl(provider)
              });
            } else {
              log.error(`OAuth callback failed for ${provider}:`, {
                error: errorMessage,
                redirectUri,
                hasState: !!req.query.state,
                userAgent: req.get('user-agent'),
                ip: req.ip,
                expectedCallbackUrl: this.getExpectedCallbackUrl(provider),
                timestamp: new Date().toISOString()
              });
            }
            res.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
            return;
          }

          const redirectUri = getRedirectUri();

          // Get user document
          const userDocument: IUserDocument = await userService.getUserByAuthId(`${user._id}`);

          if (!userDocument) {
            log.error(`User document not found for authId: ${user._id}`, {
              provider,
              userId: user._id,
              email: user.email
            });
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

          // Generate authorization code with error handling
          try {
            const code = await authCodeService.generateCode(`${userDocument._id}`, token);
            log.info(`OAuth callback successful for ${provider}`, {
              userId: userDocument._id,
              email: user.email
            });
            res.redirect(`${redirectUri}?code=${code}`);
          } catch (codeError) {
            // If code generation fails (e.g., Redis down), still redirect with error
            if (codeError instanceof Error) {
              logOAuthError(provider, codeError, {
                redirectUri,
                userId: userDocument._id,
                email: user.email,
                userAgent: req.get('user-agent'),
                ip: req.ip
              });
            } else {
              log.error(`Failed to generate auth code for ${provider}:`, {
                error: codeError,
                userId: userDocument._id,
                email: user.email,
                redirectUri,
                userAgent: req.get('user-agent'),
                ip: req.ip,
                timestamp: new Date().toISOString()
              });
            }
            const errorMessage = codeError instanceof Error ? codeError.message : 'Failed to complete authentication';
            res.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
          }
        } catch (error) {
          // Catch-all for any unexpected errors
          if (error instanceof Error) {
            logOAuthError(provider, error, {
              redirectUri: getRedirectUri(),
              hasState: !!req.query.state,
              userAgent: req.get('user-agent'),
              ip: req.ip
            });
          } else {
            log.error(`Unexpected error in OAuth callback for ${provider}:`, {
              error,
              stack: error instanceof Error ? error.stack : undefined,
              redirectUri: getRedirectUri(),
              hasState: !!req.query.state,
              userAgent: req.get('user-agent'),
              ip: req.ip,
              timestamp: new Date().toISOString()
            });
          }
          const redirectUri = getRedirectUri();
          const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
          res.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
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

      // Set session - DO NOT replace req.session, only modify it
      // cookie-session uses a Proxy to detect changes, so we must modify the existing object
      if (!req.session) {
        (req as any).session = {};
      }
      (req.session as any).jwt = authData.token;
      
      // ALSO set a regular cookie with the JWT as a fallback
      // Deployed environments are: 'develop', 'staging', 'production'
      // Local development is: 'development' (or undefined) with no EC2_URL or CLIENT_URL with chatappserver.space
      const isLocalDev = config.NODE_ENV === 'development' &&
                         !config.EC2_URL &&
                         !config.CLIENT_URL?.includes('chatappserver.space');
      
      const cookieOptions: any = {
        maxAge: 24 * 7 * 3600000,
        httpOnly: true,
        secure: !isLocalDev,
        sameSite: isLocalDev ? 'lax' : 'none',
        path: '/'
      };
      
      if (!isLocalDev) {
        cookieOptions.domain = '.chatappserver.space';
      }
      
      res.cookie('jwt', authData.token, cookieOptions);

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

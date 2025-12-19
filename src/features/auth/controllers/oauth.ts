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
import { ObjectId } from 'mongodb';
import { generateAvatarImage, generateAvatarColor } from '@global/helpers/oauth-helpers';

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
      log.info(`OAuth request details:`, {
        provider,
        expectedCallbackUrl,
        frontendRedirectUri: redirectUri,
        requestUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        userAgent: req.get('user-agent'),
        nodeEnv: config.NODE_ENV,
        ec2Url: config.EC2_URL,
        clientUrl: config.CLIENT_URL
      });

      // Authenticate with the provider
      // Note: passport.authenticate will redirect to the OAuth provider
      // The callbackURL is set in the Passport strategy configuration (passport.config.ts)
      // CRITICAL: The callbackURL in the strategy config is what Google will redirect to
      // This must ALWAYS be the backend API URL, never the frontend URL
      log.warn(`About to call passport.authenticate('${provider}') - callback URL should be: ${expectedCallbackUrl}`);
      passport.authenticate(provider, {
        scope: provider === 'google' ? ['profile', 'email'] : provider === 'github' ? ['user:email'] : ['email'],
        state
        // Note: We cannot override callbackURL here - it's set in the strategy config
        // If Google redirects to the wrong URL, check the strategy configuration in passport.config.ts
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

    // Set CORS headers immediately
    const origin = req.get('origin') || 'https://dev.chatappserver.space';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');

    // Log callback request for debugging
    log.info(`OAuth callback received for ${provider}`, {
      path: req.path,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      query: req.query,
      origin: req.get('origin'),
      referer: req.get('referer'),
      userAgent: req.get('user-agent')
    });

    // Log before passport authenticate
    log.info(`About to call passport.authenticate for ${provider}`, {
      query: req.query,
      hasCode: !!req.query.code,
      hasState: !!req.query.state,
      error: req.query.error,
      fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
    });

    passport.authenticate(
      provider,
      { session: false, failureRedirect: undefined }, // Don't use failureRedirect, handle errors manually
      async (err: Error | null, user: IAuthDocument | null) => {
        // Helper function to safely get redirect URI
        const getRedirectUri = (): string => {
          try {
            if (req.query.state) {
              const decoded = Buffer.from(req.query.state as string, 'base64').toString();
              // Ensure HTTPS for production (but keep http:// for localhost)
              if (decoded && decoded.startsWith('http://') && !decoded.includes('localhost')) {
                return decoded.replace('http://', 'https://');
              }
              if (decoded) {
                return decoded;
              }
            }
          } catch (error) {
            log.error('Error decoding state parameter:', error);
          }
          // Default: redirect to frontend OAuth callback route
          // Check if we're in local development first
          const isTrulyLocal = config.NODE_ENV === 'development' &&
                              !config.EC2_URL &&
                              !config.CLIENT_URL?.includes('chatappserver.space');
          
          if (isTrulyLocal) {
            // For local development, try to detect the frontend port from the referer or origin
            const referer = req.get('referer');
            const origin = req.get('origin');
            if (referer) {
              try {
                const refererUrl = new URL(referer);
                if (refererUrl.hostname === 'localhost' || refererUrl.hostname === '127.0.0.1') {
                  return `${refererUrl.origin}/auth/${provider}/callback`;
                }
              } catch (e) {
                // Invalid referer URL, continue to fallback
              }
            }
            if (origin) {
              try {
                const originUrl = new URL(origin);
                if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
                  return `${originUrl.origin}/auth/${provider}/callback`;
                }
              } catch (e) {
                // Invalid origin URL, continue to fallback
              }
            }
            // Fallback for local: use common localhost ports
            return `http://localhost:8080/auth/${provider}/callback`;
          }
          
          // For deployed environments, use CLIENT_URL or default
          const frontendUrl = config.CLIENT_URL || 'https://dev.chatappserver.space';
          // Ensure we redirect to the OAuth callback route, not just the root
          return `${frontendUrl}/auth/${provider}/callback`;
        };

        try {
          // Log passport authenticate result
          log.info(`passport.authenticate callback for ${provider}`, {
            hasError: !!err,
            hasUser: !!user,
            errorMessage: err?.message,
            query: req.query
          });

          if (err || !user) {
            let errorMessage = err?.message || 'Authentication failed';

            // Log detailed error info
            log.error(`OAuth authentication failed for ${provider}`, {
              error: err?.message,
              errorStack: err?.stack,
              query: req.query,
              fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
            });

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
            // Ensure redirect URI includes callback path
            const finalRedirectUri = redirectUri.includes('/auth/')
              ? redirectUri
              : `${redirectUri}/auth/${provider}/callback`;
            res.redirect(`${finalRedirectUri}?error=${encodeURIComponent(errorMessage)}`);
            return;
          }

          const redirectUri = getRedirectUri();

          // Get user document with timeout protection
          let userDocument: IUserDocument | null = null;
          try {
            const dbPromise = userService.getUserByAuthId(`${user._id}`);
            const dbTimeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Database operation timeout')), 3000);
            });
            userDocument = await Promise.race([dbPromise, dbTimeoutPromise]) as IUserDocument;
          } catch (dbError) {
            log.error(`Failed to get user document for authId: ${user._id}`, {
              provider,
              error: dbError instanceof Error ? dbError.message : 'Unknown error',
              userId: user._id,
              email: user.email
            });
            res.redirect(`${redirectUri}?error=${encodeURIComponent('Failed to retrieve user profile. Please try again.')}`);
            return;
          }

          // If user document doesn't exist, try to create it synchronously (fallback for queued creation)
          if (!userDocument) {
            log.warn(`User document not found for authId: ${user._id}, attempting to create synchronously`, {
              provider,
              userId: user._id,
              email: user.email
            });

            try {
              // Create user document from auth data
              const userObjectId = new ObjectId();
              const avatarColor = user.avatarColor || generateAvatarColor();
              const avatarImage = generateAvatarImage(user.username || user.email || 'User', avatarColor);

              const newUserData: IUserDocument = {
                _id: userObjectId,
                authId: user._id,
                uId: user.uId || `${Math.floor(Math.random() * 1000000000000)}`,
                username: user.username || 'User',
                email: user.email || '',
                avatarColor: avatarColor,
                profilePicture: avatarImage,
                blocked: [],
                blockedBy: [],
                work: '',
                location: '',
                school: '',
                quote: '',
                bgImageVersion: '',
                bgImageId: '',
                followersCount: 0,
                followingCount: 0,
                postsCount: 0,
                notifications: {
                  messages: true,
                  reactions: true,
                  comments: true,
                  follows: true
                },
                social: {
                  facebook: '',
                  instagram: '',
                  twitter: '',
                  youtube: ''
                }
              } as unknown as IUserDocument;

              // Create user document synchronously
              await userService.addUserData(newUserData);
              userDocument = newUserData;

              log.info(`Created user document synchronously for OAuth user`, {
                provider,
                userId: user._id,
                userObjectId: userObjectId.toString()
              });
            } catch (createError) {
              log.error(`Failed to create user document synchronously for authId: ${user._id}`, {
                provider,
                error: createError instanceof Error ? createError.message : 'Unknown error',
                userId: user._id,
                email: user.email
              });
              res.redirect(`${redirectUri}?error=${encodeURIComponent('User profile not found. Please try again in a moment.')}`);
              return;
            }
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

          // Generate authorization code - if Redis fails, embed token directly in code (base64)
          try {
            // Try to generate code with Redis (with fast timeout)
            const codePromise = authCodeService.generateCode(`${userDocument._id}`, token);
            const codeTimeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Code generation timeout')), 1000);
            });
            let code: string;
            try {
              code = await Promise.race([codePromise, codeTimeoutPromise]) as string;
            } catch (codeError) {
              // If Redis fails, create a temporary code with embedded token (valid for immediate exchange)
              log.warn('Redis code generation failed, using fallback method:', {
                error: codeError instanceof Error ? codeError.message : 'Unknown error'
              });
              // Create a temporary code by encoding token data (valid for 1 minute)
              const tempData = {
                userId: userDocument._id,
                token,
                createdAt: Date.now()
              };
              code = Buffer.from(JSON.stringify(tempData)).toString('base64');
            }

            log.info(`OAuth callback successful for ${provider}`, {
              userId: userDocument._id,
              email: user.email
            });
            // If redirectUri already has the callback path, use it as-is
            // Otherwise, append the callback path
            const finalRedirectUri = redirectUri.includes('/auth/')
              ? redirectUri
              : `${redirectUri}/auth/${provider}/callback`;
            res.redirect(`${finalRedirectUri}?code=${code}`);
          } catch (codeError) {
            // Fallback: redirect with token directly if everything fails
            log.error(`Failed to generate auth code for ${provider}, using direct token redirect:`, {
              error: codeError instanceof Error ? codeError.message : 'Unknown error',
              userId: userDocument._id,
              email: user.email
            });
            // Last resort: redirect with token (less secure but ensures OAuth works)
            const finalRedirectUri = redirectUri.includes('/auth/')
              ? redirectUri
              : `${redirectUri}/auth/${provider}/callback`;
            res.redirect(`${finalRedirectUri}?token=${encodeURIComponent(token)}&userId=${userDocument._id}`);
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
    // Set CORS headers immediately
    const origin = req.get('origin');
    // Allow localhost origins for local development
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.header('Access-Control-Allow-Origin', origin);
    } else if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // Fallback: check if we're in local development
      const isTrulyLocal = config.NODE_ENV === 'development' &&
                          !config.EC2_URL &&
                          !config.CLIENT_URL?.includes('chatappserver.space');
      if (isTrulyLocal) {
        res.header('Access-Control-Allow-Origin', 'http://localhost:8080');
      } else {
        res.header('Access-Control-Allow-Origin', config.CLIENT_URL || 'https://dev.chatappserver.space');
      }
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');

    try {
      const { code } = req.body;

      log.info('Code exchange request received', {
        hasCode: !!code,
        codeLength: code?.length || 0,
        codePrefix: code?.substring(0, 30) || 'N/A',
        origin: req.get('origin'),
        referer: req.get('referer')
      });

      if (!code) {
        log.error('No authorization code provided in exchange request', {
          body: req.body,
          bodyKeys: Object.keys(req.body || {})
        });
        throw new BadRequestError('Authorization code is required. Please ensure the OAuth callback completed successfully.');
      }

      // Exchange code for user data and token with timeout protection
      // Also handle direct token (fallback when Redis unavailable)
      let authData;

      // Check if code is actually a base64-encoded token (fallback method)
      try {
        const decodedStr = Buffer.from(code, 'base64').toString();
        const decoded = JSON.parse(decodedStr);
        if (decoded && decoded.token && decoded.userId && decoded.createdAt) {
          // Check if token is still valid (within 5 minutes for fallback codes - more lenient)
          const age = Date.now() - decoded.createdAt;
          if (age < 300000) { // 5 minutes
            authData = { userId: decoded.userId, token: decoded.token };
            log.info('Used fallback token code (Redis unavailable)', {
              userId: decoded.userId,
              age: Math.round(age / 1000) + 's'
            });
          } else {
            log.warn('Fallback token code expired', { age: Math.round(age / 1000) + 's' });
          }
        }
      } catch (decodeError) {
        // Not a fallback code or invalid base64/JSON - proceed with normal Redis exchange
        log.debug('Code is not base64-encoded fallback token, trying Redis exchange', {
          error: decodeError instanceof Error ? decodeError.message : 'Unknown decode error'
        });
      }

      // If not a fallback code, try Redis exchange
      if (!authData) {
        try {
          const codePromise = authCodeService.exchangeCode(code);
          const codeTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Code exchange timeout')), 1000);
          });
          authData = await Promise.race([codePromise, codeTimeoutPromise]);
        } catch (codeError) {
          log.error('Failed to exchange authorization code from Redis:', {
            error: codeError instanceof Error ? codeError.message : 'Unknown error',
            code: code?.substring(0, 30),
            codeLength: code?.length || 0
          });
          // Continue to check if authData was set
        }
      }

      // Check for direct token parameter (last resort fallback)
      if (!authData && req.body.token && req.body.userId) {
        authData = { userId: req.body.userId, token: req.body.token };
        log.info('Used direct token parameter (fallback method)');
      }

      if (!authData) {
        log.error('Authorization code exchange failed - code not found in Redis and no fallback token', {
          codeLength: code?.length || 0,
          codePrefix: code?.substring(0, 20) || 'N/A',
          hasBody: !!req.body,
          bodyKeys: req.body ? Object.keys(req.body) : []
        });
        throw new BadRequestError('Invalid or expired authorization code. The OAuth callback may not have completed successfully. Please try again.');
      }

      // Get user from database with timeout protection
      let user: IUserDocument;
      try {
        const dbPromise = userService.getUserById(authData.userId);
        const dbTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Database operation timeout')), 3000);
        });
        user = await Promise.race([dbPromise, dbTimeoutPromise]) as IUserDocument;
      } catch (dbError) {
        log.error('Failed to get user from database during code exchange:', {
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          userId: authData.userId
        });
        throw new BadRequestError('Failed to retrieve user data. Please try again.');
      }

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

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { config } from '@root/config';
import { AuthModel } from '@auth/models/auth.schema';
import { IAuthDocument } from '@auth/interfaces/auth.interface';
import { IUserDocument } from '@user/interfaces/user.interface';
import { ObjectId } from 'mongodb';
import { Helpers } from '@global/helpers/helpers';
import { generateAvatarColor, generateUsername, generateAvatarImage } from '@global/helpers/oauth-helpers';
import { UserCache } from '@service/redis/user.cache';
import { authQueue } from '@service/queues/auth.queue';
import { userQueue } from '@service/queues/user.queue';
import { omit } from 'lodash';
import Logger from 'bunyan';

const log: Logger = config.createLogger('passportConfig');
const userCache: UserCache = new UserCache();

// Helper function to construct callback URL consistently
// NOTE: Callback URL must point to the BACKEND server, not the frontend CLIENT_URL
const getCallbackURL = (provider: string): string => {
  // Check if we're truly in local development (not deployed)
  // Local development is: 'development' (or undefined) with no real EC2_URL (ignore AWS metadata service URL) or CLIENT_URL with chatappserver.space
  const isTrulyLocal = config.NODE_ENV === 'development' &&
                      (!config.EC2_URL || config.EC2_URL.includes('169.254.169.254')) &&
                      !config.CLIENT_URL?.includes('chatappserver.space');

  if (isTrulyLocal) {
    const url = `http://localhost:5000/api/v1/auth/${provider}/callback`;
    log.info(`${provider} OAuth callback URL (local development): ${url}`);
    return url;
  }

  // For staging and production, check EC2_URL first (backend server URL)
  if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') &&
      (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
    const baseUrl = config.EC2_URL.replace(/\/$/, '');
    const url = `${baseUrl}/api/v1/auth/${provider}/callback`;
    log.info(`${provider} OAuth callback URL (EC2_URL): ${url}`);
    // Validate: MUST be backend API domain, never frontend
    if (!url.includes('/api/v1/auth/') || (!url.includes('api.') && !url.includes('localhost'))) {
      log.error(`ERROR: Invalid callback URL from EC2_URL: ${url} - falling back to environment-specific URL`);
    } else {
      return url;
    }
  }

  // Environment-specific fallbacks based on NODE_ENV
  if (config.NODE_ENV === 'staging') {
    const url = `https://api.staging.chatappserver.space/api/v1/auth/${provider}/callback`;
    log.info(`${provider} OAuth callback URL (staging fallback): ${url}`);
    return url;
  }

  if (config.NODE_ENV === 'production') {
    const url = `https://api.chatappserver.space/api/v1/auth/${provider}/callback`;
    log.info(`${provider} OAuth callback URL (production fallback): ${url}`);
    return url;
  }

  // Final fallback for development (deployed)
  // CRITICAL: Always use backend API domain, NEVER frontend domain
  // If NODE_ENV is 'develop' or anything else that's not staging/production, use dev API
  const url = `https://api.dev.chatappserver.space/api/v1/auth/${provider}/callback`;
  log.warn(`${provider} OAuth callback URL (final fallback): ${url} - Make sure this matches your OAuth provider settings!`);
  log.warn(`Current environment: NODE_ENV=${config.NODE_ENV}, EC2_URL=${config.EC2_URL}, CLIENT_URL=${config.CLIENT_URL}`);
  
  // Final validation: ensure URL is correct format
  if (!url.includes('/api/v1/auth/') || (!url.includes('api.') && !url.includes('localhost'))) {
    log.error(`CRITICAL ERROR: Generated invalid callback URL: ${url} - This should NEVER happen!`);
    throw new Error(`Invalid OAuth callback URL generated: ${url}. This indicates a configuration error.`);
  }
  
  return url;
};

// Google OAuth Strategy
// Construct absolute callback URL
const getGoogleCallbackURL = (): string => {
  return getCallbackURL('google');
};

const googleCallbackURL = getGoogleCallbackURL();
log.info('Google OAuth Strategy configured with callback URL:', { callbackURL: googleCallbackURL });
log.warn('CRITICAL: This callback URL MUST match what is registered in Google OAuth Console');
log.warn('Expected: https://api.dev.chatappserver.space/api/v1/auth/google/callback (or appropriate environment)');
if (!googleCallbackURL.includes('api.') && !googleCallbackURL.includes('localhost')) {
  log.error(`ERROR: Callback URL does not point to backend API! URL: ${googleCallbackURL}`);
}
// Only register Google OAuth if credentials are provided
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        callbackURL: googleCallbackURL
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (accessToken: string, refreshToken: string, profile: any, done: (error: Error | null, user?: IAuthDocument) => void) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Email not provided by Google'), undefined);
        }

        // Find existing user by email or Google OAuth ID
        let authUser: IAuthDocument | null = (await AuthModel.findOne({
          $or: [{ email: Helpers.lowerCase(email) }, { 'oauth.google.id': profile.id }]
        }).exec()) as IAuthDocument | null;

        if (authUser) {
          // Update OAuth info if not already set
          if (!authUser.oauth) {
            authUser.oauth = {};
          }
          if (!authUser.oauth.google) {
            authUser.oauth.google = {
              id: profile.id,
              email: email
            };
          } else {
            authUser.oauth.google.id = profile.id;
            authUser.oauth.google.email = email;
          }
          await authUser.save();
        } else {
          // Create new user
          const authObjectId: ObjectId = new ObjectId();
          const userObjectId: ObjectId = new ObjectId();
          const uId = `${Helpers.generateRandomIntegers(12)}`;
          const avatarColor = generateAvatarColor();
          const username = generateUsername(email, profile.displayName);

          authUser = await AuthModel.create({
            _id: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            password: undefined, // OAuth users don't have passwords
            avatarColor,
            oauth: {
              google: {
                id: profile.id,
                email
              }
            },
            createdAt: new Date()
          } as IAuthDocument);

          // Create user document
          const avatarImage = generateAvatarImage(profile.displayName || email, avatarColor);
          const userData: IUserDocument = {
            _id: userObjectId,
            authId: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            avatarColor,
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

          // Save to cache (non-blocking - don't wait if Redis is slow)
          userCache.saveUserToCache(`${userObjectId}`, uId, userData).catch(err => {
            log.warn('Failed to save user to cache during Google OAuth:', err);
          });

          // Queue database writes
          const userResult = omit(userData, ['uId', 'username', 'email', 'avatarColor', 'password']);
          authQueue.addAuthUserJob('addAuthUserToDB', { value: authUser });
          userQueue.addUserJob('addUserToDB', { value: userResult });
        }

        return done(null, authUser);
      } catch (error) {
        log.error('Google OAuth error:', error);
        return done(error as Error, undefined);
      }
    }
  )
  );
} else {
  log.warn('Google OAuth credentials not configured - Google OAuth will be disabled');
}

// GitHub OAuth Strategy
const getGitHubCallbackURL = (): string => {
  return getCallbackURL('github');
};

// Only register GitHub OAuth if credentials are provided
if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: getGitHubCallbackURL()
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (accessToken: string, refreshToken: string, profile: any, done: (error: Error | null, user?: IAuthDocument) => void) => {
      try {
        // GitHub profile might not include email
        const email = profile.emails?.[0]?.value || `${profile.username}@users.noreply.github.com`;

        // Find existing user by email or GitHub OAuth ID
        let authUser: IAuthDocument | null = (await AuthModel.findOne({
          $or: [{ email: Helpers.lowerCase(email) }, { 'oauth.github.id': profile.id }]
        }).exec()) as IAuthDocument | null;

        if (authUser) {
          // Update OAuth info if not already set
          if (!authUser.oauth) {
            authUser.oauth = {};
          }
          if (!authUser.oauth.github) {
            authUser.oauth.github = {
              id: profile.id,
              username: profile.username
            };
          } else {
            authUser.oauth.github.id = profile.id;
            authUser.oauth.github.username = profile.username;
          }
          await authUser.save();
        } else {
          // Create new user
          const authObjectId: ObjectId = new ObjectId();
          const userObjectId: ObjectId = new ObjectId();
          const uId = `${Helpers.generateRandomIntegers(12)}`;
          const avatarColor = generateAvatarColor();
          const username = profile.username || generateUsername(email, profile.displayName);

          authUser = await AuthModel.create({
            _id: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            password: undefined,
            avatarColor,
            oauth: {
              github: {
                id: profile.id,
                username
              }
            },
            createdAt: new Date()
          } as IAuthDocument);

          // Create user document
          const avatarImage = generateAvatarImage(profile.displayName || profile.username || email, avatarColor);
          const userData: IUserDocument = {
            _id: userObjectId,
            authId: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            avatarColor,
            profilePicture: profile.photos?.[0]?.value || avatarImage,
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

          // Save to cache (non-blocking - don't wait if Redis is slow)
          userCache.saveUserToCache(`${userObjectId}`, uId, userData).catch(err => {
            log.warn('Failed to save user to cache during GitHub OAuth:', err);
          });

          // Queue database writes
          const userResult = omit(userData, ['uId', 'username', 'email', 'avatarColor', 'password']);
          authQueue.addAuthUserJob('addAuthUserToDB', { value: authUser });
          userQueue.addUserJob('addUserToDB', { value: userResult });
        }

        return done(null, authUser);
      } catch (error) {
        log.error('GitHub OAuth error:', error);
        return done(error as Error, undefined);
      }
    }
  )
  );
} else {
  log.warn('GitHub OAuth credentials not configured - GitHub OAuth will be disabled');
}

// Facebook OAuth Strategy
const getFacebookCallbackURL = (): string => {
  return getCallbackURL('facebook');
};

// Only register Facebook OAuth if credentials are provided
if (config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: config.FACEBOOK_APP_ID,
        clientSecret: config.FACEBOOK_APP_SECRET,
        callbackURL: getFacebookCallbackURL(),
        profileFields: ['id', 'displayName', 'email', 'picture.type(large)']
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (accessToken: string, refreshToken: string, profile: any, done: (error: Error | null, user?: IAuthDocument) => void) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Email not provided by Facebook'), undefined);
        }

        // Find existing user by email or Facebook OAuth ID
        let authUser: IAuthDocument | null = (await AuthModel.findOne({
          $or: [{ email: Helpers.lowerCase(email) }, { 'oauth.facebook.id': profile.id }]
        }).exec()) as IAuthDocument | null;

        if (authUser) {
          // Update OAuth info if not already set
          if (!authUser.oauth) {
            authUser.oauth = {};
          }
          if (!authUser.oauth.facebook) {
            authUser.oauth.facebook = {
              id: profile.id,
              email: email
            };
          } else {
            authUser.oauth.facebook.id = profile.id;
            authUser.oauth.facebook.email = email;
          }
          await authUser.save();
        } else {
          // Create new user
          const authObjectId: ObjectId = new ObjectId();
          const userObjectId: ObjectId = new ObjectId();
          const uId = `${Helpers.generateRandomIntegers(12)}`;
          const avatarColor = generateAvatarColor();
          const username = generateUsername(email, profile.displayName);

          authUser = await AuthModel.create({
            _id: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            password: undefined,
            avatarColor,
            oauth: {
              facebook: {
                id: profile.id,
                email
              }
            },
            createdAt: new Date()
          } as IAuthDocument);

          // Create user document
          const avatarImage = generateAvatarImage(profile.displayName || email, avatarColor);
          const userData: IUserDocument = {
            _id: userObjectId,
            authId: authObjectId,
            uId,
            username: Helpers.firstLetterUppercase(username),
            email: Helpers.lowerCase(email),
            avatarColor,
            profilePicture: profile.photos?.[0]?.value || avatarImage,
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

          // Save to cache (non-blocking - don't wait if Redis is slow)
          userCache.saveUserToCache(`${userObjectId}`, uId, userData).catch(err => {
            log.warn('Failed to save user to cache during Facebook OAuth:', err);
          });

          // Queue database writes
          const userResult = omit(userData, ['uId', 'username', 'email', 'avatarColor', 'password']);
          authQueue.addAuthUserJob('addAuthUserToDB', { value: authUser });
          userQueue.addUserJob('addUserToDB', { value: userResult });
        }

        return done(null, authUser);
      } catch (error) {
        log.error('Facebook OAuth error:', error);
        return done(error as Error, undefined);
      }
    }
  )
  );
} else {
  log.warn('Facebook OAuth credentials not configured - Facebook OAuth will be disabled');
}

export default passport;

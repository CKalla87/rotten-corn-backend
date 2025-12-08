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

// Google OAuth Strategy
// Construct absolute callback URL
const getGoogleCallbackURL = (): string => {
  // Use CLIENT_URL if available (should be the frontend domain, which is the same as backend)
  if (config.CLIENT_URL && !config.CLIENT_URL.includes('169.254.169.254')) {
    const url = `${config.CLIENT_URL}/api/v1/auth/google/callback`;
    log.info(`Google OAuth callback URL: ${url}`);
    return url;
  }
  // Check EC2_URL only if it's a valid URL (not the metadata endpoint)
  if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') && (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
    const url = `${config.EC2_URL}/api/v1/auth/google/callback`;
    log.info(`Google OAuth callback URL: ${url}`);
    return url;
  }
  // Fallback for development
  const url = config.NODE_ENV === 'development'
    ? 'http://localhost:5000/api/v1/auth/google/callback'
    : 'https://dev.chatappserver.space/api/v1/auth/google/callback';
  log.info(`Google OAuth callback URL (fallback): ${url}`);
  return url;
};

const googleCallbackURL = getGoogleCallbackURL();
passport.use(
  new GoogleStrategy(
    {
      clientID: config.GOOGLE_CLIENT_ID!,
      clientSecret: config.GOOGLE_CLIENT_SECRET!,
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
            authUser.oauth.google = {};
          }
          authUser.oauth.google.id = profile.id;
          authUser.oauth.google.email = email;
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

          // Save to cache
          await userCache.saveUserToCache(`${userObjectId}`, uId, userData);

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

// GitHub OAuth Strategy
const getGitHubCallbackURL = (): string => {
  // Use CLIENT_URL if available
  if (config.CLIENT_URL && !config.CLIENT_URL.includes('169.254.169.254')) {
    const url = `${config.CLIENT_URL}/api/v1/auth/github/callback`;
    log.info(`GitHub OAuth callback URL: ${url}`);
    return url;
  }
  // Check EC2_URL only if it's a valid URL
  if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') && (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
    const url = `${config.EC2_URL}/api/v1/auth/github/callback`;
    log.info(`GitHub OAuth callback URL: ${url}`);
    return url;
  }
  const url = config.NODE_ENV === 'development'
    ? 'http://localhost:5000/api/v1/auth/github/callback'
    : 'https://dev.chatappserver.space/api/v1/auth/github/callback';
  log.info(`GitHub OAuth callback URL (fallback): ${url}`);
  return url;
};

passport.use(
  new GitHubStrategy(
    {
      clientID: config.GITHUB_CLIENT_ID!,
      clientSecret: config.GITHUB_CLIENT_SECRET!,
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
            authUser.oauth.github = {};
          }
          authUser.oauth.github.id = profile.id;
          authUser.oauth.github.username = profile.username;
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

          // Save to cache
          await userCache.saveUserToCache(`${userObjectId}`, uId, userData);

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

// Facebook OAuth Strategy
const getFacebookCallbackURL = (): string => {
  // Use CLIENT_URL if available
  if (config.CLIENT_URL && !config.CLIENT_URL.includes('169.254.169.254')) {
    const url = `${config.CLIENT_URL}/api/v1/auth/facebook/callback`;
    log.info(`Facebook OAuth callback URL: ${url}`);
    return url;
  }
  // Check EC2_URL only if it's a valid URL
  if (config.EC2_URL && !config.EC2_URL.includes('169.254.169.254') && (config.EC2_URL.startsWith('http://') || config.EC2_URL.startsWith('https://'))) {
    const url = `${config.EC2_URL}/api/v1/auth/facebook/callback`;
    log.info(`Facebook OAuth callback URL: ${url}`);
    return url;
  }
  const url = config.NODE_ENV === 'development'
    ? 'http://localhost:5000/api/v1/auth/facebook/callback'
    : 'https://dev.chatappserver.space/api/v1/auth/facebook/callback';
  log.info(`Facebook OAuth callback URL (fallback): ${url}`);
  return url;
};

passport.use(
  new FacebookStrategy(
    {
      clientID: config.FACEBOOK_APP_ID!,
      clientSecret: config.FACEBOOK_APP_SECRET!,
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
            authUser.oauth.facebook = {};
          }
          authUser.oauth.facebook.id = profile.id;
          authUser.oauth.facebook.email = email;
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

          // Save to cache
          await userCache.saveUserToCache(`${userObjectId}`, uId, userData);

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

export default passport;

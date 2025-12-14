import { redisConnection } from './shared/services/redis/redis.connection';
import mongoose from 'mongoose';
import Logger from 'bunyan';
import { config } from '@root/config';

const log: Logger = config.createLogger('setupDatabase');

export default () => {
  // Add connection event handlers for better diagnostics
  mongoose.connection.on('connected', () => {
    log.info('Mongoose connected to database');
    log.info(`Database readyState: ${mongoose.connection.readyState} (1=connected)`);
  });

  mongoose.connection.on('error', (error) => {
    log.error('Mongoose connection error:', error);
    log.error(`Database readyState: ${mongoose.connection.readyState}`);
  });

  mongoose.connection.on('disconnected', () => {
    log.warn('Mongoose disconnected from database');
    log.warn(`Database readyState: ${mongoose.connection.readyState} (0=disconnected)`);
  });

  mongoose.connection.on('connecting', () => {
    log.info('Mongoose connecting to database...');
    log.info(`Database readyState: ${mongoose.connection.readyState} (2=connecting)`);
  });

  const connect = () => {
    mongoose.set('strictQuery', false);
    // Disable bufferCommands to prevent operations from being queued when disconnected
    // This ensures immediate error handling instead of buffering
    mongoose.set('bufferCommands', false);

    // Clean the connection string to remove any potential deprecated options
    let connectionUrl = config.DATABASE_URL || '';

    if (!connectionUrl) {
      log.error('DATABASE_URL is not set! Using default localhost URL');
      connectionUrl = 'mongodb://localhost:27017/rotterncornapp-backend';
    }

    // Log connection attempt (but mask sensitive info)
    const maskedUrl = connectionUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
    log.info(`Attempting to connect to database: ${maskedUrl}`);
    log.info(`Current readyState before connect: ${mongoose.connection.readyState}`);

    // Remove any buffermaxentries or bufferMaxEntries from the URL if present
    if (connectionUrl) {
      // Remove buffermaxentries in various forms
      connectionUrl = connectionUrl.replace(/[?&]buffermaxentries=[^&]*/gi, '');
      connectionUrl = connectionUrl.replace(/[?&]bufferMaxEntries=[^&]*/gi, '');
      connectionUrl = connectionUrl.replace(/[?&]bufferMaxEntries=[^&]*/gi, '');
      // Clean up any double ampersands or question marks
      connectionUrl = connectionUrl.replace(/[?&]{2,}/g, (match) => match[0]);
      // Remove trailing & or ? if present
      connectionUrl = connectionUrl.replace(/[?&]$/, '');
    }

    // Connect with timeout and retry options
    mongoose
      .connect(connectionUrl, {
        // Explicitly set options to avoid deprecated ones
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000, // 10 second timeout for server selection
        socketTimeoutMS: 45000, // 45 second timeout for socket operations
        connectTimeoutMS: 10000, // 10 second timeout for initial connection
        retryWrites: true,
        retryReads: true
      })
      .then(() => {
        log.info('Successfully connected to database.');
        log.info(`Database readyState: ${mongoose.connection.readyState} (1=connected)`);
        log.info(`Database name: ${mongoose.connection.db?.databaseName || 'unknown'}`);
        // Connect to Redis in background (non-blocking)
        // Use setImmediate to ensure this runs after the current execution context
        // This ensures the app server can start even if Redis connection fails
        setImmediate(() => {
          redisConnection.connect().catch((error) => {
            log.warn('Redis connection initiated but will retry in background:', error);
          });
        });
      })
      .catch((error) => {
        log.error('Error connecting to database:', error);
        log.error(`Database readyState: ${mongoose.connection.readyState}`);
        log.error('Database URL configured:', config.DATABASE_URL ? 'YES' : 'NO');
        if (config.DATABASE_URL) {
          const maskedUrl = config.DATABASE_URL.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
          log.error('Database URL (masked):', maskedUrl);
        }

        // Log specific error types for better debugging
        if (error.name === 'MongoServerSelectionError') {
          log.error('MongoDB server selection failed - check network connectivity and server availability');
        } else if (error.name === 'MongoNetworkError') {
          log.error('MongoDB network error - check if database server is reachable');
        } else if (error.name === 'MongoAuthenticationError') {
          log.error('MongoDB authentication failed - check credentials');
        }

        // Don't exit immediately - retry connection instead
        log.info('Retrying database connection in 5 seconds...');
        setTimeout(connect, 5000);
      });
  };
  connect();

  mongoose.connection.on('disconnected', () => {
    log.warn('Database disconnected, attempting to reconnect...');
    connect();
  });
};

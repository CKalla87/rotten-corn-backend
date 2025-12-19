import { redisConnection } from './shared/services/redis/redis.connection';
import mongoose from 'mongoose';
import Logger from 'bunyan';
import { config } from '@root/config';

const log: Logger = config.createLogger('setupDatabase');

export default () => {
  const connect = () => {
    mongoose.set('strictQuery', false);

    // Optimize MongoDB connection for hosted environments
    // 'development' = local, 'develop'/'staging'/'production' = hosted
    const isHostedEnv = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging' || config.NODE_ENV === 'develop';
    const connectionOptions = isHostedEnv ? {
      maxPoolSize: 10, // Maximum number of connections in the pool
      minPoolSize: 5, // Minimum number of connections to maintain
      serverSelectionTimeoutMS: 5000, // Timeout for server selection (5 seconds)
      socketTimeoutMS: 45000, // Socket timeout (45 seconds)
      connectTimeoutMS: 10000, // Connection timeout (10 seconds)
    } : {};

    mongoose
      .connect(`${config.DATABASE_URL}`, connectionOptions)
      .then(() => {
        log.info('Successfully connected to database.');
        // Connect to Redis asynchronously - don't await, allow app to start even if Redis fails
        redisConnection.connect().catch((error) => {
          log.error('Redis connection failed in setupDatabase, app will continue', error);
        });
      })
      .catch((error) => {
        log.error('Error connecting to database', error);
        return process.exit(1);
      });
  };
  connect();

  mongoose.connection.on('disconnected', connect);
};

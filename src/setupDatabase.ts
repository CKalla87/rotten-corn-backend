import { redisConnection } from './shared/services/redis/redis.connection';
import mongoose from 'mongoose';
import Logger from 'bunyan';
import { config } from '@root/config';

const log: Logger = config.createLogger('setupDatabase');

export default () => {
  const connect = () => {
    mongoose.set('strictQuery', false);
    mongoose
      .connect(`${config.DATABASE_URL}`)
      .then(() => {
        log.info('Successfully connected to database.');
        redisConnection.connect();
      })
      .catch((error) => {
        log.error('Error connecting to database', error);
        log.error('Database URL:', config.DATABASE_URL ? '***configured***' : 'NOT SET');
        // Don't exit immediately - retry connection instead
        log.info('Retrying database connection in 5 seconds...');
        setTimeout(connect, 5000);
      });
  };
  connect();

  mongoose.connection.on('disconnected', connect);
};

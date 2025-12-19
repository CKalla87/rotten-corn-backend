import express, { Express } from 'express';
import { RottenCornServer } from '@root/setupServer';
import databaseConnection from '@root/setupDatabase';
import { config } from '@root/config';
import Logger from 'bunyan';

const log: Logger = config.createLogger('app');

class Application {
  public initialize(): void {
    this.loadConfig();
    databaseConnection();
    const app: Express = express();
    const server: RottenCornServer = new RottenCornServer(app);
    server.start();
    Application.handleExit();
  }

  private loadConfig(): void {
    config.validateConfig();
    config.cloudinaryConfig();
  }

  private static handleExit(): void {
    process.on('uncaughtException', (error: Error) => {
      log.error(error);
      Application.shutDownProperly(1);
    });

    process.on('unhandledRejection', (reason: unknown) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);
      // Don't crash on Redis connection errors - they're handled gracefully
      if (errorMessage.includes('Redis') || errorMessage.includes('redis') || 
          errorMessage.includes('Connection timeout') || errorMessage.includes('connection timeout')) {
        log.warn('Unhandled Redis-related promise rejection (non-fatal, app will continue)', reason);
        return; // Don't shut down - allow app to continue
      }
      // For other unhandled rejections, log and shut down
      log.error('Unhandled promise rejection (non-Redis)', reason);
      Application.shutDownProperly(2);
    });

    process.on('SIGTERM', () => {
      log.info('Caught SIGTERM');
      Application.shutDownProperly(2);
    });

    process.on('SIGINT', () => {
      log.info('Caught SIGTERM');
      Application.shutDownProperly(2);
    });
  }

  private static shutDownProperly(exitCode: number): void {
    Promise.resolve()
      .then(() => {
        log.info('Shutdown complete');
        process.exit(exitCode);
      })
      .catch((error) => {
        log.error(`Error during shutdown: ${error}`);
        process.exit(1);
      });
  }
}

const application: Application = new Application();
application.initialize();

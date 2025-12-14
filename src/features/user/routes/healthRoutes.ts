import { Router, Request, Response } from 'express';
import express from 'express';
import HTTP_STATUS from 'http-status-codes';
import { config } from '@root/config';
import axios from 'axios';
import moment from 'moment';
import mongoose from 'mongoose';
import { authCodeService } from '@service/oauth/auth-code.service';

class HealthRoutes {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  public routes(): Router {
    // Handle OPTIONS preflight for health endpoint
    this.router.options('/health', (req: Request, res: Response) => {
      const origin = req.get('origin');
      const allowedOrigins = [
        config.CLIENT_URL,
        'https://dev.chatappserver.space',
        'https://staging.chatappserver.space',
        'https://api.dev.chatappserver.space',
        'https://api.staging.chatappserver.space',
        'https://chatappserver.space',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080'
      ].filter(Boolean);

      if (origin) {
        const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
        const originHost = normalizedOrigin.replace(/^https?:\/\//, '');

        const isAllowed = allowedOrigins.some(allowed => {
          if (!allowed) return false;
          const normalizedAllowed = allowed.replace(/\/$/, '').toLowerCase();
          const allowedHost = normalizedAllowed.replace(/^https?:\/\//, '');
          
          if (normalizedOrigin === normalizedAllowed || originHost === allowedHost) {
            return true;
          }
          
          const baseDomain = allowedHost.split('.').slice(-2).join('.');
          const originBaseDomain = originHost.split('.').slice(-2).join('.');
          return originBaseDomain === baseDomain && baseDomain === 'chatappserver.space';
        });

        if (isAllowed) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Credentials', 'true');
          res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
          res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
          res.header('Access-Control-Max-Age', '86400');
        }
      }
      res.status(200).end();
    });

    this.router.get('/health', async (req: Request, res: Response) => {
      // Explicitly set CORS headers for health endpoint
      const origin = req.get('origin');
      const allowedOrigins = [
        config.CLIENT_URL,
        'https://dev.chatappserver.space',
        'https://staging.chatappserver.space',
        'https://api.dev.chatappserver.space',
        'https://api.staging.chatappserver.space',
        'https://chatappserver.space',
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080'
      ].filter(Boolean);

      if (origin) {
        const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
        const originHost = normalizedOrigin.replace(/^https?:\/\//, '');

        const isAllowed = allowedOrigins.some(allowed => {
          if (!allowed) return false;
          const normalizedAllowed = allowed.replace(/\/$/, '').toLowerCase();
          const allowedHost = normalizedAllowed.replace(/^https?:\/\//, '');
          
          if (normalizedOrigin === normalizedAllowed || originHost === allowedHost) {
            return true;
          }
          
          const baseDomain = allowedHost.split('.').slice(-2).join('.');
          const originBaseDomain = originHost.split('.').slice(-2).join('.');
          return originBaseDomain === baseDomain && baseDomain === 'chatappserver.space';
        });

        if (isAllowed) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Credentials', 'true');
          res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
          res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
          res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Set-Cookie');
        }
      } else {
        // Allow requests with no origin (like health checks from ALB)
        res.header('Access-Control-Allow-Origin', '*');
      }

      // Get database connection state with detailed info
      const dbReadyState = mongoose.connection.readyState;
      const dbStateMap: { [key: number]: string } = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };
      const dbState = dbStateMap[dbReadyState] || `unknown (${dbReadyState})`;
      const isDbConnected = dbReadyState === 1;
      
      const health = {
        status: isDbConnected ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        processId: process.pid,
        services: {
          database: {
            status: isDbConnected ? 'connected' : dbState,
            readyState: dbReadyState,
            host: mongoose.connection.host || 'unknown',
            port: mongoose.connection.port || 'unknown',
            name: mongoose.connection.name || 'unknown'
          },
          redis: await authCodeService.isRedisAvailable() ? 'available' : 'unavailable',
          oauth: {
            google: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
            github: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
            facebook: !!(config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET)
          }
        }
      };
      
      // Return 503 if critical services are down
      // Note: 503 is expected during startup while database is connecting
      // The ALB health check now accepts both 200 and 503 as valid responses
      const isHealthy = isDbConnected;
      res.status(isHealthy ? 200 : 503).json(health);
    });

    this.router.get('/env', (req: Request, res: Response) => {
      res.status(HTTP_STATUS.OK).send(`This is the ${config.NODE_ENV} environment.`);
    });

    this.router.get('/instance', async (req: Request, res: Response) => {
      try {
        if (config.EC2_URL) {
          const response = await axios({
            method: 'get',
            url: config.EC2_URL,
            timeout: 2000
          });
          res
            .status(HTTP_STATUS.OK)
            .send(`Server is running on EC2 instance with id ${response.data} and process id ${process.pid} on ${moment().format('LL')}`);
        } else {
          res.status(HTTP_STATUS.OK).send(`Server is running locally with process id ${process.pid} on ${moment().format('LL')}`);
        }
      } catch (error) {
        res.status(HTTP_STATUS.OK).send(`Server is running locally with process id ${process.pid} on ${moment().format('LL')}`);
      }
    });

    this.router.get('/fibo/:num', async (req: Request, res: Response) => {
      const { num } = req.params;
      const start: number = performance.now();
      const result: number = this.fibo(parseInt(num, 10));
      const end: number = performance.now();
      try {
        if (config.EC2_URL) {
          const response = await axios({
            method: 'get',
            url: config.EC2_URL,
            timeout: 2000
          });
          res
            .status(HTTP_STATUS.OK)
            .send(
              `Fibonacci series of ${num} is ${result} and it took ${end - start}ms with EC2 instance of ${response.data} and process id ${
                process.pid
              } on ${moment().format('LL')}`
            );
        } else {
          res
            .status(HTTP_STATUS.OK)
            .send(
              `Fibonacci series of ${num} is ${result} and it took ${end - start}ms running locally with process id ${
                process.pid
              } on ${moment().format('LL')}`
            );
        }
      } catch (error) {
        res
          .status(HTTP_STATUS.OK)
          .send(
            `Fibonacci series of ${num} is ${result} and it took ${end - start}ms running locally with process id ${
              process.pid
            } on ${moment().format('LL')}`
          );
      }
    });

    return this.router;
  }

  private fibo(data: number): number {
    if (data < 2) {
      return 1;
    } else {
      return this.fibo(data - 2) + this.fibo(data - 1);
    }
  }
}

export const healthRoutes: HealthRoutes = new HealthRoutes();

import { Application, json, urlencoded, Response, Request, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import HTTP_STATUS from 'http-status-codes';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import Logger from 'bunyan';
import statusMonitor from 'express-status-monitor';
import 'express-async-errors';
import passport from 'passport';
import { config } from '@root/config';
import applicationRoutes from '@root/routes';
import { CustomError, IErrorResponse } from '@global/helpers/error-handler';
import { SocketIOPostHandler } from '@socket/post';
import { SocketIOFollowerHandler } from '@socket/follower';
import { SocketIOUserHandler } from '@socket/user';
import { SocketIONotificationHandler } from '@socket/notification';
import { SocketIOImageHandler } from '@socket/image';
import { SocketIOChatHandler } from '@socket/chat';

const SERVER_PORT = 5000;
const log: Logger = config.createLogger('server');

export class RottenCornServer {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  public start(): void {
    this.securityMiddleware(this.app);
    this.standardMiddleware(this.app);
    this.routeMiddleware(this.app);
    this.apiMonitoring(this.app);
    this.globalErrorHandler(this.app);
    this.startServer(this.app);
  }

  private securityMiddleware(app: Application): void {
    // Parse cookies first (needed for JWT cookie fallback)
    app.use(cookieParser());
    
    // Determine if we're in local development
    const isLocalDev = config.NODE_ENV === 'development' &&
                       !config.EC2_URL &&
                       !config.CLIENT_URL?.includes('chatappserver.space');
    
    app.use(
      cookieSession({
        name: 'session',
        keys: [config.SECRET_KEY_ONE!, config.SECRET_KEY_TWO!],
        maxAge: 24 * 7 * 3600000, // 7 days in milliseconds (was missing a zero)
        secure: !isLocalDev, // false for localhost, true for deployed
        sameSite: isLocalDev ? 'lax' : 'none', // lax for localhost, none for cross-site
        httpOnly: true
      })
    );
    // Initialize Passport middleware (required for OAuth)
    app.use(passport.initialize());
    app.use(hpp());
    app.use(helmet());
    // CORS configuration - allow localhost for local development (reuse isLocalDev)
    
    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
          return callback(null, true);
        }
        
        // Allow localhost for local development
        if (isLocalDev && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          return callback(null, true);
        }
        
        // Allow configured CLIENT_URL and common deployed URLs
        const allowedOrigins = [
          config.CLIENT_URL,
          'https://dev.chatappserver.space',
          'https://staging.chatappserver.space',
          'https://chatappserver.space'
        ].filter(Boolean);
        
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      optionsSuccessStatus: 200,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
    };
    
    app.use(cors(corsOptions));
  }

  private standardMiddleware(app: Application): void {
    // Optimize compression for hosted environments - use higher compression level
    const isProduction = config.NODE_ENV === 'production' || config.NODE_ENV === 'staging' || config.NODE_ENV === 'development';
    app.use(compression({
      level: isProduction ? 6 : 1, // Higher compression in hosted envs (6), lower in local (1) for speed
      threshold: 1024, // Only compress responses > 1KB
      filter: (req, res) => {
        // Compress JSON and text responses
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      }
    }));
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));
  }

  private routeMiddleware(app: Application): void {
    applicationRoutes(app);
  }

  private apiMonitoring(app: Application): void {
    app.use(
      statusMonitor({
        path: '/api-monitoring',
        title: 'API Monitoring',
        spans: [
          { interval: 1, retention: 60 },
          { interval: 5, retention: 60 },
          { interval: 15, retention: 60 }
        ],
        chartVisibility: {
          cpu: true,
          mem: true,
          load: true,
          heap: true,
          responseTime: true,
          rps: true,
          statusCodes: true
        },
        healthChecks: []
      })
    );
  }

  private globalErrorHandler(app: Application): void {
    // Handling urls that do not exist.
    app.all('*', (req: Request, res: Response) => {
      res.status(HTTP_STATUS.NOT_FOUND).json({ message: `${req.originalUrl} not found` });
    });

    app.use((error: IErrorResponse, _req: Request, res: Response, next: NextFunction) => {
      log.error(error);
      if (error instanceof CustomError) {
        return res.status(error.statusCode).json(error.serializeErrors());
      }
      next();
    });
  }

  private async startServer(app: Application): Promise<void> {
    if (!config.JWT_TOKEN) throw new Error('JWT_TOKEN must be provided');
    try {
      const httpServer: http.Server = new http.Server(app);
      const sockeIO: Server = await this.createSocketID(httpServer);
      this.startHttpServer(httpServer);
      this.socketIOConnections(sockeIO);
    } catch (error) {
      log.error(error);
    }
  }

  private async createSocketID(httpServer: http.Server): Promise<Server> {
    const io: Server = new Server(httpServer, {
      cors: {
        origin: config.CLIENT_URL,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      }
    });
    
    // Try to connect to Redis for Socket.IO adapter, but don't crash if it fails
    // Socket.IO will work without Redis adapter (single instance mode)
    try {
      const pubClient = createClient({ 
        url: config.REDIS_HOST,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries: number) => {
            if (retries > 5) {
              return false; // Stop retrying after 5 attempts
            }
            return Math.min(retries * 100, 2000);
          }
        }
      });
      const subClient = pubClient.duplicate();
      
      // Set a timeout for Redis connection
      const connectPromise = Promise.all([pubClient.connect(), subClient.connect()]);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 10000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      io.adapter(createAdapter(pubClient, subClient));
      log.info('Socket.IO Redis adapter connected successfully');
    } catch (error) {
      log.error('Failed to connect Redis adapter for Socket.IO, continuing without it', error);
      // Continue without Redis adapter - Socket.IO will work in single-instance mode
      // This allows the app to start even if Redis is unavailable
    }
    
    return io;
  }

  private startHttpServer(httpServer: http.Server): void {
    log.info(`Worker with process id of ${process.pid} has started.`);
    log.info(`Server has started with process ${process.pid}`);
    httpServer.listen(SERVER_PORT, () => {
      log.info(`Server running on port ${SERVER_PORT}`);
    });
  }

  private socketIOConnections(io: Server): void {
    const postSocketHandler: SocketIOPostHandler = new SocketIOPostHandler(io);
    const followerSocketHandler: SocketIOFollowerHandler = new SocketIOFollowerHandler(io);
    const userSocketHandler: SocketIOUserHandler = new SocketIOUserHandler(io);
    const notificationSocketHandler: SocketIONotificationHandler = new SocketIONotificationHandler();
    const chatSocketHandler: SocketIOChatHandler = new SocketIOChatHandler(io);
    const imageSocketHandler: SocketIOImageHandler = new SocketIOImageHandler();

    postSocketHandler.listen();
    followerSocketHandler.listen();
    userSocketHandler.listen();
    notificationSocketHandler.listen(io);
    chatSocketHandler.listen();
    imageSocketHandler.listen(io);
  }
}

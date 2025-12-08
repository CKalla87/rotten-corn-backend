import { Application, json, urlencoded, Response, Request, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import cookieSession from 'cookie-session';
import HTTP_STATUS from 'http-status-codes';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import Logger from 'bunyan';
import statusMonitor from 'express-status-monitor';
import 'express-async-errors';
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
    app.use(
      cookieSession({
        name: 'session',
        keys: [config.SECRET_KEY_ONE!, config.SECRET_KEY_TWO!],
        maxAge: 24 * 7 * 360000,
        secure: config.NODE_ENV !== 'development',
        sameSite: config.NODE_ENV !== 'development' ? 'none' : 'lax',
        domain: config.NODE_ENV !== 'development' ? '.chatappserver.space' : undefined
      })
    );
    app.use(hpp());
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ['\'self\''],
            styleSrc: ['\'self\'', '\'unsafe-inline\''],
            scriptSrc: ['\'self\''],
            imgSrc: ['\'self\'', 'data:', 'https:'],
            connectSrc: ['\'self\'', config.CLIENT_URL || '*', 'https://dev.chatappserver.space', 'https://api.dev.chatappserver.space', 'https://chatappserver.space', 'https://accounts.google.com', 'https://github.com', 'https://www.facebook.com'],
            frameSrc: ['\'self\'', 'https://accounts.google.com', 'https://github.com', 'https://www.facebook.com'],
            formAction: ['\'self\'', 'https://accounts.google.com', 'https://github.com', 'https://www.facebook.com']
          }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
      })
    );

    // Configure CORS to allow multiple origins (dev and production)
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://dev.chatappserver.space',
      'https://api.dev.chatappserver.space',
      'https://chatappserver.space',
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean); // Remove undefined values

    app.use(
      cors({
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
          // Allow requests with no origin (like mobile apps, curl requests, or server-to-server)
          if (!origin) {
            log.info('CORS: Allowing request with no origin header');
            return callback(null, true);
          }

          // Normalize origin for comparison (remove trailing slash)
          const normalizedOrigin = origin.replace(/\/$/, '');

          // Check if origin is in allowed list (exact match or domain match)
          const isAllowed = allowedOrigins.some(allowed => {
            if (!allowed) return false;
            const normalizedAllowed = allowed.replace(/\/$/, '');
            const allowedDomain = normalizedAllowed.replace(/^https?:\/\//, '');
            const originDomain = normalizedOrigin.replace(/^https?:\/\//, '');

            // Exact match
            if (normalizedOrigin === normalizedAllowed) {
              log.info(`CORS: Allowing exact match: ${origin}`);
              return true;
            }

            // Subdomain match (e.g., api.dev.chatappserver.space matches dev.chatappserver.space or chatappserver.space)
            // Check if both are subdomains of the same base domain
            const baseDomain = allowedDomain.split('.').slice(-2).join('.'); // Get last 2 parts (e.g., chatappserver.space)
            const originBaseDomain = originDomain.split('.').slice(-2).join('.');

            if (originBaseDomain === baseDomain) {
              log.info(`CORS: Allowing subdomain match: ${origin} matches base domain ${baseDomain}`);
              return true;
            }

            // Domain match (e.g., https://dev.chatappserver.space matches dev.chatappserver.space)
            if (normalizedOrigin.includes(allowedDomain)) {
              log.info(`CORS: Allowing domain match: ${origin} matches ${allowed}`);
              return true;
            }

            return false;
          });

          if (isAllowed) {
            // Pass the actual origin to set the Access-Control-Allow-Origin header correctly
            callback(null, normalizedOrigin);
          } else {
            // Log for debugging
            log.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    );
  }

  private standardMiddleware(app: Application): void {
    app.use(compression());
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));

    // Request logging middleware for debugging
    app.use((req: Request, _res: Response, next: NextFunction) => {
      // Log OAuth requests for debugging
      if (req.path.startsWith('/api/v1/auth/')) {
        log.info(`[OAUTH] ${req.method} ${req.path}`, {
          query: req.query,
          origin: req.get('origin'),
          referer: req.get('referer'),
          userAgent: req.get('user-agent')
        });
      }
      // Log POST requests in development
      if (config.NODE_ENV === 'development' && req.path.startsWith('/api/v1/post')) {
        log.info(`[POST DEBUG] ${req.method} ${req.path}`, {
          bodyKeys: Object.keys(req.body || {}),
          hasAuth: !!req.session?.jwt,
          contentType: req.get('content-type'),
          contentLength: req.get('content-length')
        });
      }
      next();
    });
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
    // Error handler middleware - must come before catch-all route
    app.use((error: IErrorResponse, req: Request, res: Response, next: NextFunction) => {
      log.error(`Error on ${req.method} ${req.originalUrl}:`, error);
      if (error instanceof CustomError) {
        return res.status(error.statusCode).json(error.serializeErrors());
      }
      // Handle non-CustomError errors
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        message: error.message || 'Internal server error',
        status: 'error',
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      });
    });

    // Handling urls that do not exist - must come last
    app.all('*', (req: Request, res: Response) => {
      log.warn(`Route not found: ${req.method} ${req.originalUrl}`);
      res.status(HTTP_STATUS.NOT_FOUND).json({
        message: `${req.originalUrl} not found`,
        status: 'error',
        statusCode: HTTP_STATUS.NOT_FOUND
      });
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
    // Use the same allowed origins as HTTP CORS
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://dev.chatappserver.space',
      'https://api.dev.chatappserver.space',
      'https://chatappserver.space',
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean);

    const io: Server = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin || allowedOrigins.some(allowed => origin === allowed || origin.includes(allowed?.replace(/^https?:\/\//, '') || ''))) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true
      }
    });
    const pubClient = createClient({ url: config.REDIS_HOST });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
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

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
    // Register OAuth routes FIRST, before security middleware
    // This ensures OAuth callbacks aren't blocked
    this.earlyOAuthRoutes(this.app);
    this.securityMiddleware(this.app);
    this.standardMiddleware(this.app);
    this.routeMiddleware(this.app);
    this.apiMonitoring(this.app);
    this.globalErrorHandler(this.app);
    this.catchAllRoutes(this.app);
    this.startServer(this.app);
  }

  private securityMiddleware(app: Application): void {
    // Helper function to get session domain based on environment
    const getSessionDomain = (): string | undefined => {
      // If we're truly in local development (no EC2_URL, no CLIENT_URL with chatappserver.space)
      // Local development uses NODE_ENV='development' (not 'develop', 'staging', or 'production')
      const isTrulyLocal = config.NODE_ENV === 'development' &&
                          !config.EC2_URL &&
                          !config.CLIENT_URL?.includes('chatappserver.space');

      if (isTrulyLocal) {
        return undefined; // No domain restriction for localhost
      }

      // For any deployed environment (develop, staging, production), use .chatappserver.space
      // The leading dot is CRITICAL - it allows the cookie to be shared across subdomains
      // This works for: dev.chatappserver.space, api.dev.chatappserver.space, staging.chatappserver.space, etc.
      return '.chatappserver.space';
    };

    // Determine if we're in local development (not deployed)
    // Deployed environments are: 'develop', 'staging', 'production'
    // Local development is: 'development' (or undefined) with no EC2_URL or CLIENT_URL with chatappserver.space
    const isLocalDev = config.NODE_ENV === 'development' &&
                       !config.EC2_URL &&
                       !config.CLIENT_URL?.includes('chatappserver.space');

    const sessionDomain = getSessionDomain();

    log.info('Cookie session configuration', {
      nodeEnv: config.NODE_ENV,
      isLocalDev,
      ec2Url: config.EC2_URL,
      clientUrl: config.CLIENT_URL,
      domain: sessionDomain,
      secure: !isLocalDev,
      sameSite: isLocalDev ? 'lax' : 'none'
    });

    // Verify secret keys are set
    if (!config.SECRET_KEY_ONE || !config.SECRET_KEY_TWO) {
      log.error('SECRET_KEY_ONE or SECRET_KEY_TWO is not set - cookie-session will not work!');
      log.error('SECRET_KEY_ONE:', config.SECRET_KEY_ONE ? 'set' : 'missing');
      log.error('SECRET_KEY_TWO:', config.SECRET_KEY_TWO ? 'set' : 'missing');
    }

    app.use(
      cookieSession({
        name: 'session',
        keys: [config.SECRET_KEY_ONE!, config.SECRET_KEY_TWO!],
        maxAge: 24 * 7 * 360000,
        secure: !isLocalDev, // Must be true when sameSite is 'none' (HTTPS required)
        sameSite: isLocalDev ? 'lax' : 'none', // 'none' required for cross-subdomain cookies
        domain: sessionDomain, // Should be '.chatappserver.space' for cross-subdomain
        httpOnly: true, // Prevent JavaScript access to cookie (security)
        overwrite: true // Overwrite existing cookies with same name
      })
    );

    log.info('Cookie session middleware configured', {
      name: 'session',
      domain: sessionDomain,
      secure: !isLocalDev,
      sameSite: isLocalDev ? 'lax' : 'none',
      hasKeys: !!(config.SECRET_KEY_ONE && config.SECRET_KEY_TWO)
    });
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
            formAction: ['\'self\'', 'https://accounts.google.com', 'https://github.com', 'https://www.facebook.com'],
            // Allow OAuth redirects
            navigateTo: ['\'self\'', 'https://dev.chatappserver.space', 'https://api.dev.chatappserver.space', 'https://accounts.google.com', 'https://github.com', 'https://www.facebook.com']
          }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        // Don't block OAuth callback redirects
        referrerPolicy: { policy: 'no-referrer-when-downgrade' }
      })
    );

    // Configure CORS to allow multiple origins (dev, staging, and production)
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://dev.chatappserver.space',
      'https://staging.chatappserver.space',
      'https://api.dev.chatappserver.space',
      'https://api.staging.chatappserver.space',
      'https://chatappserver.space',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080' // Vite dev server port
    ].filter(Boolean); // Remove undefined values

    // Helper function to check if origin is allowed
    const isOriginAllowed = (origin: string): boolean => {
      // Normalize origin for comparison (remove trailing slash and protocol)
      const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
      const originHost = normalizedOrigin.replace(/^https?:\/\//, '');

      return allowedOrigins.some(allowed => {
        if (!allowed) return false;
        const normalizedAllowed = allowed.replace(/\/$/, '').toLowerCase();
        const allowedHost = normalizedAllowed.replace(/^https?:\/\//, '');

        // Exact match (case-insensitive)
        if (normalizedOrigin === normalizedAllowed) {
          log.info(`CORS: Allowing exact match: ${origin}`);
          return true;
        }

        // Host match (case-insensitive)
        if (originHost === allowedHost) {
          log.info(`CORS: Allowing host match: ${origin}`);
          return true;
        }

        // Subdomain match - check if both share the same base domain
        // e.g., dev.chatappserver.space and api.dev.chatappserver.space both share chatappserver.space
        const baseDomain = allowedHost.split('.').slice(-2).join('.'); // Get last 2 parts
        const originBaseDomain = originHost.split('.').slice(-2).join('.');

        if (originBaseDomain === baseDomain && baseDomain === 'chatappserver.space') {
          log.info(`CORS: Allowing subdomain match: ${origin} (base domain: ${baseDomain})`);
          return true;
        }

        return false;
      });
    };

    app.use(
      cors({
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
          // Allow requests with no origin (like mobile apps, curl requests, or server-to-server)
          if (!origin) {
            log.info('CORS: Allowing request with no origin header');
            return callback(null, true);
          }

          if (isOriginAllowed(origin)) {
            // Pass the actual origin to set the Access-Control-Allow-Origin header correctly
            callback(null, origin);
          } else {
            // Log for debugging
            log.warn(`CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'Cookie'],
        exposedHeaders: ['Content-Length', 'Content-Type', 'Set-Cookie'],
        preflightContinue: false,
        maxAge: 86400 // 24 hours
      })
    );

    // Handle OPTIONS preflight requests explicitly
    app.options('*', (req: Request, res: Response) => {
      const origin = req.get('origin');
      if (origin && isOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
        res.header('Access-Control-Max-Age', '86400');
        log.info(`CORS: Handled OPTIONS preflight for ${origin}`);
      }
      res.status(200).end();
    });

    // Add explicit CORS headers middleware for all responses
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.get('origin');
      if (origin && isOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
        res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Set-Cookie');
      }
      next();
    });
  }

  private standardMiddleware(app: Application): void {
    app.use(compression());
    app.use(json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));

    // Initialize Passport middleware (required for OAuth)
    app.use(passport.initialize());

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

  /**
   * Register OAuth routes very early, before security middleware
   * This prevents 403 errors from security middleware blocking OAuth callbacks
   */
  private earlyOAuthRoutes(app: Application): void {
    // Import here to avoid circular dependencies
    const { OAuthController } = require('@auth/controllers/oauth');
    const oauthController = new OAuthController();

    // Test route to verify routing works
    app.get('/test-oauth-route', (req, res) => {
      res.status(200).json({ message: 'OAuth route test - routes are working', path: req.path });
    });

    // Handle OPTIONS preflight for OAuth
    app.options('/auth/:provider/callback', (req, res) => {
      log.info(`[EARLY ROUTE] OAuth OPTIONS: ${req.path}`, {
        origin: req.get('origin'),
        host: req.get('host'),
        fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
      });
      const origin = req.get('origin') || 'https://dev.chatappserver.space';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
      res.status(200).end();
    });

    // Handle OAuth callback GET requests - use ALL routes, not just specific provider
    app.all('/auth/:provider/callback', (req, res, next) => {
      log.info(`[EARLY ROUTE] OAuth callback request: ${req.method} ${req.path}`, {
        provider: req.params.provider,
        fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        query: req.query,
        origin: req.get('origin'),
        referer: req.get('referer'),
        host: req.get('host'),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        headers: {
          'x-forwarded-for': req.get('x-forwarded-for'),
          'x-forwarded-proto': req.get('x-forwarded-proto')
        }
      });

      // Set CORS headers immediately
      const origin = req.get('origin') || 'https://dev.chatappserver.space';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');

      // Call the OAuth callback handler
      try {
        oauthController.callback(req, res, next).catch((error: Error) => {
          log.error(`[EARLY ROUTE] Error in OAuth callback handler:`, error);
          res.status(500).json({ error: 'OAuth callback error', message: error.message });
        });
      } catch (error) {
        log.error(`[EARLY ROUTE] Exception calling OAuth callback:`, error);
        res.status(500).json({ error: 'OAuth callback exception', message: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    // Simple test endpoint for OAuth callback route
    app.get('/test-auth-callback', (req: Request, res: Response) => {
      res.status(200).json({
        message: 'Auth callback route test',
        path: req.path,
        provider: (req.params as any)?.provider || 'none',
        test: 'Route registration is working'
      });
    });

    log.info('[EARLY ROUTE] OAuth routes registered at /auth/:provider/callback');
  }

  /**
   * Catch-all route handler for debugging 403 errors
   */
  private catchAllRoutes(app: Application): void {
    // This should be the last route, after all others
    app.use((req: Request, res: Response) => {
      if (req.path.startsWith('/auth/')) {
        log.error(`Unhandled OAuth route: ${req.method} ${req.path}`, {
          fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          query: req.query,
          origin: req.get('origin'),
          referer: req.get('referer'),
          host: req.get('host'),
          ip: req.ip,
          userAgent: req.get('user-agent')
        });
        res.status(404).json({
          message: `OAuth route not found: ${req.path}`,
          method: req.method,
          path: req.path,
          fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
        });
      }
    });
  }

  private routeMiddleware(app: Application): void {
    // OAuth routes are now registered in earlyOAuthRoutes() before security middleware
    // Just register all other routes here
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
    // Helper function to set CORS headers on response
    const setCorsHeaders = (req: Request, res: Response): void => {
      const origin = req.get('origin');
      if (origin) {
        // Check if origin is allowed (reuse the same logic from CORS config)
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
        }
      }
    };

    // Error handler middleware - must come before catch-all route
    app.use((error: IErrorResponse, req: Request, res: Response, next: NextFunction) => {
      // Set CORS headers before sending error response
      setCorsHeaders(req, res);

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
      // Set CORS headers before sending 404 response
      setCorsHeaders(req, res);

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
      // Start HTTP server first (don't wait for Socket.IO Redis connection)
      this.startHttpServer(httpServer);
      // Initialize Socket.IO (Redis connection is non-blocking - will continue without it if it fails)
      const sockeIO: Server = await this.createSocketID(httpServer);
      this.socketIOConnections(sockeIO);
    } catch (error) {
      log.error('Error in startServer:', error);
      // Don't throw - let the server continue even if Socket.IO setup fails
      log.warn('Server will continue without full Socket.IO setup');
    }
  }

  private async createSocketID(httpServer: http.Server): Promise<Server> {
    // Use the same allowed origins as HTTP CORS
    const allowedOrigins = [
      config.CLIENT_URL,
      'https://dev.chatappserver.space',
      'https://staging.chatappserver.space',
      'https://api.dev.chatappserver.space',
      'https://api.staging.chatappserver.space',
      'https://chatappserver.space',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080' // Vite dev server port
    ].filter(Boolean);

    const io: Server = new Server(httpServer, {
      // Configure transports - allow polling as fallback for proxies that don't support WebSocket
      transports: ['websocket', 'polling'],
      // Increase timeouts for proxy environments (CloudFront, ALB)
      pingTimeout: 60000, // 60 seconds (default is 20s) - helps with proxy timeouts
      pingInterval: 25000, // 25 seconds (default is 25s)
      // Allow upgrade from polling to websocket
      allowUpgrades: true,
      cors: {
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps or server-to-server)
          if (!origin) {
            log.info('Socket.IO CORS: Allowing request with no origin header');
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
              log.info(`Socket.IO CORS: Allowing exact match: ${origin}`);
              return true;
            }

            // Subdomain match (e.g., api.dev.chatappserver.space matches dev.chatappserver.space or chatappserver.space)
            const baseDomain = allowedDomain.split('.').slice(-2).join('.'); // Get last 2 parts (e.g., chatappserver.space)
            const originBaseDomain = originDomain.split('.').slice(-2).join('.');

            if (originBaseDomain === baseDomain) {
              log.info(`Socket.IO CORS: Allowing subdomain match: ${origin} matches base domain ${baseDomain}`);
              return true;
            }

            // Domain match (e.g., https://dev.chatappserver.space matches dev.chatappserver.space)
            if (normalizedOrigin.includes(allowedDomain)) {
              log.info(`Socket.IO CORS: Allowing domain match: ${origin} matches ${allowed}`);
              return true;
            }

            return false;
          });

          if (isAllowed) {
            callback(null, true);
          } else {
            log.warn(`Socket.IO CORS blocked origin: ${origin}. Allowed origins: ${allowedOrigins.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true
      }
    });
    // Connect to Redis for Socket.IO adapter (with error handling)
    // If REDIS_HOST is not set or connection fails, continue without Redis adapter
    if (!config.REDIS_HOST) {
      log.warn('REDIS_HOST not configured - Socket.IO will run in single-instance mode (no Redis adapter)');
      return io;
    }

    try {
      const pubClient = createClient({
        url: config.REDIS_HOST,
        socket: {
          connectTimeout: 10000, // 10 seconds (reduced from 30s to fail faster)
          reconnectStrategy: (retries: number) => {
            if (retries > 10) {
              log.warn('Redis reconnection attempts exceeded for Socket.IO adapter');
              return new Error('Redis reconnection limit reached');
            }
            return Math.min(retries * 100, 3000); // Exponential backoff, max 3 seconds
          }
        }
      });
      const subClient = pubClient.duplicate();

      // Add error handlers to prevent unhandled rejections
      pubClient.on('error', (err) => {
        log.error('Redis pubClient error:', err);
      });
      subClient.on('error', (err) => {
        log.error('Redis subClient error:', err);
      });

      // Add timeout wrapper to fail faster if Redis is unreachable
      // Use Promise.race with proper timeout handling
      const connectWithTimeout = Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Redis connection timeout after 10 seconds')), 10000)
        )
      ]);

      try {
        await connectWithTimeout;
        // Verify clients are actually connected before setting adapter
        if (pubClient.isOpen && subClient.isOpen) {
          io.adapter(createAdapter(pubClient, subClient));
          log.info('Socket.IO Redis adapter connected successfully');
        } else {
          throw new Error('Redis clients not open after connection');
        }
      } catch (timeoutError) {
        // Clean up on timeout - try to disconnect clients
        try {
          if (pubClient.isOpen) await pubClient.disconnect().catch(() => {});
          if (subClient.isOpen) await subClient.disconnect().catch(() => {});
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
        throw timeoutError;
      }
    } catch (error) {
      log.error('Failed to connect Socket.IO Redis adapter:', error);
      log.warn('Socket.IO will continue without Redis adapter (single-instance mode)');
      log.warn('Note: Socket.IO will work but real-time features may be limited to single instance');
      // Continue without Redis adapter - app will work in single-instance mode
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

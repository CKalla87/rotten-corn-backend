import { AuthPayload } from '@auth/interfaces/auth.interface';
import JWT from 'jsonwebtoken';
import { config } from '@root/config';
import { Request, Response, NextFunction } from 'express';
import { NotAuthorizedError } from '@global/helpers/error-handler';
import Logger from 'bunyan';

const log: Logger = config.createLogger('authMiddleware');

export class AuthMiddleware {
  public verifyUser(req: Request, res: Response, next: NextFunction): void {
    // Set CORS headers immediately to prevent hanging
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
    }
    
    // Try to get JWT from session first, then from regular cookie as fallback
    let jwtToken: string | undefined = req.session?.jwt;
    
    // If no JWT in session, try to get it from the jwt cookie (fallback)
    if (!jwtToken && req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, cookie: string) => {
        const [key, value] = cookie.trim().split('=');
        if (key && value) {
          acc[key] = decodeURIComponent(value);
        }
        return acc;
      }, {});
      jwtToken = cookies.jwt;
    }
    
    // Debug logging for session issues
    log.info(`Auth check for ${req.method} ${req.originalUrl}`, {
      hasSession: !!req.session,
      hasJwtInSession: !!req.session?.jwt,
      hasJwtInCookie: !!jwtToken && jwtToken !== req.session?.jwt,
      cookies: req.headers.cookie ? 'present' : 'missing',
      cookieHeader: req.headers.cookie,
      origin: req.get('origin'),
      referer: req.get('referer')
    });

    if (!jwtToken) {
      log.warn(`No JWT token found in session or cookie for ${req.originalUrl}`, {
        sessionExists: !!req.session,
        cookies: req.headers.cookie,
        allCookies: req.headers.cookie ? req.headers.cookie.split(';').map(c => c.trim().split('=')[0]) : []
      });
      // Return error response immediately instead of throwing (to ensure response is sent)
      const error = new NotAuthorizedError('Token is not available. Please login again');
      res.status(error.statusCode).json({
        message: error.message,
        status: error.status,
        statusCode: error.statusCode
      });
      return;
    }
    
    // Store JWT in session for consistency (even if it came from cookie)
    if (!req.session) {
      req.session = {} as any;
    }
    (req.session as any).jwt = jwtToken;

    try {
      const payload: AuthPayload = JWT.verify(jwtToken, config.JWT_TOKEN!) as AuthPayload;
      req.currentUser = payload;
      log.info(`Successfully verified JWT for user ${payload.userId}`);
    } catch (error) {
      log.error(`JWT verification failed for ${req.originalUrl}:`, error);
      // Return error response immediately instead of throwing
      const authError = new NotAuthorizedError('Token is invalid, Please login again.');
      res.status(authError.statusCode).json({
        message: authError.message,
        status: authError.status,
        statusCode: authError.statusCode
      });
      return;
    }
    next();
  }

  public checkAuthentication(req: Request, _res: Response, next: NextFunction): void {
    if (!req.currentUser) {
      throw new NotAuthorizedError('Authentication is required to access this route.');
    }
    next();
  }
}

export const authMiddleware: AuthMiddleware = new AuthMiddleware();

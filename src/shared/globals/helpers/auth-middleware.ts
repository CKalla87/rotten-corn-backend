import { AuthPayload } from '@auth/interfaces/auth.interface';
import JWT from 'jsonwebtoken';
import { config } from '@root/config';
import { Request, Response, NextFunction } from 'express';
import { NotAuthorizedError } from '@global/helpers/error-handler';
import Logger from 'bunyan';

const log: Logger = config.createLogger('authMiddleware');

export class AuthMiddleware {
  public verifyUser(req: Request, _res: Response, next: NextFunction): void {
    // Check session first, then fall back to cookie, then Authorization header
    let token = req.session?.jwt;

    // Debug logging - use error level so it shows up in logs (logger is set to 'warn' in development)
    log.error('verifyUser called', {
      hasSession: !!req.session,
      hasSessionJwt: !!req.session?.jwt,
      hasCookies: !!req.cookies,
      cookieKeys: req.cookies ? Object.keys(req.cookies) : [],
      hasAuthHeader: !!(req.headers.authorization || req.headers.Authorization),
      authHeaderValue: req.headers.authorization || req.headers.Authorization || 'none',
      url: req.url,
      method: req.method,
      allHeaders: Object.keys(req.headers)
    });

    // If no token in session, try to get from cookies
    if (!token) {
      // Try to get from cookies - handle both req.cookies (cookie-parser) and direct access
      if (req.cookies) {
        // Log all cookies for debugging
        log.warn('Checking cookies for JWT token', {
          cookieKeys: Object.keys(req.cookies),
          hasJwtCookie: 'jwt' in req.cookies,
          cookieType: typeof req.cookies,
          allCookies: req.cookies
        });
        
        if (typeof req.cookies === 'object' && 'jwt' in req.cookies) {
          token = req.cookies.jwt;
          log.warn('Found token in req.cookies.jwt', { tokenLength: token?.length });
        } else if (typeof req.cookies.get === 'function') {
          // Some cookie parsers use .get() method
          token = req.cookies.get('jwt');
          log.warn('Found token via req.cookies.get()', { tokenLength: token?.length });
        }
      }
      
      // Also check the Cookie header directly as a fallback
      if (!token && req.headers.cookie) {
        const cookieHeader = req.headers.cookie;
        log.warn('Checking Cookie header directly', { cookieHeader: cookieHeader.substring(0, 100) });
        const jwtMatch = cookieHeader.match(/jwt=([^;]+)/);
        if (jwtMatch && jwtMatch[1]) {
          token = jwtMatch[1];
          log.warn('Found token in Cookie header', { tokenLength: token.length });
        }
      }

      // If we found token in cookie, set it in session for consistency
      if (token) {
        if (!req.session) {
          (req as any).session = {};
        }
        (req.session as any).jwt = token;
        log.warn('Set token in session from cookie');
      }
    }

    // If still no token, try Authorization header (Bearer token)
    // Check both 'authorization' and 'Authorization' (case-insensitive)
    if (!token) {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (authHeader) {
        const headerValue = typeof authHeader === 'string' ? authHeader : authHeader[0];
        if (headerValue && headerValue.startsWith('Bearer ')) {
          token = headerValue.substring(7).trim();
          log.warn('Found token in Authorization header', { tokenLength: token.length });
          // Also set it in session for consistency
          if (!req.session) {
            (req as any).session = {};
          }
          (req.session as any).jwt = token;
        } else if (headerValue && !headerValue.startsWith('Bearer ')) {
          // Token might be sent without "Bearer " prefix
          token = headerValue.trim();
          log.warn('Found token in Authorization header without Bearer prefix', { tokenLength: token.length });
          if (!req.session) {
            (req as any).session = {};
          }
          (req.session as any).jwt = token;
        }
      }
    }

    if (!token) {
      log.error('No token found in session, cookies, or Authorization header', {
        hasSession: !!req.session,
        hasCookies: !!req.cookies,
        cookieKeys: req.cookies ? Object.keys(req.cookies) : [],
        hasAuthHeader: !!(req.headers.authorization || req.headers.Authorization),
        authHeaderValue: req.headers.authorization || req.headers.Authorization || 'none',
        url: req.url,
        method: req.method
      });
      throw new NotAuthorizedError('Token is not available. Please login again');
    }

    try {
      const payload: AuthPayload = JWT.verify(token, config.JWT_TOKEN!) as AuthPayload;
      req.currentUser = payload;
      log.warn('Token verified successfully', { userId: payload.userId });
    } catch (error) {
      log.error('Token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20)
      });
      throw new NotAuthorizedError('Token is invalid, Please login again.');
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

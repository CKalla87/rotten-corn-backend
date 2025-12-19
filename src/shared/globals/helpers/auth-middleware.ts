import { AuthPayload } from '@auth/interfaces/auth.interface';
import JWT from 'jsonwebtoken';
import { config } from '@root/config';
import { Request, Response, NextFunction } from 'express';
import { NotAuthorizedError } from '@global/helpers/error-handler';

export class AuthMiddleware {
  public verifyUser(req: Request, _res: Response, next: NextFunction): void {
    // Check session first, then fall back to cookie
    let token = req.session?.jwt;
    
    // If no token in session, try to get from cookies
    if (!token) {
      // Try to get from cookies - handle both req.cookies (cookie-parser) and direct access
      if (req.cookies) {
        if (typeof req.cookies === 'object' && 'jwt' in req.cookies) {
          token = req.cookies.jwt;
        } else if (typeof req.cookies.get === 'function') {
          // Some cookie parsers use .get() method
          token = req.cookies.get('jwt');
        }
      }
      
      // If we found token in cookie, set it in session for consistency
      if (token) {
        if (!req.session) {
          (req as any).session = {};
        }
        (req.session as any).jwt = token;
      }
    }

    if (!token) {
      throw new NotAuthorizedError('Token is not available. Please login again');
    }

    try {
      const payload: AuthPayload = JWT.verify(token, config.JWT_TOKEN!) as AuthPayload;
      req.currentUser = payload;
    } catch (error) {
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

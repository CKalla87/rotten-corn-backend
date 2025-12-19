import { AuthPayload } from '@auth/interfaces/auth.interface';
import JWT from 'jsonwebtoken';
import { config } from '@root/config';
import { Request, Response, NextFunction } from 'express';
import { NotAuthorizedError } from '@global/helpers/error-handler';

export class AuthMiddleware {
  public verifyUser(req: Request, _res: Response, next: NextFunction): void {
    // Check session first, then fall back to cookie
    let token = req.session?.jwt;
    if (!token && req.cookies?.jwt) {
      token = req.cookies.jwt;
      // Also set it in session for consistency
      if (!req.session) {
        (req as any).session = {};
      }
      (req.session as any).jwt = token;
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

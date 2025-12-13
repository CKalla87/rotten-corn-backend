import { CurrentUser } from '@auth/controllers/current-user';
import { authMiddleware } from '@global/helpers/auth-middleware';
import express, { Router, Request, Response } from 'express';

class CurrentUserRoutes {
  private router: Router;

  constructor() {
    this.router = express.Router();
  }

  /**
   * Set CORS headers helper
   */
  private setCorsHeaders(req: Request, res: Response): void {
    const origin = req.get('origin');
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cookie');
      res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Set-Cookie');
    }
  }

  public routes(): Router {
    // Handle OPTIONS preflight for currentUser endpoint
    this.router.options('/currentUser', (req, res) => {
      this.setCorsHeaders(req, res);
      res.status(200).end();
    });
    
    // GET currentUser endpoint with authentication
    // Note: verifyUser is already applied at the route level in routes.ts
    this.router.get('/currentUser', authMiddleware.checkAuthentication, CurrentUser.prototype.read);

    return this.router;
  }
}

export const currentUserRoutes: CurrentUserRoutes = new CurrentUserRoutes();

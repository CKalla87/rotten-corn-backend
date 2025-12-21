import HTTP_STATUS from 'http-status-codes';
import { Request, Response } from 'express';
import { config } from '@root/config';

export class SignOut {
  public async update(req: Request, res: Response): Promise<void> {
    req.session = null;
    
    // Also clear the JWT cookie
    const isLocalDev = config.NODE_ENV === 'development' &&
                       (!config.EC2_URL || config.EC2_URL.includes('169.254.169.254')) &&
                       !config.CLIENT_URL?.includes('chatappserver.space');

    const cookieOptions: any = {
      maxAge: 0, // Expire immediately
      httpOnly: true,
      secure: !isLocalDev,
      sameSite: isLocalDev ? 'lax' : 'none',
      path: '/'
    };

    if (!isLocalDev) {
      cookieOptions.domain = '.chatappserver.space';
    }

    res.clearCookie('jwt', cookieOptions);
    res.status(HTTP_STATUS.OK).json({ message: 'Logout successful', user: {}, token: ''});
  }
}

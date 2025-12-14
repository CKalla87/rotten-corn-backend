import { IUserDocument } from './../../user/interfaces/user.interface';
import { Request, Response } from 'express';
import { config } from '@root/config';
import JWT from 'jsonwebtoken';
import { joiValidation } from '@root/shared/decorators/joi-validation.decorators';
import HTTP_STATUS from 'http-status-codes';
import { authService } from '@service/db/auth.service';
import { BadRequestError } from '@global/helpers/error-handler';
import { loginSchema } from '@auth/schemes/signin';
import { IAuthDocument } from '@auth/interfaces/auth.interface';
import { userService } from '@service/db/user.service';
import Logger from 'bunyan';

const log: Logger = config.createLogger('signin');

export class SignIn {
  @joiValidation(loginSchema)
  public async read(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;

    let existingUser: IAuthDocument;
    try {
      existingUser = await authService.getAuthUserByUsername(username);
    } catch (error) {
      log.error('Database error during signin:', error);
      if (error instanceof Error && error.message.includes('Database not connected')) {
        throw new BadRequestError('Database connection error. Please try again in a moment.');
      }
      throw new BadRequestError('An error occurred during signin. Please try again.');
    }

    if (!existingUser) {
      throw new BadRequestError('Invalid credentials');
    }

    const passwordsMatch: boolean = await existingUser.comparePassword(password);

    if (!passwordsMatch) {
      throw new BadRequestError('Invalid credentials');
    }

    const user: IUserDocument = await userService.getUserByAuthId(`${existingUser._id}`);
    if (!user) {
      throw new BadRequestError('User profile not found. Please contact support.');
    }

    const userJwt: string = JWT.sign(
      {
        userId: user._id,
        uId: existingUser.uId,
        email: existingUser.email,
        username: existingUser.username,
        avatarColor: existingUser.avatarColor
      },
      config.JWT_TOKEN!
    );

    // Set session cookie
    req.session = { jwt: userJwt };

    // Log session setting for debugging
    log.info('Session set for user login', {
      username: existingUser.username,
      userId: user._id,
      hasSession: !!req.session,
      hasJwt: !!req.session?.jwt,
      origin: req.get('origin'),
      host: req.get('host'),
      protocol: req.protocol
    });

    const userDocument: IUserDocument = {
      ...user,
      authId: existingUser!._id,
      username: existingUser!.username,
      email: existingUser!.email,
      avatarColor: existingUser!.avatarColor,
      uId: existingUser!.uId,
      createdAt: existingUser!.createdAt
    } as IUserDocument;
    res.status(HTTP_STATUS.OK).json({ message: 'User login successfully', user: userDocument, token: userJwt });
  }
}

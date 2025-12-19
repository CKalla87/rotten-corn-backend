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

export class SignIn {
  @joiValidation(loginSchema)
  public async read(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;
    const existingUser: IAuthDocument = await authService.getAuthUserByUsername(username);
    if (!existingUser) {
      throw new BadRequestError('Invalid credentials');
    }

    const passwordsMatch: boolean = await existingUser.comparePassword(password);

    if (!passwordsMatch) {
      throw new BadRequestError('Invalid credentials');
    }

    const user: IUserDocument = await userService.getUserByAuthId(`${existingUser._id}`);
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

    req.session = { jwt: userJwt };
    
    // ALSO set a regular cookie with the JWT as a fallback
    // Deployed environments are: 'develop', 'staging', 'production'
    // Local development is: 'development' (or undefined) with no EC2_URL or CLIENT_URL with chatappserver.space
    const isLocalDev = config.NODE_ENV === 'development' &&
                       !config.EC2_URL &&
                       !config.CLIENT_URL?.includes('chatappserver.space');

    const cookieOptions: any = {
      maxAge: 24 * 7 * 3600000,
      httpOnly: true,
      secure: !isLocalDev,
      sameSite: isLocalDev ? 'lax' : 'none',
      path: '/'
    };

    if (!isLocalDev) {
      cookieOptions.domain = '.chatappserver.space';
    }

    res.cookie('jwt', userJwt, cookieOptions);
    
    const userDocument: IUserDocument = {
      ...user,
      authId: existingUser!._id,
      username: existingUser!.username,
      email: existingUser!.email,
      avatarColor: existingUser!.avatarColor,
      uId: existingUser!.uId,
      createdAt: existingUser!.createdAt,
    } as IUserDocument;
    res.status(HTTP_STATUS.OK).json({ message: 'User login successfully', user: userDocument, token: userJwt});
  }
}

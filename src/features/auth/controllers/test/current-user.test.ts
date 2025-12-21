import { Request, Response } from 'express';
import { CurrentUser } from '@auth/controllers/current-user';
import { authMockRequest, authMockResponse, authUserPayload } from '@root/mocks/auth.mock';
import { IUserDocument } from '@user/interfaces/user.interface';
import { existingUser } from '@root/mocks/user.mock';
import { userService } from '@service/db/user.service';

jest.mock('@service/queues/base.queue');
jest.mock('@service/redis/user.cache');
jest.mock('@service/db/user.service');

const USERNAME = 'Manny';
const PASSWORD = 'manny1';

describe('CurrentUser', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('token', () => {
    it('should set session token to null and send correct json response when user not found', async () => {
      const req: Request = authMockRequest({}, { username: USERNAME, password: PASSWORD }, authUserPayload) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'getUserById').mockResolvedValue(null as unknown as IUserDocument);

      await CurrentUser.prototype.read(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        message: 'User not found',
        status: 'error',
        statusCode: 404
      });
    });

    it('should set session token and send correct json response', async () => {
      const req: Request = authMockRequest({ jwt: '12djdj34' }, { username: USERNAME, password: PASSWORD }, authUserPayload) as unknown as Request;
      const res: Response = authMockResponse();
      jest.spyOn(userService, 'getUserById').mockResolvedValue(existingUser);

      await CurrentUser.prototype.read(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        token: req.session?.jwt,
        isUser: true,
        user: existingUser
      });
    });
  });
});

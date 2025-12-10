/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Password } from '@auth/controllers/password';
import { authMock, authMockRequest, authMockResponse } from '@root/mocks/auth.mock';
import { CustomError } from '@global/helpers/error-handler';
import { emailQueue } from '@service/queues/email.queue';
import { authService } from '@service/db/auth.service';

const WRONG_EMAIL = 'test@email.com';
const CORRECT_EMAIL = 'manny@me.com';
const INVALID_EMAIL = 'test';
const CORRECT_PASSWORD = 'Password123!';
const SHORT_PASSWORD = 'Pass1!';
const LONG_PASSWORD = 'P'.repeat(129) + '1!';
const WEAK_PASSWORD_NO_UPPER = 'password123!';
const WEAK_PASSWORD_NO_LOWER = 'PASSWORD123!';
const WEAK_PASSWORD_NO_NUMBER = 'Password!';
const WEAK_PASSWORD_NO_SPECIAL = 'Password123';

jest.mock('@service/queues/base.queue');
jest.mock('@service/queues/email.queue');
jest.mock('@service/db/auth.service');
jest.mock('@service/emails/mail.transport');

describe('Password', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should throw an error if email is invalid', () => {
      const req: Request = authMockRequest({}, { email: INVALID_EMAIL }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.create(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Field must be valid');
      });
    });

    it('should throw "Invalid credentials" if email does not exist', () => {
      const req: Request = authMockRequest({}, { email: WRONG_EMAIL }) as Request;
      const res: Response = authMockResponse();
      jest.spyOn(authService, 'getAuthUserByEmail').mockResolvedValue(null as any);
      Password.prototype.create(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Invalid credentials');
      });
    });

    it('should send correct json response', async () => {
      const req: Request = authMockRequest({}, { email: CORRECT_EMAIL }) as Request;
      const res: Response = authMockResponse();
      jest.spyOn(authService, 'getAuthUserByEmail').mockResolvedValue(authMock);
      jest.spyOn(emailQueue, 'addEmailJob');
      await Password.prototype.create(req, res);
      expect(emailQueue.addEmailJob).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Password reset email sent.'
      });
    });
  });

  describe('update', () => {
    it('should throw an error if password is empty', () => {
      const req: Request = authMockRequest({}, { password: '' }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('Password is a required field');
        expect(error.serializeErrors().message).toContain('Confirm password is a required field');
      });
    });

    it('should throw an error if password length is less than minimum length', () => {
      const req: Request = authMockRequest({}, { password: SHORT_PASSWORD, confirmPassword: SHORT_PASSWORD }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('Password must be at least 8 characters');
      });
    });

    it('should throw an error if password length is greater than maximum length', () => {
      const req: Request = authMockRequest({}, { password: LONG_PASSWORD, confirmPassword: LONG_PASSWORD }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('Password must be no more than 128 characters');
      });
    });

    it('should reject password without uppercase', () => {
      const req: Request = authMockRequest({}, { password: WEAK_PASSWORD_NO_UPPER, confirmPassword: WEAK_PASSWORD_NO_UPPER }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('uppercase letter');
      });
    });

    it('should reject password without lowercase', () => {
      const req: Request = authMockRequest({}, { password: WEAK_PASSWORD_NO_LOWER, confirmPassword: WEAK_PASSWORD_NO_LOWER }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('lowercase letter');
      });
    });

    it('should reject password without number', () => {
      const req: Request = authMockRequest({}, { password: WEAK_PASSWORD_NO_NUMBER, confirmPassword: WEAK_PASSWORD_NO_NUMBER }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('number');
      });
    });

    it('should reject password without special character', () => {
      const req: Request = authMockRequest({}, { password: WEAK_PASSWORD_NO_SPECIAL, confirmPassword: WEAK_PASSWORD_NO_SPECIAL }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toContain('special character');
      });
    });

    it('should throw an error if password and confirmPassword are different', () => {
      const req: Request = authMockRequest({}, { password: CORRECT_PASSWORD, confirmPassword: `${CORRECT_PASSWORD}2` }) as Request;
      const res: Response = authMockResponse();
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Passwords should match');
      });
    });

    it('should throw error if reset token has expired', () => {
      const req: Request = authMockRequest({}, { password: CORRECT_PASSWORD, confirmPassword: CORRECT_PASSWORD }, null, {
        token: ''
      }) as Request;
      const res: Response = authMockResponse();
      jest.spyOn(authService, 'getAuthUserByPasswordToken').mockResolvedValue(null as any);
      Password.prototype.update(req, res).catch((error: CustomError) => {
        expect(error.statusCode).toEqual(400);
        expect(error.serializeErrors().message).toEqual('Reset token has expired');
      });
    });

    it('should send correct json response', async () => {
      const req: Request = authMockRequest({}, { password: CORRECT_PASSWORD, confirmPassword: CORRECT_PASSWORD }, null, {
        token: '12sde3'
      }) as Request;
      const res: Response = authMockResponse();
      jest.spyOn(authService, 'getAuthUserByPasswordToken').mockResolvedValue(authMock);
      jest.spyOn(emailQueue, 'addEmailJob');
      await Password.prototype.update(req, res);
      expect(emailQueue.addEmailJob).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Password successfully updated.'
      });
    });
  });
});

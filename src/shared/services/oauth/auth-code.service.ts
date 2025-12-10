import { createClient } from 'redis';
import { config } from '@root/config';
import Logger from 'bunyan';
import { ServerError } from '@global/helpers/error-handler';

const log: Logger = config.createLogger('authCodeService');

interface AuthCodeData {
  userId: string;
  token: string;
  createdAt: number;
}

class AuthCodeService {
  private client = createClient({ url: config.REDIS_HOST });
  private readonly CODE_EXPIRY = 600; // 10 minutes in seconds

  constructor() {
    this.client.on('error', (err) => {
      log.error('Redis Client Error in AuthCodeService:', {
        error: err.message,
        code: (err as any).code,
        timestamp: new Date().toISOString()
      });
    });

    this.client.on('connect', () => {
      log.info('Redis client connected in AuthCodeService');
    });

    this.client.on('reconnecting', () => {
      log.warn('Redis client reconnecting in AuthCodeService');
    });

    this.client.on('ready', () => {
      log.info('Redis client ready in AuthCodeService');
    });
  }

  /**
   * Check if Redis is available
   * @returns true if Redis is connected, false otherwise
   */
  public async isRedisAvailable(): Promise<boolean> {
    try {
      if (!config.REDIS_HOST) {
        return false;
      }
      if (!this.client.isOpen) {
        await this.client.connect();
      }
      await this.client.ping();
      return true;
    } catch (error) {
      log.error('Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Generate and store an authorization code
   * @param userId - User ID
   * @param token - JWT token
   * @returns Authorization code
   */
  public async generateCode(userId: string, token: string): Promise<string> {
    try {
      // Check Redis availability first
      if (!(await this.isRedisAvailable())) {
        throw new ServerError('OAuth service temporarily unavailable. Redis connection failed.');
      }

      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const code = this.generateRandomCode();
      const data: AuthCodeData = {
        userId,
        token,
        createdAt: Date.now()
      };

      await this.client.setEx(`auth:code:${code}`, this.CODE_EXPIRY, JSON.stringify(data));

      return code;
    } catch (error) {
      log.error('Error generating auth code:', error);
      // Re-throw ServerError as-is, wrap others
      if (error instanceof ServerError) {
        throw error;
      }
      // Check for Redis-specific errors
      if (error && typeof error === 'object' && 'code' in error) {
        const redisError = error as { code: string; message?: string };
        if (redisError.code === 'ECONNREFUSED' || redisError.message?.includes('Redis')) {
          throw new ServerError('OAuth service temporarily unavailable. Redis connection failed.');
        }
      }
      throw new ServerError('Failed to generate authorization code. Please try again.');
    }
  }

  /**
   * Exchange authorization code for user data and token
   * @param code - Authorization code
   * @returns User data and token, or null if invalid/expired
   */
  public async exchangeCode(code: string): Promise<AuthCodeData | null> {
    try {
      // Check Redis availability first
      if (!(await this.isRedisAvailable())) {
        log.error('Redis unavailable during code exchange');
        return null;
      }

      if (!this.client.isOpen) {
        await this.client.connect();
      }

      const data = await this.client.get(`auth:code:${code}`);

      if (!data) {
        return null;
      }

      const authData: AuthCodeData = JSON.parse(data);

      // Delete the code after use (one-time use)
      await this.client.del(`auth:code:${code}`);

      return authData;
    } catch (error) {
      log.error('Error exchanging auth code:', error);
      return null;
    }
  }

  /**
   * Generate a random authorization code
   * @returns Random code string
   */
  private generateRandomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 32; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

export const authCodeService: AuthCodeService = new AuthCodeService();

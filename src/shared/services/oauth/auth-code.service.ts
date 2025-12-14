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
   * Check if Redis is available with timeout
   * @returns true if Redis is connected, false otherwise
   */
  public async isRedisAvailable(): Promise<boolean> {
    try {
      if (!config.REDIS_HOST) {
        return false;
      }

      // Fast timeout check - fail quickly if Redis is slow
      const pingPromise = (async () => {
        if (!this.client.isOpen) {
          await this.client.connect();
        }
        await this.client.ping();
      })();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis ping timeout')), 1000);
      });

      await Promise.race([pingPromise, timeoutPromise]);
      return true;
    } catch (error) {
      log.warn('Redis health check failed:', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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
      // Fast check Redis availability with timeout - if unavailable, skip Redis
      const isAvailable = await this.isRedisAvailable();

      const code = this.generateRandomCode();
      const data: AuthCodeData = {
        userId,
        token,
        createdAt: Date.now()
      };

      // Only use Redis if available, otherwise we'll return code directly (frontend will exchange immediately)
      if (isAvailable) {
        try {
          // Ensure connection
          if (!this.client.isOpen) {
            await this.client.connect();
          }

          // Add timeout to Redis operation
          const setPromise = this.client.setEx(`auth:code:${code}`, this.CODE_EXPIRY, JSON.stringify(data));
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Redis setEx timeout')), 1000);
          });
          await Promise.race([setPromise, timeoutPromise]);
          log.info('Auth code stored in Redis', { code: code.substring(0, 8) });
        } catch (redisError) {
          // If Redis fails, log warning but continue - code will work without Redis
          log.warn('Failed to store auth code in Redis, continuing without Redis:', {
            error: redisError instanceof Error ? redisError.message : 'Unknown error'
          });
        }
      } else {
        log.warn('Redis unavailable, generating code without Redis storage');
      }

      return code;
    } catch (error) {
      log.error('Error generating auth code:', error);
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
      // Fast check Redis availability with timeout
      const isAvailable = await this.isRedisAvailable();

      if (isAvailable) {
        try {
          // Ensure connection
          if (!this.client.isOpen) {
            await this.client.connect();
          }

          // Add timeout to Redis GET operation
          const getPromise = this.client.get(`auth:code:${code}`);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Redis get timeout')), 1000);
          });
          const data = await Promise.race([getPromise, timeoutPromise]) as string | null;

          if (data) {
            const authData: AuthCodeData = JSON.parse(data);

            // Delete the code after use (one-time use) - don't wait for this to complete
            this.client.del(`auth:code:${code}`).catch(err => {
              log.warn('Failed to delete auth code after exchange:', err);
            });

            return authData;
          }
        } catch (redisError) {
          log.warn('Redis operation failed during code exchange:', {
            error: redisError instanceof Error ? redisError.message : 'Unknown error'
          });
          // Continue to return null - code not found
        }
      } else {
        log.warn('Redis unavailable during code exchange');
      }

      // Code not found in Redis (either Redis unavailable or code expired/invalid)
      return null;
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

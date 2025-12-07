import { createClient } from 'redis';
import { config } from '@root/config';
import Logger from 'bunyan';

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
      log.error('Redis Client Error in AuthCodeService:', err);
    });
  }

  /**
   * Generate and store an authorization code
   * @param userId - User ID
   * @param token - JWT token
   * @returns Authorization code
   */
  public async generateCode(userId: string, token: string): Promise<string> {
    try {
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
      throw error;
    }
  }

  /**
   * Exchange authorization code for user data and token
   * @param code - Authorization code
   * @returns User data and token, or null if invalid/expired
   */
  public async exchangeCode(code: string): Promise<AuthCodeData | null> {
    try {
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

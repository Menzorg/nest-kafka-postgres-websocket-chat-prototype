import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { JwtStrategy } from '../jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService();
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      const config: Record<string, string> = {
        'JWT_SECRET': 'test-secret',
        'JWT_EXPIRES_IN': '1d'
      };
      return config[key];
    });

    strategy = new JwtStrategy(configService);
  });

  describe('validate', () => {
    it('should validate and return user data from payload', async () => {
      const payload = {
        sub: '123',
        email: 'test@example.com'
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: '123',
        email: 'test@example.com'
      });
    });

    it('should throw ForbiddenException if payload is missing sub', async () => {
      const payload = {
        email: 'test@example.com'
      };

      await expect(strategy.validate(payload)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if payload is missing email', async () => {
      const payload = {
        sub: '123'
      };

      await expect(strategy.validate(payload)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getConfig', () => {
    it('should return correct config from ConfigService', () => {
      const config = JwtStrategy.getConfig(configService);

      expect(config).toEqual({
        secret: 'test-secret',
        expiresIn: '1d'
      });
    });

    it('should use default values if config values are not set', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: string) => {
        return defaultValue;
      });

      const config = JwtStrategy.getConfig(configService);

      expect(config).toEqual({
        secret: 'your-secret-key',
        expiresIn: '1d'
      });
    });
  });
});

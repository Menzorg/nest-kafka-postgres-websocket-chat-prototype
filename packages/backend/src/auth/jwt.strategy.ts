import { Injectable, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  static getConfig(configService: ConfigService) {
    return {
      secret: configService.get('JWT_SECRET', 'your-secret-key'),
      expiresIn: configService.get('JWT_EXPIRES_IN', '1d')
    };
  }
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JwtStrategy.getConfig(configService).secret,
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.email) {
      throw new ForbiddenException('Invalid token payload: missing required fields');
    }
    return { id: payload.sub, email: payload.email };
  }
}

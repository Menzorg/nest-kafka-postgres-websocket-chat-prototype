import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { LoginDto, RegisterDto, AuthResponse } from '@webchat/common';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(payload: any) {
    try {
      this.logger.log('=== Validating user ===');
      this.logger.log('Payload:', payload);
      
      if (!payload?.sub) {
        this.logger.error('No user id in payload');
        throw new UnauthorizedException('Invalid token payload');
      }

      const user = await this.userService.findById(payload.sub);
      this.logger.log('User found:', !!user);
      
      if (!user) {
        this.logger.error('User not found');
        throw new UnauthorizedException();
      }
      
      return user;
    } catch (error) {
      this.logger.error('=== Error validating user ===');
      this.logger.error('Error:', error.message);
      this.logger.error('Stack:', error.stack);
      throw error;
    }
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.userService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.name,
      },
    };
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const user = await this.userService.create({
      ...registerDto,
      password: hashedPassword,
    });

    const payload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.name,
      },
    };
  }

  async getAllUsers() {
    try {
      const users = await this.userService.findAll();
      return users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name
      }));
    } catch (error) {
      this.logger.error('Error getting all users:', error.message);
      throw error;
    }
  }
}

import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { RegisterDto } from '@webchat/common';

@Injectable()
export class UserService {
  private users: any[] = []; // Временное хранение, позже заменим на базу данных

  async create(dto: RegisterDto & { password: string }) {
    const existingUser = await this.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = {
      id: Date.now().toString(),
      ...dto,
    };

    this.users.push(user);
    return user;
  }

  async findByEmail(email: string) {
    return this.users.find(user => user.email === email);
  }

  async findById(id: string) {
    const user = this.users.find(user => user.id === id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}

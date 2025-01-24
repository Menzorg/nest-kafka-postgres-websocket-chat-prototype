import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    description: 'Email address of the user',
    example: 'user@example.com'
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Password for the user account',
    example: 'strongpassword123'
  })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({
    description: 'Display name of the user',
    example: 'John Doe'
  })
  @IsString()
  name: string;
}

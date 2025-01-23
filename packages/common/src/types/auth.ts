export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto extends LoginDto {
  username: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
}

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

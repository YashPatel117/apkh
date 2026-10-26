import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { IsNewPassword } from 'src/common/utils/password-rules';

export class LoginDto {
  @ApiProperty({ example: 'yash@patel.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;

  // Sign-in keeps the original minimum so accounts created before the
  // stricter new-password rules (IsNewPassword) can still sign in.
  @ApiProperty({ example: '32342324' })
  @IsString({ message: 'Password must be a string' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;

  @ApiProperty({ example: 'Tr1cky!Pass' })
  @IsString({ message: 'Password must be a string' })
  @IsNewPassword()
  password: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Firebase ID token from Google sign-in' })
  @IsString({ message: 'ID token must be a string' })
  @IsNotEmpty({ message: 'ID token is required' })
  idToken: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;

  @ApiProperty({ example: 'oldpassword123' })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({ example: 'N3w!Passw0rd' })
  @IsString({ message: 'Password must be a string' })
  @IsNewPassword()
  password: string;
}

import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  GoogleLoginDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './model/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('/google')
  loginWithGoogle(@Body() googleDto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(googleDto.idToken);
  }

  @Post('/register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('/reset-password')
  resetPassword(@Body() resetDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetDto);
  }
}

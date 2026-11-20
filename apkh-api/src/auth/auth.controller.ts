import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  GoogleLoginDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './model/auth.dto';
import { Limits, RateLimit } from 'src/common/rate-limit/rate-limit';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/login')
  @RateLimit(...Limits.login)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('/google')
  @RateLimit(...Limits.login)
  loginWithGoogle(@Body() googleDto: GoogleLoginDto) {
    return this.authService.loginWithGoogle(googleDto.idToken);
  }

  @Post('/register')
  @RateLimit(...Limits.register)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('/reset-password')
  @RateLimit(...Limits.resetPassword)
  resetPassword(@Body() resetDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetDto);
  }
}

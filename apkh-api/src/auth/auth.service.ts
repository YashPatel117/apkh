import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto, RegisterDto, ResetPasswordDto } from './model/auth.dto';
import { FirebaseAuthService } from './firebase-auth.service';
import { UsersService } from 'src/users/users.service';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { JwtService } from '@nestjs/jwt';
import { comparePassword, hashPassword } from 'src/common/utils/hash';

@Injectable()
export class AuthService {
  constructor(
    private userService: UsersService,
    private jwtService: JwtService,
    private firebaseAuth: FirebaseAuthService,
  ) {}

  private async issueToken(user: { email: string; _id: unknown }) {
    const payload = { email: user.email, _id: user._id };
    return new ApiResponseDto<string>().ok(
      await this.jwtService.signAsync(payload),
    );
  }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findOne(loginDto.email);
    if (user) {
      // Google-only accounts have no password to compare against
      if (
        user.password &&
        (await comparePassword(loginDto.password, user.password))
      ) {
        return this.issueToken(user);
      } else {
        throw new UnauthorizedException();
      }
    }
    throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
  }

  /**
   * Signs in with a Google account verified by Firebase. A Google email that
   * matches an existing account signs into it; otherwise an account without a
   * password is created.
   */
  async loginWithGoogle(idToken: string) {
    const { email, name } = await this.firebaseAuth.verifyGoogleToken(idToken);
    const user =
      (await this.userService.findOneByEmailIgnoringCase(email)) ??
      (await this.userService.create(name, email));
    return this.issueToken(user);
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.findOneByEmailIgnoringCase(
      registerDto.email,
    );
    if (user)
      throw new HttpException('User already exists', HttpStatus.BAD_REQUEST);

    await this.userService.create(
      registerDto.name,
      registerDto.email,
      await hashPassword(registerDto.password),
    );
    return await this.login({
      email: registerDto.email,
      password: registerDto.password,
    });
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    const user = await this.userService.findOne(resetDto.email);
    // Same error for unknown email and wrong password so accounts can't be enumerated
    if (
      !user ||
      !user.password ||
      !(await comparePassword(resetDto.currentPassword, user.password))
    ) {
      throw new UnauthorizedException('Email or current password is incorrect');
    }

    await this.userService.updatePassword(
      resetDto.email,
      await hashPassword(resetDto.password),
    );

    return new ApiResponseDto<string>().ok('Password reset successfully');
  }
}

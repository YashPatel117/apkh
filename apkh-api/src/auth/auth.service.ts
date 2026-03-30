import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto, RegisterDto, ResetPasswordDto } from './model/auth.dto';
import { UsersService } from 'src/users/users.service';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { JwtService } from '@nestjs/jwt';
import { comparePassword, hashPassword } from 'src/common/utils/hash';

@Injectable()
export class AuthService {
  constructor(
    private userService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.userService.findOne(loginDto.email);
    if (user) {
      if (await comparePassword(loginDto.password, user.password)) {
        const payload = { email: user.email, _id: user._id };
        return new ApiResponseDto<string>().ok(
          await this.jwtService.signAsync(payload),
        );
      } else {
        throw new UnauthorizedException();
      }
    }
    throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
  }

  async register(registerDto: RegisterDto) {
    const user = await this.userService.findOne(registerDto.email);
    if (user)
      return new HttpException('User already exists', HttpStatus.BAD_REQUEST);

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
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    await this.userService.updatePassword(
      resetDto.email,
      await hashPassword(resetDto.password),
    );

    return new ApiResponseDto<string>().ok('Password reset successfully');
  }
}

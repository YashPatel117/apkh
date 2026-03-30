import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Get('/profile')
  async findAll(@JwtTokenUserId() userId: string) {
    return await this.usersService.findOneById(userId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import type { PlanId } from 'src/users/plans';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

class UsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

class SetPlanDto {
  @IsIn(['free', 'pro'])
  plan!: PlanId;
}

class VouchersQueryDto {
  @IsOptional()
  @IsIn(['all', 'unused', 'redeemed'])
  status?: 'all' | 'unused' | 'redeemed';
}

class CreateVouchersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;
}

/** Admin panel (users listed in ADMIN_EMAILS only). */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  async overview() {
    return new ApiResponseDto().ok(await this.admin.overview());
  }

  @Get('users')
  async users(@Query() query: UsersQueryDto) {
    return new ApiResponseDto().ok(
      await this.admin.users(query.q, Number(query.page) || 1),
    );
  }

  @Patch('users/:id/plan')
  async setPlan(@Param('id') id: string, @Body() dto: SetPlanDto) {
    return new ApiResponseDto().ok(await this.admin.setPlan(id, dto.plan));
  }

  @Get('vouchers')
  async vouchers(@Query() query: VouchersQueryDto) {
    return new ApiResponseDto().ok(
      await this.admin.vouchers(query.status ?? 'all'),
    );
  }

  @Post('vouchers')
  async createVouchers(@Body() dto: CreateVouchersDto) {
    return new ApiResponseDto().ok(
      await this.admin.createVouchers(Number(dto.count)),
    );
  }

  @Delete('vouchers/:code')
  async revokeVoucher(@Param('code') code: string) {
    return new ApiResponseDto().ok(
      await this.admin.revokeVoucher(code.toUpperCase()),
    );
  }
}

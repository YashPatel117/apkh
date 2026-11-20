import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { RateLimit } from 'src/common/rate-limit/rate-limit';
import type { FolderRole } from 'src/common/schema/folder-member';
import { CollabService } from './collab.service';
import { NotificationsService } from './notifications.service';

const ROLES: FolderRole[] = ['viewer', 'editor'];

export class InviteMemberDto {
  /** Email of an existing account */
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsIn(ROLES)
  role!: FolderRole;
}

export class ChangeRoleDto {
  @IsIn(ROLES)
  role!: FolderRole;
}

export class MarkReadDto {
  /** One notification; leave out to mark all read */
  @IsOptional()
  @IsMongoId()
  id?: string;
}

/** Sharing folders with other users, and their invites. */
@ApiTags('Sharing')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class CollabController {
  constructor(
    private readonly collab: CollabService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The owner and members of a shared folder (pending invites: owner only) */
  @Get('folders/:id/members')
  async members(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(await this.collab.members(userId, id));
  }

  /** Invite an existing user by email; they accept in the app */
  @Post('folders/:id/members')
  // Guessing which emails have accounts would be slow.
  @RateLimit({ limit: 30, windowMs: 60 * 60_000, by: 'user', bucket: 'invite' })
  async invite(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
  ) {
    return new ApiResponseDto().ok(
      await this.collab.invite(userId, id, dto.email, dto.role),
    );
  }

  @Patch('folders/:id/members/:memberId')
  async changeRole(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return new ApiResponseDto().ok(
      await this.collab.changeRole(userId, id, memberId, dto.role),
    );
  }

  /** Remove a member or withdraw an invite */
  @Delete('folders/:id/members/:memberId')
  async remove(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return new ApiResponseDto().ok(
      await this.collab.remove(userId, id, memberId),
    );
  }

  /** Leave a folder someone shares with you */
  @Post('folders/:id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(await this.collab.leave(userId, id));
  }

  @Post('folders/:id/invite/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(await this.collab.respond(userId, id, true));
  }

  @Post('folders/:id/invite/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(
      await this.collab.respond(userId, id, false),
    );
  }

  /** Invites waiting for your answer */
  @Get('shares/invites')
  async invites(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.collab.pendingInvites(userId));
  }

  /** The latest notifications and how many are unread */
  @Get('notifications')
  async listNotifications(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.notifications.list(userId));
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@JwtTokenUserId() userId: string, @Body() dto: MarkReadDto) {
    return new ApiResponseDto().ok(
      await this.notifications.markRead(userId, dto?.id),
    );
  }
}

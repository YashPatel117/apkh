import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { JwtTokenUserId } from 'src/common/decorator/jwt.decorator';
import { ApiResponseDto } from 'src/common/dto/api/response';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { FoldersService } from './folders.service';

class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string | null;
}

class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  /** null moves the folder to the top level */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  parentId?: string | null;
}

@ApiTags('Folders')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  async list(@JwtTokenUserId() userId: string) {
    return new ApiResponseDto().ok(await this.folders.list(userId));
  }

  @Post()
  async create(@JwtTokenUserId() userId: string, @Body() dto: CreateFolderDto) {
    return new ApiResponseDto().ok(
      await this.folders.create(userId, dto.name, dto.parentId ?? null),
    );
  }

  /** Rename, or move (drag and drop) into another folder */
  @Patch(':id')
  async update(
    @JwtTokenUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return new ApiResponseDto().ok(await this.folders.update(userId, id, dto));
  }

  /** Its notes and subfolders move up to its parent */
  @Delete(':id')
  async remove(@JwtTokenUserId() userId: string, @Param('id') id: string) {
    return new ApiResponseDto().ok(await this.folders.remove(userId, id));
  }
}

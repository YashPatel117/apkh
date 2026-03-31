import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AiSearchDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  query: string;
}

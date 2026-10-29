import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

export class CreateShareDto {
  /** Days until the link stops working; null or left out: until revoked */
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 365 })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number | null;
}

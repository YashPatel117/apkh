import { IsString, IsNotEmpty } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  firstMessage: string;

  @IsString()
  @IsNotEmpty()
  aiResponse: string;
}

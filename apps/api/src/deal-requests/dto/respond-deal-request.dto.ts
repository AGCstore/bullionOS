import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RespondDealRequestDto {
  @IsIn(['accepted', 'rejected'])
  decision!: 'accepted' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

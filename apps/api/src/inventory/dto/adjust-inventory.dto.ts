import { IsInt, IsOptional, IsString, MaxLength, NotEquals } from 'class-validator';

export class AdjustInventoryDto {
  /** Signed integer — positive adds stock, negative removes. Must be non-zero. */
  @IsInt()
  @NotEquals(0)
  delta!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

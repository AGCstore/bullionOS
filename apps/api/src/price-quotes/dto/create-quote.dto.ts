import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateQuoteDto {
  @IsUUID()
  product_id!: string;

  @IsIn(['buy', 'sell'])
  side!: 'buy' | 'sell';

  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  /** Optional override: minutes the quote is valid for. Defaults to 15. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  ttl_minutes?: number;
}

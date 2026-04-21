import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Shared shape for create + update. Month is locked to the first of
 * the month at validation time because the storage model (and the
 * rollup query) both assume month granularity.
 */
export class CreateKpiManualEntryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-01$/, {
    message: 'bucket_month must be YYYY-MM-01 (first of month)',
  })
  bucket_month!: string;

  @IsIn(['sales', 'purchases', 'wholesale'])
  category!: 'sales' | 'purchases' | 'wholesale';

  @IsOptional()
  @IsUUID()
  client_id?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateKpiManualEntryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-01$/)
  bucket_month?: string;

  @IsOptional()
  @IsIn(['sales', 'purchases', 'wholesale'])
  category?: 'sales' | 'purchases' | 'wholesale';

  @IsOptional()
  @IsUUID()
  client_id?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

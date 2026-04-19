import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateShipmentDto {
  @IsUUID()
  invoice_id!: string;

  @IsIn(['ups', 'fedex', 'usps', 'other'])
  carrier!: 'ups' | 'fedex' | 'usps' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tracking_number?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weight_lbs?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  insurance_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

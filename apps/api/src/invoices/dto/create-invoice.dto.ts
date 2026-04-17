import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateInvoiceLineItemDto {
  @IsUUID()
  product_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  /** Optional manager override on unit price (admin-only at service level). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  override_unit_price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  override_reason?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  client_id!: string;

  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineItemDto)
  line_items!: CreateInvoiceLineItemDto[];

  @IsOptional()
  @IsIn(['wire', 'check', 'ach', 'cash', 'crypto', 'card'])
  payment_method?: 'wire' | 'check' | 'ach' | 'cash' | 'crypto' | 'card';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  shipping?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

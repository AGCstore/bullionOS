import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ALL_PAYMENT_METHODS = [
  'wire',
  'check',
  'ach',
  'cash',
  'crypto',
  'card',
  'zelle',
  'venmo',
] as const;
type PaymentMethodValue = (typeof ALL_PAYMENT_METHODS)[number];

/** One leg of a split payment. */
export class PaymentEntryDto {
  @IsIn(ALL_PAYMENT_METHODS)
  method!: PaymentMethodValue;

  /** Check #, Zelle memo, last-4 on card, etc. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;
}

export class CreateInvoiceLineItemDto {
  /**
   * product_id is OPTIONAL — when absent, this is an ad-hoc line
   * (walk-in scrap, one-off piece, custom item). Ad-hoc lines MUST
   * also carry `custom_name` + `override_unit_price`. The service
   * cross-validates; DTO can't express "one-of" cleanly without
   * custom decorators.
   */
  @IsOptional()
  @IsUUID()
  product_id?: string;

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

  /**
   * Free-form label that replaces the product name on the invoice snapshot.
   * Required when product_id is absent (ad-hoc line); optional otherwise,
   * in which case it overrides the catalog name for this invoice only.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  custom_name?: string;
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

  /**
   * Legacy single-method field. Still written for back-compat on the invoice
   * row and PDF header. New code should prefer `payment_methods` (below) —
   * we derive the primary from its first entry when both are provided.
   */
  @IsOptional()
  @IsIn(ALL_PAYMENT_METHODS)
  payment_method?: PaymentMethodValue;

  /**
   * Up to 3 split-payment legs — e.g. cash + check, Zelle + cash. If any
   * entries are present, payment_method is optional (derived from entry 0);
   * if none are present AND payment_method is empty, invoice creation fails
   * at the service layer (payment method is now required).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PaymentEntryDto)
  payment_methods?: PaymentEntryDto[];

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

  /**
   * Manual timestamp override. Empty/absent = use NOW() at insert time.
   * Supplied by the wizard for backdated walk-ins. Must be ISO-8601; the
   * browser produces UTC via Date.toISOString(). The invoice_number
   * sequence still uses the year of NOW(), so a backdated 2025 transaction
   * created today still gets a 2026-numbered ticket — keeps serialization
   * monotonic.
   */
  @IsOptional()
  @IsISO8601()
  transacted_at?: string;
}

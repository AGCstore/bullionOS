import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpsertPricingRuleDto {
  @IsIn(['metal', 'product'])
  scope!: 'metal' | 'product';

  @ValidateIf((o: UpsertPricingRuleDto) => o.scope === 'metal')
  @IsIn(['gold', 'silver', 'platinum', 'palladium'])
  metal?: 'gold' | 'silver' | 'platinum' | 'palladium';

  @ValidateIf((o: UpsertPricingRuleDto) => o.scope === 'product')
  @IsUUID()
  product_id?: string;

  @IsIn(['percent', 'flat'])
  buy_premium_type!: 'percent' | 'flat';

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-100)
  @Max(100000)
  buy_premium_value!: number;

  @IsIn(['percent', 'flat'])
  sell_premium_type!: 'percent' | 'flat';

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-100)
  @Max(100000)
  sell_premium_value!: number;

  @IsOptional()
  @IsString()
  effective_until?: string;
}

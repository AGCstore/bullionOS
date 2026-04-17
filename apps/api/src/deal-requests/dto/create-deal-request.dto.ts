import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateDealRequestDto {
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  // Either product_id OR product_description must be provided (enforced in service).
  @IsOptional()
  @IsUUID()
  product_id?: string;

  @ValidateIf((o: CreateDealRequestDto) => !o.product_id)
  @IsString()
  @MaxLength(500)
  product_description?: string;

  @IsOptional()
  @IsIn(['gold', 'silver', 'platinum', 'palladium'])
  metal?: 'gold' | 'silver' | 'platinum' | 'palladium';

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  estimated_weight_troy_oz?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

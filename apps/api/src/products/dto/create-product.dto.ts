import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'sku must be uppercase alphanumeric with - or _' })
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsIn(['gold', 'silver', 'platinum', 'palladium'])
  metal!: 'gold' | 'silver' | 'platinum' | 'palladium';

  @IsIn(['coin', 'bar', 'round', 'numismatic', 'jewelry', 'other'])
  category!: 'coin' | 'bar' | 'round' | 'numismatic' | 'jewelry' | 'other';

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  @Max(100000)
  weight_troy_oz!: number;

  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.0001)
  @Max(1)
  purity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image_url?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  show_on_website?: boolean;
}

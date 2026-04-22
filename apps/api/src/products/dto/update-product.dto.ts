import { PartialType } from '@nestjs/mapped-types';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  /**
   * Optional direct edit of the metal content (AGW / ASW / APW). When
   * set, the server HOLDS gross weight_troy_oz constant and back-solves
   * purity = metal_content_troy_oz / weight_troy_oz. Lets the inline
   * editor on the In-Stock Sheet adjust the melt-driving figure
   * without the operator having to mentally divide by gross weight.
   *
   * If the caller also sends `weight_troy_oz` or `purity` in the same
   * patch, those take precedence (they're explicit; content-derived
   * purity is a helpful default, not an override).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  @Max(100000)
  metal_content_troy_oz?: number;
}

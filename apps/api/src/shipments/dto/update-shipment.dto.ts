import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tracking_number?: string;

  @IsOptional()
  @IsIn([
    'label_created',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'exception',
    'returned',
  ])
  status?:
    | 'label_created'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'exception'
    | 'returned';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

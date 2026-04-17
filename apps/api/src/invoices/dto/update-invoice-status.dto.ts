import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateInvoiceStatusDto {
  @IsIn(['draft', 'finalized', 'paid', 'shipped', 'canceled'])
  status!: 'draft' | 'finalized' | 'paid' | 'shipped' | 'canceled';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

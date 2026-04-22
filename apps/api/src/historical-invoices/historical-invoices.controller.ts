import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HistoricalInvoicesService } from './historical-invoices.service';

class CreateHistoricalInvoiceDto {
  @IsDateString() date!: string;
  @IsIn(['buy', 'sell']) type!: 'buy' | 'sell';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) amount!: number;
  @IsOptional() @IsBoolean() is_wholesale?: boolean;
  @IsOptional() @IsUUID() client_id?: string | null;
  @IsOptional() @IsString() @MaxLength(200) client_name?: string | null;
  @IsOptional() @IsString() @MaxLength(120) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

class UpdateHistoricalInvoiceDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsIn(['buy', 'sell']) type?: 'buy' | 'sell';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) amount?: number;
  @IsOptional() @IsBoolean() is_wholesale?: boolean;
  @IsOptional() @IsUUID() client_id?: string | null;
  @IsOptional() @IsString() @MaxLength(200) client_name?: string | null;
  @IsOptional() @IsString() @MaxLength(120) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

/**
 * Admin-only surface for booking prior-system invoices into Desk's
 * KPI rollups. The table is consulted by the KPI controller via
 * UNION ALL against the live `invoices` table.
 */
@Controller('admin/historical-invoices')
@Roles('admin')
export class HistoricalInvoicesController {
  constructor(private readonly service: HistoricalInvoicesService) {}

  @Get()
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    // Light validation — ISO-date regex so a bad query string doesn't
    // poison the SQL. Matches YYYY-MM-DD.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    return this.service.list({
      from: from && dateRe.test(from) ? from : undefined,
      to: to && dateRe.test(to) ? to : undefined,
      limit: limit ? Math.min(1000, Math.max(1, Number(limit))) : undefined,
    });
  }

  @Get('summary')
  summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    return this.service.summary({
      from: from && dateRe.test(from) ? from : undefined,
      to: to && dateRe.test(to) ? to : undefined,
    });
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateHistoricalInvoiceDto, @CurrentUser() user: RequestUser) {
    return this.service.create(
      {
        date: dto.date,
        type: dto.type,
        amount: dto.amount,
        is_wholesale: dto.is_wholesale,
        client_id: dto.client_id ?? null,
        client_name: dto.client_name ?? null,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
      },
      user.id,
    );
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateHistoricalInvoiceDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.delete(id);
  }

  /**
   * CSV bulk import. File is parsed in-memory (1 MB cap, comfortably
   * fits tens of thousands of rows). Each row is independently
   * validated; valid rows insert in one transaction, invalid rows
   * come back as per-row errors the accountant can fix.
   */
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1_000_000, files: 1 },
    }),
  )
  async importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    const text = file.buffer.toString('utf8');
    const rows = parseCsv(text);
    return this.service.bulkImport(rows, user.id);
  }
}

/**
 * Minimal CSV parser — header row maps into object keys, subsequent
 * rows become objects. Handles quoted fields with embedded commas and
 * doubled-quote escapes. We'd bring in papaparse if this ever needed
 * to handle Excel quirks (BOM, CRLF), but for typed-in accountant data
 * this is enough.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  // Strip UTF-8 BOM if present (Excel adds one on export).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return out;
  const header = splitCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? '';
    out.push(row);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur === '') {
        inQuote = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

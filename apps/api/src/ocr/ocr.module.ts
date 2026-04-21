import { Global, Module } from '@nestjs/common';
import { TextractService } from './textract.service';

/**
 * OCR module — currently one provider (AWS Textract AnalyzeID) used
 * by client-attachment uploads to auto-extract driver's-license
 * fields. @Global so any future feature can inject TextractService
 * without bouncing through imports.
 */
@Global()
@Module({
  providers: [TextractService],
  exports: [TextractService],
})
export class OcrModule {}

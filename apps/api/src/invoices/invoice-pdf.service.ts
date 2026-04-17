import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import type { InvoiceWithLines } from './invoices.service';
import { d, toDisplay } from '../common/money';
import { SettingsService, type BrandingSettings } from '../settings/settings.service';

/**
 * Minimal, financial-grade invoice PDF.
 * Design goals: zero dependencies besides pdfkit, deterministic layout,
 * currency-aligned columns, crisp mono for numbers.
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(private readonly settings: SettingsService) {}

  async render(invoice: InvoiceWithLines): Promise<Readable> {
    const branding = await this.settings.getBranding();
    const logoPath = await this.settings.resolveLogoFile();

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 54, left: 54, right: 54, bottom: 54 },
      info: {
        Title: `Invoice ${invoice.invoice_number}`,
        Author: branding.company_name,
        Subject: `Invoice ${invoice.invoice_number}`,
      },
    });

    // --- Header: logo (if set) OR wordmark ---
    if (logoPath && path.extname(logoPath).toLowerCase() !== '.svg') {
      try {
        // pdfkit supports PNG + JPEG natively. SVG needs an extra dep, so we
        // fall back to the wordmark for SVG logos (still readable in the UI).
        doc.image(logoPath, 54, 48, { fit: [140, 40] });
      } catch (err) {
        this.logger.warn(`Failed to embed logo: ${(err as Error).message}`);
        this.drawWordmark(doc, branding);
      }
    } else {
      this.drawWordmark(doc, branding);
    }

    // Invoice block (right side)
    const rightX = 360;
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#17171a')
      .text(invoice.type === 'sell' ? 'INVOICE' : 'BUY TICKET', rightX, 54, {
        align: 'right',
        width: 200,
      });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#55555c')
      .text(`#${invoice.invoice_number}`, rightX, 78, { align: 'right', width: 200 })
      .text(`Date: ${new Date(invoice.created_at).toISOString().slice(0, 10)}`, {
        align: 'right',
        width: 200,
      })
      .text(`Status: ${invoice.status.toUpperCase()}`, { align: 'right', width: 200 });

    // --- Client / Bill-to ---
    doc.moveDown(3);
    const billToY = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#8a8a92')
      .text(invoice.type === 'sell' ? 'BILL TO' : 'PAY TO', 54, billToY);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#17171a')
      .text(invoice.client_name, 54, billToY + 14);
    if (invoice.client_email) {
      doc.fontSize(9).fillColor('#55555c').text(invoice.client_email);
    }

    // --- Line items table ---
    const tableTop = billToY + 72;
    this.drawTableHeader(doc, tableTop);

    let cursorY = tableTop + 22;
    for (const line of invoice.line_items) {
      this.drawLine(doc, cursorY, line);
      cursorY += 22;
      if (cursorY > 680) {
        doc.addPage();
        this.drawTableHeader(doc, 54);
        cursorY = 54 + 22;
      }
    }

    // --- Totals ---
    cursorY += 10;
    doc
      .moveTo(54, cursorY)
      .lineTo(558, cursorY)
      .strokeColor('#d9d9de')
      .stroke();
    cursorY += 10;

    this.drawTotalRow(doc, cursorY, 'Subtotal', invoice.subtotal);
    cursorY += 16;
    if (d(invoice.tax).gt(0)) {
      this.drawTotalRow(doc, cursorY, 'Tax', invoice.tax);
      cursorY += 16;
    }
    if (d(invoice.shipping).gt(0)) {
      this.drawTotalRow(doc, cursorY, 'Shipping', invoice.shipping);
      cursorY += 16;
    }
    cursorY += 4;
    doc.font('Helvetica-Bold').fillColor('#17171a');
    this.drawTotalRow(doc, cursorY, 'Total', invoice.total, true);

    // --- Footer ---
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#8a8a92')
      .text(
        'Prices computed against live spot. This document is a record of a transaction at the time of creation.',
        54,
        740,
        { width: 504, align: 'center' },
      );

    doc.end();
    return doc as unknown as Readable;
  }

  private drawWordmark(doc: PDFKit.PDFDocument, branding: BrandingSettings) {
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#17171a')
      .text(branding.company_name, 54, 54, { continued: false });

    if (branding.company_tagline) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#55555c')
        .text(branding.company_tagline, 54, 78);
    }
  }

  private drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#8a8a92');
    doc.text('ITEM', 54, y);
    doc.text('QTY', 340, y, { width: 40, align: 'right' });
    doc.text('UNIT PRICE', 400, y, { width: 80, align: 'right' });
    doc.text('TOTAL', 490, y, { width: 68, align: 'right' });
    doc
      .moveTo(54, y + 14)
      .lineTo(558, y + 14)
      .strokeColor('#d9d9de')
      .stroke();
  }

  private drawLine(
    doc: PDFKit.PDFDocument,
    y: number,
    line: InvoiceWithLines['line_items'][number],
  ) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#17171a')
      .text(line.product_name_snapshot, 54, y, { width: 280, ellipsis: true });

    doc.font('Courier').fontSize(10);
    doc.text(String(line.quantity), 340, y, { width: 40, align: 'right' });
    doc.text(`$${toDisplay(line.unit_price)}`, 400, y, { width: 80, align: 'right' });
    doc.text(`$${toDisplay(line.line_total)}`, 490, y, { width: 68, align: 'right' });
  }

  private drawTotalRow(
    doc: PDFKit.PDFDocument,
    y: number,
    label: string,
    value: string,
    bold = false,
  ) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#17171a');
    doc.text(label, 400, y, { width: 80, align: 'right' });
    doc.font(bold ? 'Courier-Bold' : 'Courier');
    doc.text(`$${toDisplay(value)}`, 490, y, { width: 68, align: 'right' });
  }
}

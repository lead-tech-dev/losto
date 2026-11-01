import PDFDocument from 'pdfkit';
import { Payment } from '../db/schema';
import { PaymentLine } from './billing.service';
import { fmtAmount, fmtDay } from './billing.util';

export interface InvoiceParty {
  name: string;
  lines: string[];
}

// Coordonnées de l'émetteur, à renseigner dans .env (entité qui encaisse réellement)
export function issuerFromEnv(): InvoiceParty {
  return {
    name: process.env.INVOICE_ISSUER_NAME || '[RAISON SOCIALE À RENSEIGNER]',
    lines: (process.env.INVOICE_ISSUER_DETAILS || '[ADRESSE] | [N° RCCM / IDENTIFIANT FISCAL]').split('|').map((s) => s.trim()),
  };
}

// Facture acquittée au format PDF (A4), générée à la demande.
export function renderInvoicePdf(p: Payment, payer: InvoiceParty, patientName: string, issuer = issuerFromEnv()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Facture ${p.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const green = '#0E5A43';
    const muted = '#5B6762';
    const left = 56;
    const right = doc.page.width - 56;

    doc.fillColor(green).fontSize(20).font('Helvetica-Bold').text('Proche Santé', left, 56);
    doc.fillColor('#17211D').fontSize(10).font('Helvetica').text(issuer.name, left, 84);
    issuer.lines.forEach((l) => doc.fillColor(muted).text(l));

    doc.fillColor('#17211D').font('Helvetica-Bold').fontSize(16).text('Facture acquittée', left, 56, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(muted);
    doc.text(`N° ${p.invoiceNumber}`, { align: 'right' });
    doc.text(`Date : ${fmtDay(p.paidAt ?? p.createdAt)}`, { align: 'right' });

    let y = 170;
    doc.fillColor(muted).fontSize(9).text('FACTURÉ À', left, y);
    doc.fillColor('#17211D').fontSize(11).font('Helvetica-Bold').text(payer.name, left, y + 14);
    doc.font('Helvetica').fontSize(10);
    payer.lines.forEach((l) => doc.text(l));
    doc.fillColor(muted).fontSize(9).text('BÉNÉFICIAIRE DU SUIVI', 330, y);
    doc.fillColor('#17211D').fontSize(11).font('Helvetica-Bold').text(patientName, 330, y + 14);

    y = 260;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#E2E0D8').stroke();
    doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('DÉSIGNATION', left, y + 10);
    doc.text('MONTANT', left, y + 10, { align: 'right' });
    y += 30;
    doc.font('Helvetica').fontSize(11).fillColor('#17211D');
    for (const line of p.lines as PaymentLine[]) {
      doc.text(line.label, left, y, { width: 360 });
      doc.text(fmtAmount(line.amount, p.currency), left, y, { align: 'right' });
      y = Math.max(doc.y, y + 16) + 8;
    }
    if (p.periodStart && p.periodEnd) {
      doc.fillColor(muted).fontSize(9).text(`Période : du ${fmtDay(p.periodStart)} au ${fmtDay(p.periodEnd)}`, left, y);
      y = doc.y + 10;
    }
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#E2E0D8').stroke();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#17211D').text('Total payé', left, y + 12);
    doc.text(fmtAmount(p.amount, p.currency), left, y + 12, { align: 'right' });

    y += 50;
    doc.font('Helvetica').fontSize(10).fillColor(muted);
    doc.text(`Payé le ${fmtDay(p.paidAt ?? p.createdAt)} par ${p.method === 'CARD' ? 'carte bancaire' : 'Mobile Money'}.`, left, y);
    if (p.kind === 'MEDICATION') doc.text('Médicaments refacturés au prix de la pharmacie, sans marge.');
    if (process.env.INVOICE_LEGAL_NOTE) doc.text(process.env.INVOICE_LEGAL_NOTE);

    doc.end();
  });
}

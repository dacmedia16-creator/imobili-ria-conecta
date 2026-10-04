#!/usr/bin/env node
// Etapa final do contrato-base RE/MAX: esvazia os campos AcroForm da unidade (nome, razão
// social, endereço, cidade, estado, CNPJ, nome comercial). O texto fixo da unidade (CRECI,
// cláusula da pág. 6 e linha do logo) já foi removido por redação antes desta etapa.
// Uso: node scripts/exclusividade-limpar-campos-unidade.mjs <entrada.pdf> <saida.pdf>
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Uso: <entrada.pdf> <saida.pdf>");
const UNIT_FIELDS = [
  "Franquia",
  "REMAX",
  "undefined",
  "with",
  "registered with the CNPJME under number",
  "registered with the CNPJME undger number",
  "undefined_2",
  "REMAX_2",
];
const pdf = await PDFDocument.load(readFileSync(input));
const form = pdf.getForm();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const name of UNIT_FIELDS) {
  const field = form.getTextField(name);
  field.setText("");
  field.updateAppearances(font);
}
writeFileSync(output, await pdf.save());
console.log(`campos da unidade esvaziados: ${UNIT_FIELDS.length}`);

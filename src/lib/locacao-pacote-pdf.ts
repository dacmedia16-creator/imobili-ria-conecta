// "Pacote para a administradora" do condomínio (t_40cff7e4): um único PDF com locatário, endereço/unidade, data de
// entrada, ficha de cada morador e as cópias dos RGs anexadas. Montado no servidor do site (os RGs vêm do bucket
// privado); o corretor baixa e manda ele mesmo — o sistema não envia nada.
import { pdfSafe } from "@/lib/owner-feedback-pdf";
import { dataBr, enderecoCompleto } from "@/lib/locacao";
import { moradorAdulto, type Morador } from "@/lib/locacao-moradores";

export type PacoteDados = {
  codigo: string;
  locatario: { nome: string; cpf: string; nascimento: string; email: string; telefone: string };
  moradores: Morador[];
  endereco: string;
  unidade: string | null;
  entrada: string | null;
};
export type PacoteRg = { item: string; bytes: Uint8Array; tipo: "pdf" | "jpg" | "png" | "outro" };

export const nomeArquivoPacote = (codigo: string) =>
  `pacote-administradora-${codigo.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;

/** Tipo pelo conteúdo (não pela extensão): PDF, JPEG ou PNG entram no pacote; o resto vira aviso. */
export function tipoArquivo(b: Uint8Array): PacoteRg["tipo"] {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return "outro";
}

export async function montarPacotePdf(
  d: PacoteDados,
  rgs: PacoteRg[],
  hoje: string,
  geradoPor: string,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Pacote para a administradora - ${d.codigo}`));
  pdf.setProducer("ADM MAX");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const INK = rgb(0.13, 0.15, 0.2);
  const MUTED = rgb(0.42, 0.45, 0.52);
  const LINE = rgb(0.85, 0.87, 0.91);
  const PW = 595.28;
  const PH = 841.89;
  const M = 48;
  let page = pdf.addPage([PW, PH]);
  let y = PH - M;
  const nova = () => {
    page = pdf.addPage([PW, PH]);
    y = PH - M;
  };
  const linha = (t: string, size = 10, f = font, cor = INK, x = M) => {
    if (y < M + 20) nova();
    page.drawText(pdfSafe(t), { x, y, size, font: f, color: cor });
    y -= size + 5;
  };
  const campo = (rot: string, val: string, x = M) => {
    if (y < M + 20) nova();
    page.drawText(pdfSafe(rot), { x, y, size: 9, font: bold, color: MUTED });
    page.drawText(pdfSafe(val || "-"), { x: x + 110, y, size: 10, font, color: INK });
    y -= 15;
  };
  const regua = () => {
    page.drawLine({
      start: { x: M, y: y + 4 },
      end: { x: PW - M, y: y + 4 },
      thickness: 0.7,
      color: LINE,
    });
    y -= 10;
  };

  linha("Cadastro de moradores para a administradora do condomínio", 15, bold);
  linha(`Locação ${d.codigo} · gerado em ${dataBr(hoje)} por ${geradoPor}`, 9, font, MUTED);
  y -= 6;
  regua();
  linha("Imóvel", 12, bold);
  campo("Endereço", enderecoCompleto(d.endereco, null));
  campo("Unidade", d.unidade ?? "-");
  campo("Data de entrada", d.entrada ? dataBr(d.entrada) : "-");
  y -= 4;
  regua();
  linha("Locatário", 12, bold);
  campo("Nome", d.locatario.nome);
  campo("CPF", d.locatario.cpf);
  campo("Nascimento", d.locatario.nascimento ? dataBr(d.locatario.nascimento) : "-");
  campo("E-mail", d.locatario.email);
  campo("Telefone", d.locatario.telefone);
  y -= 4;
  regua();
  linha(`Moradores (${d.moradores.length})`, 12, bold);
  d.moradores.forEach((p, i) => {
    if (y < M + 100) nova();
    const adulto = moradorAdulto(p.nascimento, hoje);
    linha(`${i + 1}. ${p.nome}${adulto ? "" : " (menor de 18 anos)"}`, 10.5, bold);
    campo("CPF", p.cpf, M + 12);
    campo("Nascimento", dataBr(p.nascimento), M + 12);
    campo("E-mail", p.email || "-", M + 12);
    campo("Telefone", p.telefone || "-", M + 12);
    campo("Cópia do RG", adulto ? "anexa neste arquivo" : "não exigida (menor)", M + 12);
    y -= 4;
  });
  y -= 6;
  linha(
    "Dados repassados para cadastro no condomínio, conforme aviso dado ao locatário na ficha da locação.",
    8,
    font,
    MUTED,
  );

  // Cópias dos RGs: PDF entra com as próprias páginas; imagem entra numa página A4, ajustada à margem.
  for (const rg of rgs) {
    if (rg.tipo === "pdf") {
      const src = await PDFDocument.load(rg.bytes, { ignoreEncryption: true });
      const pags = await pdf.copyPages(src, src.getPageIndices());
      pags.forEach((p) => {
        pdf.addPage(p);
        // Identifica a cópia no topo de cada página (o PDF do RG chega sem o nome do morador).
        p.drawText(pdfSafe(rg.item), {
          x: 12,
          y: p.getHeight() - 14,
          size: 8,
          font: bold,
          color: MUTED,
        });
      });
      continue;
    }
    nova();
    linha(rg.item, 12, bold);
    if (rg.tipo === "outro") {
      linha(
        "Formato de arquivo não suportado no pacote: abra a cópia na locação.",
        10,
        font,
        MUTED,
      );
      continue;
    }
    const img = rg.tipo === "png" ? await pdf.embedPng(rg.bytes) : await pdf.embedJpg(rg.bytes);
    const maxW = PW - 2 * M;
    const maxH = y - M;
    const k = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * k;
    const h = img.height * k;
    page.drawImage(img, { x: M + (maxW - w) / 2, y: y - h, width: w, height: h });
  }
  return pdf.save();
}

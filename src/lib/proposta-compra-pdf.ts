// PDF da proposta de compra (t_da0dac53; texto oficial em t_b4e7c368). Usa a geração de PDF que já existe no
// ADM MAX: pdf-lib + pdfSafe (Helvetica/WinAnsi) e o logo da imobiliária (agency-brand → logoForPdf), igual ao
// Feedback do proprietário.
// - Prévia/versão para assinatura: o TEXTO OFICIAL (proposta-compra-texto.ts), com cabeçalho da imobiliária vindo do
//   cadastro, seções numeradas e a tabela de signatários.
// - PDF final: o mesmo conteúdo + página "Comprovação das assinaturas" com o código e o hash do documento.
// Enquanto o advogado não aprovar o texto (TEXTO_APROVADO_ADVOGADO = false), cada página leva a marca interna
// "Minuta: texto pendente de aprovação do advogado".
import { pdfSafe } from "@/lib/owner-feedback-pdf";
import { PAPEL_LABEL } from "@/lib/proposta-compra";
import {
  aparelho,
  dataHoraSp,
  mascararIp,
  mascararTelefone,
  textoDoDetalhe,
  type Comprovacao,
  type PropostaDetalhe,
} from "@/lib/proposta-compra-tela";
import { montarTextoProposta, type Item, type TextoProposta } from "@/lib/proposta-compra-texto";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";

export type PropostaPdfInput = {
  proposta: PropostaDetalhe;
  /** Nome da imobiliária para o caso de o cadastro não ter vindo (o texto usa o cadastro). */
  imobiliaria: string | null;
  logo?: Uint8Array | null;
  /** Presente = PDF final com a página "Comprovação das assinaturas". */
  comprovacao?: Comprovacao | null;
  emitidoEm?: Date;
};

export const nomeArquivoProposta = (documento: string, versao: number, final = false) =>
  `proposta-${documento.replace(/[^A-Za-z0-9-]/g, "")}-v${versao}${final ? "-assinada" : ""}.pdf`;

/** Texto oficial da proposta (o mesmo que o PDF desenha). */
export function textoDaProposta(p: PropostaDetalhe, imobiliaria: string | null, hoje?: string) {
  const entrada = textoDoDetalhe(p);
  if (!entrada.cadastro.nome && imobiliaria?.trim())
    entrada.cadastro = { ...entrada.cadastro, nome: imobiliaria.trim() };
  return montarTextoProposta(entrada, hoje ?? hojeSaoPaulo());
}

export async function buildPropostaPdf(input: PropostaPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  type Color = ReturnType<typeof rgb>;
  const p = input.proposta;
  const hoje = input.emitidoEm ? hojeSaoPaulo(input.emitidoEm) : undefined;
  const tx: TextoProposta = textoDaProposta(p, input.imobiliaria, hoje);
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Proposta de compra ${p.documento} v${p.versao}`));
  pdf.setProducer("ADM MAX");
  pdf.setCreator("ADM MAX");
  if (input.emitidoEm) {
    pdf.setCreationDate(input.emitidoEm);
    pdf.setModificationDate(input.emitidoEm);
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const NAVY = rgb(0, 0.055, 0.21);
  const RED = rgb(0.86, 0.11, 0.18);
  const INK = rgb(0, 0, 0);
  const CINZA = rgb(0.35, 0.38, 0.43);
  const LINHA = rgb(0.84, 0.85, 0.9);
  const FUNDO_SEC = rgb(0.95, 0.96, 0.98);
  const AMBER = rgb(0.6, 0.38, 0);
  const WHITE = rgb(1, 1, 1);

  // A4 em pontos; margens como na Campolim (18 mm).
  const PW = 595.28;
  const PH = 841.89;
  const MM = 2.8346;
  const M = 18 * MM;
  const W = PW - 2 * M;
  const BOTTOM = 26 * MM;
  const s = (t: string) => pdfSafe(t);
  let page = pdf.addPage([PW, PH]);
  let y = PH;

  const txt = (t: string, x: number, base: number, size = 9.6, f = font, color: Color = INK) =>
    page.drawText(s(t), { x, y: base, size, font: f, color });
  const larg = (t: string, size: number, f = font) => f.widthOfTextAtSize(s(t), size);
  const wrap = (t: string, size: number, width: number, f = font): string[] => {
    const out: string[] = [];
    for (const para of s(t).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/).filter(Boolean)) {
        let word = w;
        while (f.widthOfTextAtSize(word, size) > width) {
          let i = word.length - 1;
          while (i > 1 && f.widthOfTextAtSize(word.slice(0, i), size) > width) i--;
          if (line) out.push(line);
          line = "";
          out.push(word.slice(0, i));
          word = word.slice(i);
        }
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out.length ? out : [""];
  };

  // ---------- cabeçalho (imobiliária do cadastro) ----------
  const logoImg = await (async () => {
    if (!input.logo?.length) return null;
    try {
      const isPng = input.logo[0] === 0x89 && input.logo[1] === 0x50;
      return isPng ? await pdf.embedPng(input.logo) : await pdf.embedJpg(input.logo);
    } catch {
      return null; // logo inválido: segue sem logo (mesma regra do Feedback do proprietário)
    }
  })();
  const cabecalho = (primeira: boolean) => {
    const H = (primeira ? 34 : 19) * MM;
    page.drawRectangle({ x: 0, y: PH - H, width: PW, height: H, color: NAVY });
    if (logoImg) {
      const lh = (primeira ? 22 : 11) * MM;
      const lw = Math.min((logoImg.width / logoImg.height) * lh, (primeira ? 54 : 27) * MM);
      page.drawImage(logoImg, {
        x: M,
        y: PH - (primeira ? 6 : 3) * MM - lh,
        width: lw,
        height: lh,
      });
    } else {
      txt(tx.cabecalho.nome, M, PH - (primeira ? 18 : 12) * MM, primeira ? 13 : 9, bold, WHITE);
    }
    if (primeira) {
      const linhas = [
        tx.cabecalho.nome,
        ...(tx.cabecalho.linha ? wrap(tx.cabecalho.linha, 8, W * 0.62) : []),
      ];
      linhas.slice(0, 5).forEach((l, i) => {
        const size = i === 0 ? 9 : 8;
        const f = i === 0 ? bold : font;
        txt(l, M + W - larg(l, size, f), PH - 12 * MM - i * 4.6 * MM, size, f, WHITE);
      });
    } else {
      const r = `Proposta de compra nº ${p.documento}`;
      txt(r, M + W - larg(r, 7.5), PH - 11 * MM, 7.5, font, WHITE);
    }
    y = PH - H - (primeira ? 10 : 8) * MM;
    if (tx.marcaInterna) {
      txt(tx.marcaInterna.toUpperCase(), M, y + 3 * MM, 7, bold, AMBER);
    }
  };
  const novaPagina = () => {
    page = pdf.addPage([PW, PH]);
    cabecalho(false);
  };
  const garantir = (h: number) => {
    if (y - h < BOTTOM) novaPagina();
  };
  const par = (t: string, o: { recuo?: boolean; size?: number; f?: typeof font } = {}) => {
    const size = o.size ?? 9.6;
    const lh = size * 0.47 * MM;
    const x = M + (o.recuo ? 2 * MM : 0);
    for (const l of wrap(t, size, W - (x - M), o.f ?? font)) {
      garantir(lh + 2);
      txt(l, x, y - size, size, o.f ?? font);
      y -= lh;
    }
    y -= (o.recuo ? 1.4 : 2.2) * MM;
  };
  const secao = (t: string) => {
    garantir(14 * MM);
    const h = 7.2 * MM;
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: FUNDO_SEC });
    page.drawRectangle({ x: M, y: y - h, width: 1.4 * MM, height: h, color: RED });
    txt(t.toUpperCase(), M + 4 * MM, y - 5 * MM, 10, bold, NAVY);
    y -= 10.5 * MM;
  };
  // Campos "rótulo: valor" em duas colunas (largo = linha toda), como na Campolim.
  const campos = (lista: { rotulo: string; valor: string; largo?: boolean }[]) => {
    const col = W / 2 - 3 * MM;
    const lh = 4.4 * MM;
    // Rótulo pequeno em cinza; valor em negrito logo abaixo (baseline 4 mm abaixo do rótulo).
    const desenha = (c: (typeof lista)[number], x: number, ls: string[]) => {
      txt(c.rotulo.toUpperCase(), x, y - 7, 7.6, font, CINZA);
      ls.forEach((l, k) => txt(l, x, y - 7 - 4 * MM - k * lh, 9.4, bold));
    };
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      if (a.largo) {
        const ls = wrap(a.valor, 9.4, W, bold);
        garantir(4 * MM + ls.length * lh);
        desenha(a, M, ls);
        y -= 4 * MM + ls.length * lh + 2.4 * MM;
        continue;
      }
      const b = lista[i + 1] && !lista[i + 1].largo ? lista[i + 1] : null;
      const la = wrap(a.valor, 9.4, col, bold);
      const lb = b ? wrap(b.valor, 9.4, col, bold) : [];
      const h = Math.max(la.length, lb.length);
      garantir(4 * MM + h * lh);
      desenha(a, M, la);
      if (b) {
        desenha(b, M + W / 2 + 3 * MM, lb);
        i++;
      }
      y -= 4 * MM + h * lh + 2.4 * MM;
    }
  };
  const tabela = (cab: [string, string, string], linhas: [string, string, string][]) => {
    const cx = [M, M + 62 * MM, M + 122 * MM];
    const cw = [58 * MM, 56 * MM, W - 122 * MM];
    garantir(10 * MM);
    cab.forEach((c, i) => txt(c.toUpperCase(), cx[i], y - 7.6, 7.6, bold, CINZA));
    y -= 2 * MM + 7.6;
    for (const l of linhas) {
      const cols = l.map((t, i) =>
        wrap(t, i === 0 ? 8.8 : 8.2, cw[i], i === 0 ? bold : font).slice(0, 3),
      );
      const h = Math.max(...cols.map((c) => c.length)) * 3.8 * MM + 3 * MM;
      garantir(h + 2 * MM);
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINHA });
      y -= 4.2 * MM;
      cols.forEach((c, i) =>
        c.forEach((t, k) =>
          txt(t, cx[i], y - k * 3.8 * MM, i === 0 ? 8.8 : 8.2, i === 0 ? bold : font),
        ),
      );
      y -= h - 4.2 * MM + 2.3 * MM;
    }
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINHA });
    y -= 5 * MM;
  };
  const item = (i: Item) => {
    if (i.tipo === "campos") campos(i.campos);
    else if (i.tipo === "subtitulo") {
      garantir(8 * MM);
      txt(i.texto, M, y - 9, 9, bold, NAVY);
      y -= 5.5 * MM;
    } else if (i.tipo === "par") par(i.texto, { recuo: i.recuo, size: i.pequeno ? 9 : 9.6 });
    else if (i.tipo === "valor_total") {
      garantir(22 * MM);
      txt("VALOR TOTAL PROPOSTO", M, y - 7.6, 7.6, font, CINZA);
      txt(i.valor, M, y - 7 * MM - 7.6, 15, bold, NAVY);
      y -= 12 * MM;
      for (const l of wrap(`(${i.extenso})`, 9, W)) {
        txt(l, M, y - 7.6, 9);
        y -= 4.2 * MM;
      }
      y -= 3 * MM;
    } else tabela(i.cabecalho, i.linhas);
  };

  // ---------- páginas de texto ----------
  cabecalho(true);
  txt(tx.titulo, M, y - 17, 17, bold, NAVY);
  y -= 8 * MM;
  txt(tx.subtitulo, M, y - 8.8, 8.8, font, CINZA);
  y -= 13 * MM - 8;
  par(tx.abertura);
  y -= 2 * MM;
  for (const sec of tx.secoes) {
    secao(sec.titulo);
    sec.itens.forEach(item);
  }
  par(tx.fecho, { size: 8.8 });

  // ---------- comprovação das assinaturas (só no PDF final) ----------
  const comp = input.comprovacao;
  if (comp) {
    novaPagina();
    txt("COMPROVAÇÃO DAS ASSINATURAS", M, y - 15, 15, bold, NAVY);
    y -= 9 * MM;
    par(`Código do documento: ${comp.documento} · versão ${comp.versao}`, { f: bold });
    par(`Hash do documento (SHA-256): ${comp.pdfHash ?? "-"}`, { size: 8.4 });
    par(`Hash do conteúdo: ${comp.conteudoHash ?? "-"}`, { size: 8.4 });
    par(
      `Aceita em: ${comp.aceitaEm ? dataHoraSp(comp.aceitaEm) : "ainda não aceita por todas as partes"}`,
      { size: 8.8 },
    );
    const linhas: [string, string, string][] = comp.assinaturas.map((a) => [
      `${a.nome ?? "-"}\n${PAPEL_LABEL[a.papel]}${a.papel.startsWith("vendedor") ? ` ${a.ordem}` : ""}`,
      `${mascararTelefone(a.telefone)} · ${dataHoraSp(a.assinadoEm)}`,
      `IP ${mascararIp(a.ip)} · ${aparelho(a.userAgent)}`,
    ]);
    if (linhas.length)
      tabela(["Signatário", "Celular · data e hora", "IP · aparelho/navegador"], linhas);
    else par("Nenhuma assinatura válida nesta versão.");
    par(
      'Cada parte leu a proposta pelo próprio link, digitou o código de 6 dígitos recebido no WhatsApp e confirmou "Li e concordo". O registro completo (telefone, IP e aparelho) fica guardado no ADM MAX. Qualquer alteração no texto invalida as assinaturas.',
      { size: 8.8 },
    );
  }

  // ---------- rodapé em todas as páginas ----------
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: M, y: 14 * MM },
      end: { x: M + W, y: 14 * MM },
      thickness: 0.5,
      color: LINHA,
    });
    pg.drawText(s(tx.rodape.esquerda), { x: M, y: 9.5 * MM, size: 7.5, font, color: CINZA });
    const n = `Página ${i + 1} de ${pages.length}`;
    pg.drawText(n, { x: M + W - larg(n, 7.5), y: 9.5 * MM, size: 7.5, font, color: CINZA });
    pg.drawText(s(tx.rodape.legal), { x: M, y: 5.8 * MM, size: 7.5, font, color: CINZA });
  });
  return pdf.save();
}

// PDF da proposta de compra (t_da0dac53). Usa a geração de PDF que já existe no ADM MAX: pdf-lib + pdfSafe
// (Helvetica/WinAnsi) e o logo da imobiliária (agency-brand → logoForPdf), igual ao Feedback do proprietário.
// - Prévia/versão para assinatura: dados da proposta + bloco "Texto pendente de revisão" das cláusulas
//   jurídicas (o texto vem do MAX Jurídico depois de revisado pelo advogado; aqui NÃO se inventa cláusula).
// - PDF final: o mesmo conteúdo + página "Comprovação das assinaturas" com o código do documento.
import { pdfSafe } from "@/lib/owner-feedback-pdf";
import { formatBRL } from "@/lib/formato-moeda";
import {
  FORMA_LABEL,
  PAPEL_LABEL,
  SINAL_TIPO_LABEL,
  SITUACAO_LABEL,
  TEXTO_PENDENTE,
} from "@/lib/proposta-compra";
import {
  CERTIDOES_LABEL,
  CLAUSULAS_PENDENTES,
  ESTADO_CIVIL_LABEL,
  aparelho,
  dataHoraSp,
  mascararIp,
  mascararTelefone,
  ordenarPartes,
  type Comprovacao,
  type PropostaDetalhe,
} from "@/lib/proposta-compra-tela";

export type PropostaPdfInput = {
  proposta: PropostaDetalhe;
  imobiliaria: string | null;
  logo?: Uint8Array | null;
  /** Presente = PDF final com a página "Comprovação das assinaturas". */
  comprovacao?: Comprovacao | null;
  emitidoEm?: Date;
};

export const nomeArquivoProposta = (documento: string, versao: number, final = false) =>
  `proposta-${documento.replace(/[^A-Za-z0-9-]/g, "")}-v${versao}${final ? "-assinada" : ""}.pdf`;

const doc = (d: string | null) => {
  const x = (d ?? "").replace(/\D/g, "");
  if (x.length === 11) return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
  if (x.length === 14)
    return `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}`;
  return "-";
};
const din = (n: number | null) => (n == null ? "-" : formatBRL(n));

/** Linhas [rótulo, valor] de cada bloco (sem pdf-lib, para testar o conteúdo). */
export function conteudoProposta(p: PropostaDetalhe) {
  const im = p.imovel;
  const endereco = [
    im.endereco,
    im.complemento,
    im.bairro,
    [im.cidade, im.uf].filter(Boolean).join("/"),
  ]
    .filter((x) => x && x.trim())
    .join(", ");
  const imovel: [string, string][] = [
    ["Imóvel", [im.tipo, endereco].filter(Boolean).join(" - ") || "-"],
    ["Matrícula", [im.matricula, im.cartorio].filter(Boolean).join(" - ") || "-"],
  ];
  const partes = ordenarPartes(p.partes).filter((x) => x.papel !== "corretor");
  const vendedores = partes.filter((x) => x.papel === "vendedor").length;
  const pessoa = (x: (typeof partes)[number]): [string, string] => {
    const rot =
      (x.papel === "vendedor" || x.papel === "vendedor_conjuge") && vendedores > 1
        ? `${PAPEL_LABEL[x.papel]} ${x.ordem}`
        : PAPEL_LABEL[x.papel];
    const docLabel = x.tipoPessoa === "juridica" ? "CNPJ" : "CPF";
    const ec =
      x.tipoPessoa === "fisica" && x.estadoCivil ? ESTADO_CIVIL_LABEL[x.estadoCivil] : null;
    return [rot, [x.nome ?? "-", `${docLabel} ${doc(x.cpfCnpj)}`, ec].filter(Boolean).join(" - ")];
  };
  const forma = p.formaPagamento;
  const valores: [string, string][] = [
    ["Valor oferecido", din(p.valorOferta)],
    ["Forma de pagamento", forma ? FORMA_LABEL[forma] : "-"],
  ];
  if (forma === "sinal_financiamento" || forma === "sinal_parcelas") {
    valores.push([
      "Sinal",
      `${din(p.sinalValor)}${p.sinalPrazoDias != null ? `, pago em até ${p.sinalPrazoDias} dia(s) após o aceite` : ""} (${SINAL_TIPO_LABEL.toLowerCase()})`,
    ]);
  }
  if (forma === "sinal_financiamento")
    valores.push([
      "Financiamento",
      `${din(p.financiamentoValor)} - ${p.financiamentoBanco ?? "-"}`,
    ]);
  const condicoes: [string, string][] = [
    ["Validade", `${p.validadeDias} dia(s) corridos contados do envio`],
    [
      "Contrato",
      p.prazoContratoDias
        ? `a ser assinado em até ${p.prazoContratoDias} dia(s) após o aceite`
        : "-",
    ],
    ["Certidões", p.certidoes ? CERTIDOES_LABEL[p.certidoes] : "-"],
  ];
  if (p.observacoes) condicoes.push(["Observações", p.observacoes]);
  const corretor = p.partes.find((x) => x.papel === "corretor");
  return {
    imovel,
    compradores: partes.filter((x) => x.papel.startsWith("comprador")).map(pessoa),
    vendedores: partes.filter((x) => x.papel.startsWith("vendedor")).map(pessoa),
    valores,
    condicoes,
    corretor: corretor?.nome ?? p.corretorNome ?? "-",
    assinantes: ordenarPartes(p.partes).map((x) => ({
      rotulo:
        (x.papel === "vendedor" || x.papel === "vendedor_conjuge") && vendedores > 1
          ? `${PAPEL_LABEL[x.papel]} ${x.ordem}`
          : PAPEL_LABEL[x.papel],
      nome: x.nome ?? "-",
    })),
  };
}

export async function buildPropostaPdf(input: PropostaPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  type Color = ReturnType<typeof rgb>;
  const p = input.proposta;
  const c = conteudoProposta(p);
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

  const BLUE = rgb(0, 0.24, 0.65);
  const BLUE_DARK = rgb(0, 0.16, 0.42);
  const RED = rgb(0.86, 0.11, 0.18);
  const INK = rgb(0.13, 0.15, 0.2);
  const MUTED = rgb(0.45, 0.48, 0.55);
  const LINE = rgb(0.87, 0.89, 0.93);
  const AMBER_BG = rgb(1, 0.97, 0.88);
  const AMBER = rgb(0.6, 0.38, 0);
  const WHITE = rgb(1, 1, 1);

  const PW = 595.28;
  const PH = 841.89;
  const M = 48;
  const W = PW - 2 * M;
  const BOTTOM = 70;
  const LABEL_W = 128;
  const s = (t: string) => pdfSafe(t);
  let page = pdf.addPage([PW, PH]);
  let y = PH;

  const txt = (t: string, x: number, base: number, size = 10, f = font, color: Color = INK) =>
    page.drawText(s(t), { x, y: base, size, font: f, color });
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
  const topoContinuacao = () => {
    page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: BLUE });
    page.drawRectangle({ x: 0, y: PH - 32, width: PW, height: 2, color: RED });
    txt("Proposta de compra de imóvel", M, PH - 20, 10, bold, WHITE);
    const r = `${p.documento} · versão ${p.versao}`;
    txt(r, M + W - bold.widthOfTextAtSize(s(r), 10), PH - 20, 10, bold, WHITE);
    y = PH - 32 - 26;
  };
  const novaPagina = () => {
    page = pdf.addPage([PW, PH]);
    topoContinuacao();
  };
  const garantir = (h: number) => {
    if (y - h < BOTTOM) novaPagina();
  };
  const secao = (titulo: string) => {
    garantir(60);
    page.drawRectangle({ x: M, y: y - 13, width: 4, height: 13, color: RED });
    txt(titulo.toUpperCase(), M + 11, y - 11, 11, bold, BLUE_DARK);
    y -= 24;
  };
  const linhas = (rows: [string, string][]) => {
    for (const [rot, val] of rows) {
      const ls = wrap(val, 10, W - LABEL_W);
      garantir(ls.length * 14 + 6);
      txt(rot, M, y - 10, 9, bold, MUTED);
      ls.forEach((l, i) => txt(l, M + LABEL_W, y - 10 - i * 14, 10));
      y -= ls.length * 14 + 6;
    }
    y -= 6;
  };

  // ---------- topo (1ª página) ----------
  {
    const H = 112;
    page.drawRectangle({ x: 0, y: PH - H, width: PW, height: H, color: BLUE });
    page.drawRectangle({ x: 0, y: PH - H - 4, width: PW, height: 4, color: RED });
    const ag = input.imobiliaria?.trim();
    if (ag) txt(ag.toUpperCase(), M, PH - 38, 8.5, bold, rgb(0.75, 0.83, 1));
    txt("Proposta de compra de imóvel", M, PH - 66, 22, bold, WHITE);
    txt(
      `Documento ${p.documento} · versão ${p.versao} · ${SITUACAO_LABEL[p.situacao]}`,
      M,
      PH - 88,
      10,
      font,
      rgb(0.85, 0.9, 1),
    );
    if (input.logo?.length) {
      try {
        const isPng = input.logo[0] === 0x89 && input.logo[1] === 0x50;
        const img = isPng ? await pdf.embedPng(input.logo) : await pdf.embedJpg(input.logo);
        const lh = 44;
        const lw = Math.min((img.width / img.height) * lh, 150);
        const bw = lw + 22;
        page.drawRectangle({
          x: M + W - bw,
          y: PH - 24 - lh - 18,
          width: bw,
          height: lh + 18,
          color: WHITE,
        });
        page.drawImage(img, { x: M + W - bw + 11, y: PH - 24 - 9 - lh, width: lw, height: lh });
      } catch {
        // logo inválido: segue sem logo (mesma regra do Feedback do proprietário)
      }
    }
    y = PH - H - 4 - 26;
  }

  secao("Imóvel");
  linhas(c.imovel);
  secao(c.compradores.length > 1 ? "Proponentes compradores" : "Proponente comprador");
  linhas(c.compradores.length ? c.compradores : [["Comprador", "-"]]);
  secao(c.vendedores.length > 1 ? "Vendedores" : "Vendedor");
  linhas(c.vendedores.length ? c.vendedores : [["Vendedor", "-"]]);
  secao("Valores e pagamento");
  linhas(c.valores);
  secao("Condições");
  linhas([...c.condicoes, ["Corretor do negócio", c.corretor]]);

  // ---------- cláusulas jurídicas: bloco marcado, sem texto inventado ----------
  {
    secao("Cláusulas");
    const corpo = [
      ...CLAUSULAS_PENDENTES.map((x) => `- ${x}`),
      "",
      "O texto destas cláusulas será incluído depois da revisão do advogado da imobiliária.",
    ];
    const ls = corpo.flatMap((l) => (l ? wrap(l, 9.5, W - 28) : [""]));
    const h = 34 + ls.length * 13 + 10;
    garantir(h);
    page.drawRectangle({
      x: M,
      y: y - h,
      width: W,
      height: h,
      color: AMBER_BG,
      borderColor: AMBER,
      borderWidth: 0.8,
    });
    txt(TEXTO_PENDENTE.toUpperCase(), M + 14, y - 20, 10, bold, AMBER);
    ls.forEach((l, i) => txt(l, M + 14, y - 38 - i * 13, 9.5, font, INK));
    y -= h + 16;
  }

  // ---------- assinaturas (por link + código no WhatsApp) ----------
  secao("Assinaturas");
  {
    const intro = wrap(
      "Cada parte assina eletronicamente pelo próprio link e código de 6 dígitos enviados pelo WhatsApp da imobiliária. " +
        "Qualquer alteração no texto ou nos valores gera nova versão e invalida as assinaturas anteriores.",
      9,
      W,
    );
    garantir(intro.length * 12 + 8);
    intro.forEach((l, i) => txt(l, M, y - 9 - i * 12, 9, font, MUTED));
    y -= intro.length * 12 + 14;
    const assinados = new Map(
      (input.comprovacao?.assinaturas ?? []).map((a) => [`${a.papel}:${a.ordem}`, a.assinadoEm]),
    );
    const partes = ordenarPartes(p.partes);
    c.assinantes.forEach((a, i) => {
      garantir(34);
      const x = partes[i];
      const em = x ? assinados.get(`${x.papel}:${x.ordem}`) : undefined;
      page.drawLine({
        start: { x: M, y: y - 22 },
        end: { x: M + W, y: y - 22 },
        thickness: 0.5,
        color: LINE,
      });
      txt(`${a.rotulo}: ${a.nome}`, M, y - 16, 10, bold);
      const st = em ? `assinou em ${dataHoraSp(em)}` : "aguardando assinatura";
      txt(
        st,
        M + W - font.widthOfTextAtSize(s(st), 9),
        y - 16,
        9,
        font,
        em ? rgb(0.1, 0.5, 0.25) : MUTED,
      );
      y -= 30;
    });
  }

  // ---------- comprovação das assinaturas (só no PDF final) ----------
  const comp = input.comprovacao;
  if (comp) {
    page = pdf.addPage([PW, PH]);
    topoContinuacao();
    txt("Comprovação das assinaturas", M, y - 18, 18, bold, BLUE_DARK);
    y -= 30;
    const cab: [string, string][] = [
      ["Código do documento", `${comp.documento} · versão ${comp.versao}`],
      ["Hash do PDF assinado", comp.pdfHash ?? "-"],
      ["Hash do conteúdo", comp.conteudoHash ?? "-"],
      [
        "Aceita em",
        comp.aceitaEm ? dataHoraSp(comp.aceitaEm) : "ainda não aceita por todas as partes",
      ],
    ];
    linhas(cab);
    for (const a of comp.assinaturas) {
      const rows: [string, string][] = [
        [
          "Parte",
          `${PAPEL_LABEL[a.papel]}${a.papel.startsWith("vendedor") ? ` ${a.ordem}` : ""}: ${a.nome ?? "-"}`,
        ],
        ["Celular", mascararTelefone(a.telefone)],
        ["Código confirmado em", dataHoraSp(a.assinadoEm)],
        ["Aparelho / IP", `${aparelho(a.userAgent)} · IP ${mascararIp(a.ip)}`],
        ["Hash assinado", a.pdfHash],
      ];
      garantir(rows.length * 20 + 16);
      page.drawLine({
        start: { x: M, y: y + 2 },
        end: { x: M + W, y: y + 2 },
        thickness: 0.5,
        color: LINE,
      });
      y -= 6;
      linhas(rows);
    }
    if (!comp.assinaturas.length)
      linhas([["Assinaturas", "nenhuma assinatura válida nesta versão"]]);
    const nota = wrap(
      "Cada parte leu a proposta pelo próprio link, digitou o código de 6 dígitos recebido no WhatsApp e confirmou " +
        '"Li e concordo". O registro completo (telefone, IP e aparelho) fica guardado no ADM MAX. ' +
        "Qualquer alteração no texto invalida as assinaturas.",
      9,
      W,
    );
    garantir(nota.length * 12 + 10);
    nota.forEach((l, i) => txt(l, M, y - 9 - i * 12, 9, font, MUTED));
    y -= nota.length * 12 + 10;
  }

  // ---------- rodapé com o código do documento em todas as páginas ----------
  const pages = pdf.getPages();
  const emitido = (input.emitidoEm ?? new Date()).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  pages.forEach((pg, i) => {
    const t = s(`${p.documento} · versão ${p.versao} · emitido em ${emitido} pelo ADM MAX`);
    pg.drawText(t, { x: M, y: 34, size: 8, font, color: MUTED });
    const n = `Página ${i + 1} de ${pages.length}`;
    pg.drawText(n, { x: M + W - font.widthOfTextAtSize(n, 8), y: 34, size: 8, font, color: MUTED });
  });
  return pdf.save();
}

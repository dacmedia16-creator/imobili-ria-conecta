/**
 * Leva o usuário até o campo que falta preencher.
 *
 * Reaproveita as chaves de pendência de validarProntaParaRevisao/validarDocsAprovadosParaJuridico
 * (status.ts) — não há regra de validação nova aqui, só "onde fica" cada campo na tela: etapa do
 * wizard da venda, bloco do Resumo, parte (comprador/vendedor) e o id do elemento a focar.
 */
import { DOC_TYPES, parteLabel, type Pendencia } from "@/lib/status";

export type EtapaVenda = "documentos" | "resumo" | "partes" | "pagamento" | "ocorrencia";

/** Ordem das etapas no wizard da venda — o "primeiro faltante" segue esta ordem. */
export const ORDEM_ETAPAS: EtapaVenda[] = [
  "documentos",
  "resumo",
  "partes",
  "pagamento",
  "ocorrencia",
];
const ETAPA_LABEL: Record<EtapaVenda, string> = {
  documentos: "Documentos",
  resumo: "Resumo",
  partes: "Partes",
  pagamento: "Pagamento",
  ocorrencia: "Ocorrência",
};
/** Blocos do Resumo, na ordem em que aparecem. */
const ORDEM_BLOCOS_RESUMO = ["imovel", "equipe", "valores", "comissao", "posse"];
const BLOCO_LABEL: Record<string, string> = {
  imovel: "Imóvel",
  valores: "Valores e negociação",
};

export type DestinoCampo = {
  etapa: EtapaVenda;
  /** Bloco interno do Resumo (imovel/valores…). */
  bloco?: string;
  /** Parte (comprador_1, vendedor_1, imovel…) para as etapas Partes e Documentos. */
  parte?: string;
  /** Nome do campo como o usuário vê na tela. */
  campoLabel: string;
  /** id do elemento que recebe rolagem, foco e destaque. */
  alvoId: string;
};

/** Tela única do Lançamento: não tem etapas, só seções. */
export type DestinoLancamento = { secao: string; campoLabel: string; alvoId: string };

const DOC_RE_PARTE = /^doc_(.+)_((?:comprador|vendedor)_\d+)$/;

/** Onde fica, na venda, o campo de uma pendência. null = chave desconhecida (não navega). */
export function destinoDaPendencia(campo: string): DestinoCampo | null {
  switch (campo) {
    case "imovel":
      return {
        etapa: "resumo",
        bloco: "imovel",
        campoLabel: "ID do imóvel (ou Código interno)",
        alvoId: "campo-venda-imovel",
      };
    case "matricula":
      return {
        etapa: "resumo",
        bloco: "imovel",
        campoLabel: "Matrícula",
        alvoId: "campo-venda-matricula",
      };
    case "endereco":
      return {
        etapa: "resumo",
        bloco: "imovel",
        campoLabel: "Endereço do imóvel",
        alvoId: "endereco-imovel-partes",
      };
    case "ficha":
      return {
        etapa: "resumo",
        bloco: "imovel",
        campoLabel: "Ficha do imóvel",
        alvoId: "ficha-imovel",
      };
    case "midia":
      return { etapa: "resumo", bloco: "imovel", campoLabel: "Mídia", alvoId: "campo-venda-midia" };
    case "valor_negociado":
      return {
        etapa: "resumo",
        bloco: "valores",
        campoLabel: "Valor negociado",
        alvoId: "campo-venda-valor_negociado",
      };
    case "comissao":
      return {
        etapa: "resumo",
        bloco: "valores",
        campoLabel: "Valor total da comissão",
        alvoId: "campo-venda-comissao",
      };
    case "vendedor":
      return {
        etapa: "partes",
        parte: "vendedor_1",
        campoLabel: "Vendedor/proprietário (nome e CPF)",
        alvoId: "campo-parte-vendedor_1",
      };
    case "comprador":
      return {
        etapa: "partes",
        parte: "comprador_1",
        campoLabel: "Comprador (nome e CPF)",
        alvoId: "campo-parte-comprador_1",
      };
    case "pagamento":
      return { etapa: "pagamento", campoLabel: "Forma de pagamento", alvoId: "campo-pagamento" };
    case "occ_midia":
      return { etapa: "ocorrencia", campoLabel: "Mídia", alvoId: "campo-ocorrencia-midia" };
  }
  if (campo.startsWith("doc_")) {
    const m = campo.match(DOC_RE_PARTE);
    const key = m ? m[1] : campo.slice(4);
    const tipo = DOC_TYPES.find((t) => t.key === key);
    if (!tipo) return null;
    const parte = m ? m[2] : tipo.grupo === "imovel" ? "imovel" : "outros";
    return {
      etapa: "documentos",
      parte,
      campoLabel: m ? `${tipo.label} de ${parteLabel(parte)}` : tipo.label,
      alvoId: `doc-${key}-${parte}`,
    };
  }
  return null;
}

/** Texto "onde fica": "na etapa Resumo (bloco Imóvel)". */
export function ondeFica(d: DestinoCampo): string {
  const bloco = d.bloco && BLOCO_LABEL[d.bloco] ? ` (bloco ${BLOCO_LABEL[d.bloco]})` : "";
  const parte = d.parte && d.etapa === "partes" ? ` (${parteLabel(d.parte)})` : "";
  return `na etapa ${ETAPA_LABEL[d.etapa]}${bloco}${parte}`;
}

const posicao = (d: DestinoCampo) => {
  const b = d.bloco ? ORDEM_BLOCOS_RESUMO.indexOf(d.bloco) : 0;
  return ORDEM_ETAPAS.indexOf(d.etapa) * 100 + Math.max(0, b);
};

/**
 * Pendências navegáveis, ordenadas pela posição na tela (etapa, depois bloco); empate mantém a
 * ordem original da validação. A primeira é para onde o sistema leva o usuário.
 */
export function ordenarPorPosicao(
  pendencias: Pendencia[],
): { pendencia: Pendencia; destino: DestinoCampo }[] {
  return pendencias
    .map((pendencia, i) => ({ pendencia, destino: destinoDaPendencia(pendencia.campo), i }))
    .filter((x): x is { pendencia: Pendencia; destino: DestinoCampo; i: number } => !!x.destino)
    .sort((a, b) => posicao(a.destino) - posicao(b.destino) || a.i - b.i)
    .map(({ pendencia, destino }) => ({ pendencia, destino }));
}

export function primeiraPendencia(pendencias: Pendencia[]) {
  return ordenarPorPosicao(pendencias)[0] ?? null;
}

/** Mensagem do aviso: nome do campo, onde fica e o resto da lista (se houver). */
export function mensagemPendencias(
  pendencias: Pendencia[],
  verbo: "preencher" | "aprovar" = "preencher",
): {
  titulo: string;
  descricao?: string;
} | null {
  const ordenadas = ordenarPorPosicao(pendencias);
  const primeira = ordenadas[0];
  if (!primeira) return null;
  const titulo = `Falta ${verbo} ${primeira.destino.campoLabel}, ${ondeFica(primeira.destino)}. Já abrimos ela para você.`;
  const resto = ordenadas.slice(1);
  if (!resto.length) return { titulo };
  const MAX = 6;
  const itens = resto.slice(0, MAX).map((r) => r.destino.campoLabel);
  const extra = resto.length > MAX ? ` e mais ${resto.length - MAX}` : "";
  return {
    titulo,
    descricao: `Também falta: ${itens.join("; ")}${extra}. Clique em cada item da lista de pendências para ir até ele.`,
  };
}

/**
 * Erro do banco → campo. As travas do banco (gatilhos/RPCs) devolvem textos fixos; reconhecemos
 * esses textos para levar ao campo em vez de só mostrar o erro. null = erro sem campo conhecido.
 */
export function campoDoErroBanco(
  err: { code?: string | null; message?: string | null } | null | undefined,
): string | null {
  const msg = err?.message ?? "";
  if (!msg) return null;
  if (/Informe a Mídia na Ocorrência/i.test(msg)) return "occ_midia";
  if (/Informe a Mídia da venda/i.test(msg)) return "midia";
  if (/Complete o endereço do imóvel/i.test(msg)) return "endereco";
  if (/Complete a ficha do imóvel/i.test(msg)) return "ficha";
  if (/Informe o valor negociado/i.test(msg)) return "valor_negociado";
  if (/Informe o (percentual de comissão|valor total da comissão)/i.test(msg)) return "comissao";
  if (/Adicione ao menos uma linha na divisão da comissão/i.test(msg)) return "divisao_comissao";
  return null;
}

/** Onde fica, no Lançamento (tela única), o campo de uma pendência. */
export function destinoLancamento(campo: string): DestinoLancamento | null {
  switch (campo) {
    case "midia":
      return {
        secao: "Imóvel e negociação",
        campoLabel: "Mídia",
        alvoId: "campo-lancamento-midia",
      };
    case "valor_negociado":
      return {
        secao: "Resumo da transação",
        campoLabel: "Valor negociado",
        alvoId: "campo-lancamento-valor_negociado",
      };
    case "comissao":
      return {
        secao: "Resumo da transação",
        campoLabel: "Valor total da comissão",
        alvoId: "campo-lancamento-comissao",
      };
    case "divisao_comissao":
      return {
        secao: "Divisão da comissão",
        campoLabel: "Divisão da comissão",
        alvoId: "secao-lancamento-divisao",
      };
  }
  return null;
}

export function mensagemLancamento(d: DestinoLancamento): string {
  return `Falta preencher ${d.campoLabel}, na seção ${d.secao}. Já levamos você até lá.`;
}

const DESTAQUE = ["ring-2", "ring-destructive", "ring-offset-2", "rounded-md"];
const FOCAVEL =
  "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role=combobox]:not([disabled]), button:not([disabled])";

/**
 * Rola até o elemento, dá foco no primeiro controle dele e o contorna de vermelho. Espera o
 * elemento aparecer (a etapa/bloco acabou de ser aberta e ainda vai renderizar).
 */
export function irParaCampo(alvoId: string, tentativas = 25): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(alvoId);
  if (!el) {
    if (tentativas > 0) setTimeout(() => irParaCampo(alvoId, tentativas - 1), 80);
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focavel =
    el.querySelector<HTMLElement>(FOCAVEL) ??
    (el.nextElementSibling as HTMLElement | null)?.querySelector<HTMLElement>(FOCAVEL) ??
    null;
  focavel?.focus({ preventScroll: true });
  el.classList.add(...DESTAQUE);
  el.setAttribute("data-campo-pendente", "true");
  const limpar = () => {
    el.classList.remove(...DESTAQUE);
    el.removeAttribute("data-campo-pendente");
  };
  el.addEventListener("input", limpar, { once: true });
  setTimeout(limpar, 8000);
}

/**
 * "Ajuda e sugestões" — regras puras (sem rede), usadas pela tela e pelo servidor.
 * Banco: supabase/migrations/20261008220000_ajuda_sugestoes.sql (RPCs support_ticket_*).
 */

export type TipoChamado = "erro" | "duvida" | "sugestao";
export type StatusChamado = "recebido" | "em_analise" | "respondido" | "resolvido";

export const TIPO_LABEL: Record<TipoChamado, string> = {
  erro: "Erro",
  duvida: "Dúvida",
  sugestao: "Sugestão",
};

export const STATUS_LABEL: Record<StatusChamado, string> = {
  recebido: "Recebido",
  em_analise: "Em análise",
  respondido: "Respondido",
  resolvido: "Resolvido",
};

export const STATUS_ORDEM: StatusChamado[] = ["recebido", "em_analise", "respondido", "resolvido"];

export const STATUS_CLASSE: Record<StatusChamado, string> = {
  recebido: "bg-slate-100 text-slate-800 border-slate-200",
  em_analise: "bg-amber-100 text-amber-900 border-amber-200",
  respondido: "bg-blue-100 text-blue-900 border-blue-200",
  resolvido: "bg-emerald-100 text-emerald-900 border-emerald-200",
};

export const TIPO_CLASSE: Record<TipoChamado, string> = {
  erro: "bg-red-100 text-red-900 border-red-200",
  duvida: "bg-violet-100 text-violet-900 border-violet-200",
  sugestao: "bg-teal-100 text-teal-900 border-teal-200",
};

export function tipoLabel(t: string): string {
  return TIPO_LABEL[t as TipoChamado] ?? t;
}
export function statusLabel(s: string): string {
  return STATUS_LABEL[s as StatusChamado] ?? s;
}

/**
 * WhatsApp dos avisos de chamado: pronto, mas DESLIGADO até Denis confirmar texto e custo.
 * Para ligar: trocar para true (usa a mesma chave ZIONTALK_API_KEY e o mesmo helper das captações).
 * Desligado, o sino continua funcionando normalmente.
 */
export const SUPORTE_WHATSAPP_LIGADO = false;

/** Print: tipos e tamanho aceitos (iguais ao bucket support-attachments). */
export const PRINT_TIPOS = ["image/png", "image/jpeg", "image/webp"] as const;
export type PrintTipo = (typeof PRINT_TIPOS)[number];
export const PRINT_MAX_BYTES = 5 * 1024 * 1024;

export function extensaoDoPrint(tipo: string): "png" | "jpg" | "webp" | null {
  if (tipo === "image/png") return "png";
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/webp") return "webp";
  return null;
}

/** Decodifica o print em base64 e confere tipo/tamanho. Lança com mensagem para a pessoa. */
export function decodificarPrint(p: { base64: string; contentType: string }): {
  bytes: Uint8Array;
  ext: "png" | "jpg" | "webp";
} {
  const ext = extensaoDoPrint(p.contentType);
  if (!ext) throw new Error("O print deve ser PNG, JPG ou WEBP.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Arquivo de print inválido.");
  }
  if (bytes.byteLength === 0) throw new Error("Arquivo de print vazio.");
  if (bytes.byteLength > PRINT_MAX_BYTES) throw new Error("Print acima de 5 MB.");
  return { bytes, ext };
}

/** Caminho no bucket: <organização>/<autor>/<uuid>.<ext> (o banco confere o mesmo formato). */
export function caminhoDoPrint(orgId: string, userId: string, uuid: string, ext: string): string {
  return `${orgId}/${userId}/${uuid}.${ext}`;
}

/** Nome amigável da tela a partir do caminho (vai junto no chamado, sem dados de cliente). */
const TELAS: [RegExp, string][] = [
  [/^\/exclusividades\/painel/, "Captações exclusivas › Painel"],
  [/^\/exclusividades\/[^/]+/, "Captações exclusivas › Detalhe da captação"],
  [/^\/exclusividades/, "Captações exclusivas"],
  [/^\/vendas\/nova/, "Vendas › Nova venda"],
  [/^\/vendas\/[^/]+/, "Vendas › Detalhe da venda"],
  [/^\/vendas/, "Vendas"],
  [/^\/dashboard/, "Início"],
  [/^\/desempenho/, "Desempenho"],
  [/^\/notificacoes/, "Notificações"],
  [/^\/perfil/, "Meu acesso"],
  [/^\/ajuda/, "Ajuda e sugestões"],
  [/^\/admin\/usuarios/, "Usuários"],
  [/^\/admin/, "Administração"],
  [/^\/plataforma/, "Plataforma"],
  [/^\/relatorios?/, "Relatórios"],
  [/^\/feedback/, "Feedback ao proprietário"],
  [/^\/comissoes/, "Comissões"],
];

export function nomeDaTela(pathname: string): string {
  const p = pathname || "/";
  for (const [re, nome] of TELAS) if (re.test(p)) return nome;
  return p === "/" ? "Início" : p.split("/").filter(Boolean)[0] ?? "Tela";
}

/** Caminho sem ids (uuid vira "…"), para não levar identificadores de cliente no chamado. */
export function rotaSemIds(pathname: string): string {
  return (pathname || "/")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "…")
    .slice(0, 300);
}

export type TextoAvisoSuporte = { titulo: string; mensagem: string; whatsapp: string };

/**
 * Textos dos 2 avisos (sino + WhatsApp). Curtos, sem o texto do chamado (pode ter dado pessoal):
 * - novo: para a equipe MAX;
 * - resposta: para o autor do chamado.
 */
export function textoAvisoSuporte(p: {
  evento: "novo" | "resposta";
  numero: number;
  tipo: string;
  organizacao: string;
  autor: string;
  appUrl: string;
}): TextoAvisoSuporte {
  const tipo = tipoLabel(p.tipo);
  if (p.evento === "novo") {
    const link = `${p.appUrl}/plataforma/chamados`;
    return {
      titulo: `Novo chamado #${p.numero} (${tipo})`,
      mensagem: `${p.autor} · ${p.organizacao}`,
      whatsapp: `*Novo chamado de suporte*\n\nChamado: #${p.numero} (${tipo})\nImobiliaria: ${p.organizacao}\nQuem abriu: ${p.autor}\n\nAcesse: ${link}`,
    };
  }
  const link = `${p.appUrl}/ajuda`;
  return {
    titulo: `A equipe MAX respondeu o chamado #${p.numero}`,
    mensagem: "Abra o chamado para ver a resposta.",
    whatsapp: `*Seu chamado foi respondido*\n\nChamado: #${p.numero} (${tipo})\nA equipe MAX respondeu. Abra o ADM MAX para ver a resposta.\n\nAcesse: ${link}`,
  };
}

/**
 * Avisos de WhatsApp ao corretor da locação (t_8f09d406, item 7). Parte pura (testável): monta o texto e decide
 * se o aviso pode sair. O envio em si fica em locacao-avisos.functions.ts (servidor, mesmo ZionTalk das vendas).
 */
export type EventoAvisoLocacao = "minuta_enviada" | "pendencia" | "ajuste" | "devolvida" | "andamento";

export const TITULO_AVISO_LOCACAO: Record<EventoAvisoLocacao, string> = {
  minuta_enviada: "Minuta para conferir",
  pendencia: "Pendencia na locacao",
  ajuste: "Minuta em ajuste",
  devolvida: "Locacao devolvida",
  andamento: "Andamento aguardando voce",
};

/** Máximo de avisos enviados por chamada (sem envio em massa). Igual ao limite do banco. */
export const MAX_AVISOS_POR_CHAMADA = 5;

export type AvisoReservado = {
  aviso_id: string;
  evento: EventoAvisoLocacao;
  texto: string;
  codigo: string;
  endereco: string | null;
  telefone: string | null;
  ativo: boolean;
  quer_whatsapp: boolean;
  locacao_id: string;
};

export function textoAvisoLocacao(a: AvisoReservado, link: string): string {
  const titulo = TITULO_AVISO_LOCACAO[a.evento] ?? "Atualizacao na locacao";
  const linhas = [
    `*${titulo}*`,
    "",
    `Locacao: ${a.codigo}${a.endereco ? ` - ${a.endereco}` : ""}`,
    a.texto.trim().slice(0, 500),
    "",
    `Acesse: ${link}`,
  ];
  return linhas.join("\n");
}

/** Decide antes de chamar o ZionTalk: corretor inativo, sem telefone ou com WhatsApp desligado não recebe. */
export function motivoParaNaoEnviar(
  a: Pick<AvisoReservado, "ativo" | "quer_whatsapp">,
  telefone: string | null,
): string | null {
  if (!a.ativo) return "corretor inativo";
  if (!a.quer_whatsapp) return "WhatsApp desligado nas preferencias";
  if (!telefone) return "sem telefone";
  return null;
}

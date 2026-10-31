// Mapa único de cor por sentido (item 16 da análise t_e2cc5a21, FASE 2 t_55ee647c).
// Regra: vermelho = atraso, vencida, exclusão e erro; âmbar = pendente/devolvida (pede ajuste);
// verde = concluído/valendo; azul = em andamento ou "sua vez"; laranja = vez do gestor nas
// captações (escolha anterior de Denis); violeta = só "cadastro manual"; cinza = neutro.
// Só aparência: nenhum status, cálculo ou filtro muda aqui.

export type Sentido =
  "atraso" | "perigo" | "atencao" | "ok" | "andamento" | "vez_gestor" | "manual" | "neutro";

export const SENTIDO_CLASSE: Record<Sentido, string> = {
  atraso: "bg-red-100 text-red-800",
  perigo: "bg-red-100 text-red-800",
  atencao: "bg-amber-100 text-amber-900",
  ok: "bg-emerald-100 text-emerald-800",
  andamento: "bg-sky-100 text-sky-800",
  vez_gestor: "bg-orange-100 text-orange-800",
  manual: "bg-violet-100 text-violet-800",
  neutro: "bg-slate-100 text-slate-700",
};

/** Status da captação → sentido. Mesma cor na lista, na ficha e na aba Por corretor. */
export const CAPTACAO_STATUS_SENTIDO = {
  rascunho: "neutro",
  devolvida: "atencao",
  enviada: "vez_gestor",
  em_assinatura: "andamento",
  aprovada: "ok",
} as const satisfies Record<string, Sentido>;

export const CAPTACAO_STATUS_TOM: Record<keyof typeof CAPTACAO_STATUS_SENTIDO, string> = {
  rascunho: SENTIDO_CLASSE.neutro,
  devolvida: SENTIDO_CLASSE.atencao,
  enviada: SENTIDO_CLASSE.vez_gestor,
  em_assinatura: SENTIDO_CLASSE.andamento,
  aprovada: SENTIDO_CLASSE.ok,
};

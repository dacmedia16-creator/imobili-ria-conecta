// Ajuda MAX na Locação — fatia 2/2 (t_365484dc; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
// Regras puras (sem rede) do registro de ideia / erro / dúvida sem resposta e da tela "Sugestões e erros".
// Banco: supabase/migrations/20261117120000_ajuda_max_locacao_sugestoes.sql (chamado support_tickets, origem 'locacao').
import { mascararDados } from "@/lib/ajuda-max-locacao";
import { nomeDaTela, rotaSemIds } from "@/lib/ajuda-sugestoes";

export type TipoEnvio = "sugestao" | "erro" | "duvida";
export type StatusEnvio = "recebido" | "em_analise" | "respondido" | "resolvido";
/** Status que a gestão escolhe na tela (o "respondido" só aparece se a equipe MAX responder pela central). */
export const STATUS_GESTAO: StatusEnvio[] = ["recebido", "em_analise", "resolvido"];

export const TEXTO_MIN = 5;
export const TEXTO_MAX = 2000;

export const TIPO_ENVIO_LABEL: Record<TipoEnvio, string> = {
  sugestao: "Ideia",
  erro: "Erro",
  duvida: "Dúvida sem resposta",
};

export const STATUS_ENVIO_LABEL: Record<StatusEnvio, string> = {
  recebido: "Novo",
  em_analise: "Em análise",
  respondido: "Respondido",
  resolvido: "Resolvido",
};

export const tipoEnvioLabel = (t: string) => TIPO_ENVIO_LABEL[t as TipoEnvio] ?? t;
export const statusEnvioLabel = (s: string) => STATUS_ENVIO_LABEL[s as StatusEnvio] ?? s;

/** Tela de origem gravada no envio: nome amigável e caminho sem ids (o id da locação nunca vai). */
export function origemDoEnvio(pathname: string): { telaNome: string; telaRota: string } {
  return { telaNome: nomeDaTela(pathname), telaRota: rotaSemIds(pathname) };
}

/** Origem da dúvida sem resposta: o servidor só sabe se era a lista ou o detalhe (o id da locação não vem). */
export function origemDaTela(tela: "lista" | "detalhe"): { telaNome: string; telaRota: string } {
  return tela === "detalhe"
    ? { telaNome: nomeDaTela("/locacoes/x"), telaRota: "/locacoes/…" }
    : { telaNome: nomeDaTela("/locacoes"), telaRota: "/locacoes" };
}

/**
 * Texto que vai para o banco. Ideia e erro vão como a pessoa escreveu (como no chamado do topo; o balão avisa para
 * não escrever dados de clientes). A dúvida sem resposta é a pergunta feita à IA: vai mascarada, igual foi à IA.
 */
export function textoDoEnvio(tipo: TipoEnvio, texto: string): string {
  const t = texto.trim().replace(/[ \t]+/g, " ");
  return (tipo === "duvida" ? mascararDados(t) : t).slice(0, TEXTO_MAX);
}

export function confirmacaoEnvio(
  tipo: TipoEnvio,
  p: { numero: number | null; telaNome: string; comPrint: boolean },
): string {
  const n = p.numero ? ` (#${p.numero})` : "";
  if (tipo === "sugestao")
    return `Registrei sua ideia${n} na tela **Sugestões e erros**. A gestão da imobiliária vê. Não mudei nada no sistema.`;
  if (tipo === "erro")
    return (
      `Registrei o erro${n}${p.comPrint ? " com o print" : ""}. Origem: ${p.telaNome}. Status: **Novo**. ` +
      "A gestão vê na tela **Sugestões e erros**. Não tentei adivinhar a causa."
    );
  return (
    `Registrei sua pergunta${n} em **Sugestões e erros** (dúvida sem resposta) para a equipe olhar. ` +
    "Não inventei a resposta."
  );
}

export const TEXTO_DUVIDA_NAO_REGISTRADA =
  "Não consegui registrar essa dúvida agora. Se quiser, use “Dar ideia” ou “Relatar erro” aqui no balão.";

export type EnvioLinha = {
  id: string;
  numero: number;
  tipo: TipoEnvio;
  status: StatusEnvio;
  texto: string;
  telaNome: string;
  autorNome: string;
  meu: boolean;
  temPrint: boolean;
  createdAt: string;
};

export type ListaEnvios = { gestao: boolean; itens: EnvioLinha[] };

/** Leitura fechada do retorno de ajuda_max_locacao_sugestoes. */
export function lerEnvios(raw: unknown): ListaEnvios {
  const x = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const itens = (Array.isArray(x.itens) ? x.itens : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({
      id: s(i.id),
      numero: typeof i.numero === "number" ? i.numero : 0,
      tipo: s(i.tipo) as TipoEnvio,
      status: s(i.status, "recebido") as StatusEnvio,
      texto: s(i.texto),
      telaNome: s(i.tela_nome, "Locação"),
      autorNome: s(i.autor_nome, "Usuário"),
      meu: i.meu === true,
      temPrint: i.tem_print === true,
      createdAt: s(i.created_at),
    }))
    .filter((i) => i.id);
  return { gestao: x.gestao === true, itens };
}

export type FiltroEnvio = "todos" | TipoEnvio;

export function filtrarEnvios(itens: EnvioLinha[], filtro: FiltroEnvio, soMeus: boolean) {
  return itens.filter((i) => (filtro === "todos" || i.tipo === filtro) && (!soMeus || i.meu));
}

export function resumoEnvios(itens: EnvioLinha[]) {
  return {
    total: itens.length,
    ideias: itens.filter((i) => i.tipo === "sugestao").length,
    erros: itens.filter((i) => i.tipo === "erro").length,
    novos: itens.filter((i) => i.status === "recebido").length,
  };
}

export function dataHoraBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

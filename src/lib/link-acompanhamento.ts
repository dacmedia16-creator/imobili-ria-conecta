// Link de acompanhamento do negócio (t_54c79bdc; pedido de Denis em 08/11/2026). Regras puras, sem rede.
// O banco (migration 20261108200000, acompanhamento_etapa) é a fonte da verdade; este mapa é a cópia usada pela
// tela e pelos testes, que conferem que os dois são iguais e que todo status do enum tem etapa.
import { Constants, type Database } from "@/integrations/supabase/types";

export type SaleStatus = Database["public"]["Enums"]["sale_status"];
export type Lado = "comprador" | "vendedor";
/** 1 = Preparando o contrato, 2 = Aguardando assinatura, 3 = Contrato assinado, 0 = link indisponível. */
export type Etapa = 0 | 1 | 2 | 3;

export const ETAPAS = [
  "Preparando o contrato",
  "Aguardando assinatura",
  "Contrato assinado",
] as const;

/** Record sobre o enum: status novo no types.ts sem etapa aqui = erro de compilação (e o teste falha). */
export const ETAPA_POR_STATUS: Record<SaleStatus, Etapa> = {
  rascunho: 1,
  enviada_revisao: 1,
  devolvida_ajuste: 1,
  aprovada_gestor: 1,
  enviada_juridico: 1,
  em_elaboracao_contrato: 1,
  contrato_conferencia_gestor: 1,
  contrato_conferencia_corretor: 1,
  contrato_ok_corretor: 1,
  aguardando_assinatura: 2,
  contrato_assinado: 3,
  // Ocorrências são internas: o cliente continua vendo "Contrato assinado".
  ocorrencia_pendente: 3,
  ocorrencia_analise_financeiro: 3,
  ocorrencia_devolvida_gestor: 3,
  ocorrencia_concluida: 3,
  cancelada: 0,
  arquivada: 0,
};

export const TODOS_STATUS: readonly SaleStatus[] = Constants.public.Enums.sale_status;

/** Status desconhecido = indisponível (nunca inventa etapa). */
export function etapaDoStatus(status: string): Etapa {
  return (ETAPA_POR_STATUS as Record<string, Etapa | undefined>)[status] ?? 0;
}

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const LINK_INDISPONIVEL = "Este link não está mais disponível. Fale com o seu corretor.";
export const LADO_LABEL: Record<Lado, string> = { comprador: "Comprador", vendedor: "Vendedor" };

export function linkAcompanhamentoUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/acompanhar/${token}`;
}

/** "2026-11-08" -> "08/11/2026" (sem fuso: a data já vem no horário de Brasília). */
export function dataBr(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** "João", "João e Marina", "João, Marina e Ana". */
export function juntarNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

// --- Resposta pública (acompanhamento_publico) ---------------------------------------------------------

export type AcompanhamentoPublico = {
  imobiliaria: string;
  lado: Lado;
  imovel: { linha1: string | null; linha2: string | null };
  compradores: string[];
  vendedores: string[];
  corretor: string | null;
  etapa: 1 | 2 | 3;
  datas: { preparando: string | null; aguardando: string | null; assinado: string | null };
  atualizado_em: string | null;
  google_url: string | null;
};
export type LeituraPublica = { ok: true; dados: AcompanhamentoPublico } | { ok: false };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const lista = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

/**
 * Copia SÓ os campos permitidos da resposta do banco (lista fechada, mesmo se o banco mandar algo a mais).
 * Google: só no contrato assinado e só https.
 */
export function lerRespostaPublica(raw: unknown): LeituraPublica {
  if (!raw || typeof raw !== "object") return { ok: false };
  const r = raw as Record<string, unknown>;
  const etapa = Number(r.etapa);
  if (r.ok !== true || (etapa !== 1 && etapa !== 2 && etapa !== 3)) return { ok: false };
  const lado: Lado = r.lado === "vendedor" ? "vendedor" : "comprador";
  const im = (r.imovel ?? {}) as Record<string, unknown>;
  const d = (r.datas ?? {}) as Record<string, unknown>;
  const google = str(r.google_url);
  return {
    ok: true,
    dados: {
      imobiliaria: str(r.imobiliaria) ?? "",
      lado,
      imovel: { linha1: str(im.linha1), linha2: str(im.linha2) },
      compradores: lista(r.compradores),
      vendedores: lista(r.vendedores),
      corretor: str(r.corretor),
      etapa,
      datas: {
        preparando: str(d.preparando),
        aguardando: str(d.aguardando),
        assinado: str(d.assinado),
      },
      atualizado_em: str(r.atualizado_em),
      google_url: etapa === 3 && google && /^https:\/\//.test(google) ? google : null,
    },
  };
}

// --- Bloco da venda (acompanhamento_links / _regenerar) -------------------------------------------------

export type LinkVenda = {
  lado: Lado;
  token: string;
  aberturas: number;
  ultima_abertura: string | null;
  criado_em: string | null;
};
export type LinksVenda = { disponivel: boolean; links: LinkVenda[] };

export function lerLinksVenda(raw: unknown): LinksVenda {
  const r = (raw ?? {}) as Record<string, unknown>;
  const links = Array.isArray(r.links) ? r.links : [];
  return {
    disponivel: r.disponivel === true,
    links: links
      .map((x) => x as Record<string, unknown>)
      .filter(
        (x) =>
          (x.lado === "comprador" || x.lado === "vendedor") &&
          typeof x.token === "string" &&
          LINK_TOKEN_RE.test(x.token),
      )
      .map((x) => ({
        lado: x.lado as Lado,
        token: x.token as string,
        aberturas: Math.max(0, Number(x.aberturas) || 0),
        ultima_abertura: str(x.ultima_abertura),
        criado_em: str(x.criado_em),
      }))
      .sort((a, b) => a.lado.localeCompare(b.lado)),
  };
}

/** "Ainda não abriu" / "Aberto 1 vez · última em 08/11/2026 14:05". */
export function textoAberturas(l: Pick<LinkVenda, "aberturas" | "ultima_abertura">): string {
  if (!l.aberturas) return "Ainda não abriu";
  const vezes = l.aberturas === 1 ? "1 vez" : `${l.aberturas} vezes`;
  const quando = l.ultima_abertura
    ? new Date(l.ultima_abertura).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return quando ? `Aberto ${vezes} · última em ${quando}` : `Aberto ${vezes}`;
}

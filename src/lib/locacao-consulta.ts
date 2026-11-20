// "Consultar imóvel" da Locação (t_241e03a9): leitura fechada do que a RPC locacao_consultar_imovel devolve
// (migration 20261211120000). Só código, endereço, status simplificado, etapa e nome do corretor — nada do
// locatário/proprietário/fiador, documentos ou valores (LGPD).
import { etapaLabel, type EtapaLocacao } from "@/lib/locacao";

export type StatusConsulta = "livre" | "alugado" | "pre_analise" | "documentacao" | "contrato";

export const TERMO_MINIMO = 3;
export const TERMO_MAXIMO = 100;

// "Alugado" (t_56101806): chave já entregue; "Livre" só sem processo ou com processo cancelado/desistido.
export const STATUS_CONSULTA: Record<
  StatusConsulta,
  { emoji: string; label: string; tom: "green" | "slate" | "amber" | "violet" | "red" }
> = {
  livre: { emoji: "🟢", label: "Livre (sem processo ativo)", tom: "green" },
  alugado: { emoji: "⚪", label: "Alugado", tom: "slate" },
  pre_analise: { emoji: "🟡", label: "Em pré-análise", tom: "amber" },
  documentacao: { emoji: "🟠", label: "Documentação em andamento", tom: "violet" },
  contrato: { emoji: "🔴", label: "Aprovado / contrato em andamento", tom: "red" },
};

export type ImovelConsultado = {
  imovelId: string | null;
  endereco: string | null;
  status: StatusConsulta;
  etapa: EtapaLocacao | null;
  corretor: string | null;
  processosAtivos: number;
};

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const STATUS = Object.keys(STATUS_CONSULTA) as StatusConsulta[];

/** Lê só os campos esperados; qualquer outro campo que viesse do banco é descartado. */
export function lerConsulta(raw: unknown): ImovelConsultado[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((o) => {
      const status = STATUS.includes(o.status as StatusConsulta)
        ? (o.status as StatusConsulta)
        : "livre";
      const livre = status === "livre" || status === "alugado"; // sem processo andando: sem etapa nem corretor
      return {
        imovelId: txt(o.imovel_id),
        endereco: txt(o.endereco),
        status,
        etapa: livre ? null : ((txt(o.etapa) as EtapaLocacao | null) ?? null),
        corretor: livre ? null : txt(o.corretor),
        processosAtivos: Number.isFinite(Number(o.processos_ativos))
          ? Number(o.processos_ativos)
          : 0,
      };
    });
}

/** Termo pronto para buscar (sem espaços nas pontas) ou null se curto/longo demais. */
export function termoValido(termo: string): string | null {
  const t = termo.trim();
  return t.length >= TERMO_MINIMO && t.length <= TERMO_MAXIMO ? t : null;
}

/** Linha de detalhe em linguagem simples: etapa atual (ex.: "etapa: Assinatura"). */
export function detalheEtapa(i: ImovelConsultado): string | null {
  return i.etapa ? `etapa: ${etapaLabel(i.etapa)}` : null;
}

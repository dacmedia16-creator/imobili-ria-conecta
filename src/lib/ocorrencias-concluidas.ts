import { z } from "zod";

/** Lógica pura do relatório global. A RPC valida sessão, usuário ativo e papel;
 * acesso a detalhes e escrita continua sob as RLS existentes, sem ampliação. */

/** Fonte única para menu, beforeLoad e componente. */
export const PAPEIS_OCORRENCIAS_CONCLUIDAS = [
  "corretor",
  "gestor",
  "team_leader",
  "admin",
  "super_admin",
  "financeiro",
  "juridico",
  "lancamento",
] as const;

export function podeVerOcorrenciasConcluidas(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_OCORRENCIAS_CONCLUIDAS as readonly string[]).includes(r));
}

const idSchema = z.string().min(1);

/** DATE civil; não converte para instante, não aceita timestamp nem data impossível. */
const dataCivilSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [ano, mes, dia] = value.split("-").map(Number);
    const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
    const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return ano > 0 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= dias[mes - 1];
  });

/** Resposta inválida é erro, nunca relatório vazio/comissão zero por falha de contrato. */
export const relatorioOcorrenciasConcluidasSchema = z.object({
  occs: z.array(
    z.object({
      id: idSchema,
      sale_id: idSchema,
      valor_comissao: z.number().finite().nullable(),
      data_assinatura: dataCivilSchema.nullable(),
    }),
  ),
  sales: z.array(
    z.object({
      id: idSchema,
      codigo_interno: z.string().nullable(),
      imovel_id: z.string().nullable(),
      corretor_id: idSchema.nullable(),
    }),
  ),
  participants: z.array(
    z.object({
      occurrence_id: idSchema,
      user_id: idSchema,
      nome: z.string().nullable(),
    }),
  ),
  profiles: z.array(z.object({ id: idSchema, nome: z.string().nullable() })),
  teams: z.array(
    z.object({
      id: idSchema,
      nome: z.string().nullable(),
      parent_team_id: idSchema.nullable(),
      lider_id: idSchema.nullable(),
    }),
  ),
  members: z.array(z.object({ membro_id: idSchema, team_id: idSchema })),
  coLeaders: z.array(z.object({ user_id: idSchema, team_id: idSchema })),
});

export type RelatorioOcorrenciasConcluidas = z.infer<typeof relatorioOcorrenciasConcluidasSchema>;
export type OcorrenciaConcluidaRaw = RelatorioOcorrenciasConcluidas["occs"][number];
export type VendaConcluidaRaw = RelatorioOcorrenciasConcluidas["sales"][number];
export type ParticipanteOcorrenciaRaw = RelatorioOcorrenciasConcluidas["participants"][number];
export type OpcaoRelatorio = { id: string; label: string };
export type CorretorRelatorio = OpcaoRelatorio & { equipeIds: string[] };

/** Homônimos continuam pessoas/equipes distintas; o ID completo evita colisões de prefixos. */
function opcoesPorId(nomes: Map<string, string>): OpcaoRelatorio[] {
  const contagem = new Map<string, number>();
  for (const nome of nomes.values()) contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  return [...nomes]
    .map(([id, nome]) => ({
      id,
      label: (contagem.get(nome) ?? 0) > 1 ? `${nome} (${id})` : nome,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.id.localeCompare(b.id));
}

/** Roster canônico atual. Só vínculos diretos: parent_team_id não amplia o filtro.
 * Um corretor em várias equipes tem uma opção e uma linha por ocorrência, nunca por vínculo. */
export function catalogoOcorrenciasConcluidas(relatorio: RelatorioOcorrenciasConcluidas) {
  const equipes = new Map(relatorio.teams.map((t) => [t.id, t.nome || `Equipe (${t.id})`]));
  const nomes = new Map(relatorio.profiles.map((p) => [p.id, p.nome || `Corretor (${p.id})`]));
  const vinculos = new Map<string, Set<string>>();
  const incluirPessoa = (id: string) => {
    if (!nomes.has(id)) nomes.set(id, `Corretor (${id})`);
  };
  const vincular = (id: string, equipeId: string) => {
    if (!equipes.has(equipeId)) return;
    incluirPessoa(id);
    const ids = vinculos.get(id) ?? new Set<string>();
    ids.add(equipeId);
    vinculos.set(id, ids);
  };
  for (const sale of relatorio.sales) if (sale.corretor_id) incluirPessoa(sale.corretor_id);
  for (const participante of relatorio.participants) {
    if (!nomes.has(participante.user_id)) {
      nomes.set(participante.user_id, participante.nome || `Corretor (${participante.user_id})`);
    }
  }
  for (const m of relatorio.members) vincular(m.membro_id, m.team_id);
  for (const t of relatorio.teams) if (t.lider_id) vincular(t.lider_id, t.id);
  for (const c of relatorio.coLeaders) vincular(c.user_id, c.team_id);
  return {
    equipes: opcoesPorId(equipes),
    corretores: opcoesPorId(nomes).map((p) => ({
      ...p,
      equipeIds: [...(vinculos.get(p.id) ?? [])].sort(),
    })),
  };
}

export function corretoresDaEquipe(corretores: CorretorRelatorio[], equipeId: string) {
  return equipeId === "todas"
    ? corretores
    : corretores.filter((c) => c.equipeIds.includes(equipeId));
}

export function corretorValidoNaEquipe(
  corretores: CorretorRelatorio[],
  equipeId: string,
  corretorId: string,
) {
  return corretoresDaEquipe(corretores, equipeId).some((c) => c.id === corretorId)
    ? corretorId
    : "todos";
}

export type OcorrenciaConcluidaRow = {
  ocorrenciaId: string;
  saleId: string;
  corretorId: string | null;
  participanteIds: string[];
  equipeIds: string[];
  imovelLabel: string;
  corretorNome: string | null;
  valorComissao: number;
  dataAssinatura: string | null;
};

/** Mês atual para manter a opção disponível mesmo sem registros. */
export function chaveMesAtual(data: Date = new Date()): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

export function mesesOcorrenciasConcluidas(rows: OcorrenciaConcluidaRow[], mesAtual: string) {
  const meses = new Set([
    mesAtual,
    // data_assinatura é DATE (YYYY-MM-DD), não um instante UTC.
    ...rows.flatMap((row) => (row.dataAssinatura ? [row.dataAssinatura.slice(0, 7)] : [])),
  ]);
  return [...meses]
    .sort()
    .reverse()
    .map((value) => {
      const [ano, mes] = value.split("-").map(Number);
      const label = new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      return { value, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
}

/** Uma única seleção alimenta a tabela e os dois cards, preservando a ordem recebida. */
export function resumoOcorrenciasConcluidas(
  rows: OcorrenciaConcluidaRow[],
  mes: string,
  equipeId = "todas",
  corretorId = "todos",
) {
  const filtradas = rows.filter(
    (row) =>
      (mes === "todos" || row.dataAssinatura?.slice(0, 7) === mes) &&
      (equipeId === "todas" || row.equipeIds.includes(equipeId)) &&
      (corretorId === "todos" || row.participanteIds.includes(corretorId)),
  );
  return {
    rows: filtradas,
    totalComissao: filtradas.reduce((total, row) => total + row.valorComissao, 0),
  };
}

/** Rótulo do imóvel/código, na ordem definida: codigo_interno → imovel_id → Venda #<id>. */
export function imovelOuCodigo(sale: {
  id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
}): string {
  return sale.codigo_interno || sale.imovel_id || `Venda #${sale.id.slice(0, 8)}`;
}

/** Assinaturas mais recentes primeiro; sem assinatura ao final, sem inventar data.
 * Desempate por sale_id para ordenação determinística. */
export function montarOcorrenciasConcluidas(opts: {
  occs: OcorrenciaConcluidaRaw[];
  sales: VendaConcluidaRaw[];
  nomesPorId: Record<string, string>;
  equipesPorCorretor?: ReadonlyMap<string, string[]>;
  participantesPorOcorrencia?: ReadonlyMap<string, string[]>;
}): OcorrenciaConcluidaRow[] {
  const salePorId = new Map(opts.sales.map((s) => [s.id, s]));
  const rows: OcorrenciaConcluidaRow[] = opts.occs.map((occ) => {
    const sale = salePorId.get(occ.sale_id);
    const corretorId = sale?.corretor_id ?? null;
    return {
      ocorrenciaId: occ.id,
      saleId: occ.sale_id,
      corretorId,
      participanteIds: [
        ...new Set([
          ...(corretorId ? [corretorId] : []),
          ...(opts.participantesPorOcorrencia?.get(occ.id) ?? []),
        ]),
      ],
      equipeIds: [],
      imovelLabel: sale ? imovelOuCodigo(sale) : `Venda #${occ.sale_id.slice(0, 8)}`,
      corretorNome: sale?.corretor_id ? (opts.nomesPorId[sale.corretor_id] ?? null) : null,
      valorComissao: Number(occ.valor_comissao ?? 0),
      dataAssinatura: occ.data_assinatura || null,
    };
  });
  for (const row of rows) {
    row.equipeIds = [
      ...new Set(row.participanteIds.flatMap((id) => opts.equipesPorCorretor?.get(id) ?? [])),
    ];
  }
  rows.sort(
    (a, b) =>
      (b.dataAssinatura ?? "").localeCompare(a.dataAssinatura ?? "") ||
      b.saleId.localeCompare(a.saleId),
  );
  return rows;
}

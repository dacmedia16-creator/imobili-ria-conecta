/**
 * Fórmulas puras do "Produção Gerada por Pessoa". Nenhuma função aqui lê ou escreve no banco — só
 * transforma os dados que a página já carregou, pra poder ser testado sem Supabase.
 *
 * Regra de divisão (validada por simulação em chat com dados reais antes de virar código):
 * - Venda padrão = 1 venda completa, dividida em 2 pontas iguais: captação (0,5) + venda (0,5), cada
 *   uma com metade do VGV e metade da comissão bruta da operação.
 * - Venda de Lançamento = 1 venda inteira só na ponta "venda" (100% do VGV e da comissão) — essa
 *   modalidade não tem captação (sales.corretor_captador_id/corretor_vendedor_id sempre nulos nela).
 * A soma das pontas de uma operação sempre fecha em 1 venda / 100% do VGV / 100% da comissão —
 * nunca duplica nem perde valor.
 */
import type {
  FiltrosProducao,
  ProducaoPonta,
  ProducaoRawRow,
  ResumoPessoa,
  TotaisProducao,
} from "@/lib/producao-por-pessoa-types";

const round2 = (v: number) => Math.round(v * 100) / 100;

const CHAVE_SEM_VINCULO = "sem-vinculo";

function equipeDe(
  pessoaId: string | null,
  teamIdByPessoa: Map<string, string>,
  teamNomeById: Map<string, string>,
): { teamId: string | null; teamNome: string | null } {
  if (!pessoaId) return { teamId: null, teamNome: null };
  const teamId = teamIdByPessoa.get(pessoaId) ?? null;
  return { teamId, teamNome: teamId ? (teamNomeById.get(teamId) ?? null) : null };
}

/** Transforma cada venda bruta da RPC nas suas pontas (captação/venda). `teamIdByPessoa` e
 * `teamNomeById` resolvem a equipe de cada pessoa — mesmo padrão de resolução usado no
 * Comparativo 6% (membro de team_members OU líder/líder-auxiliar da própria equipe). */
export function gerarPontas(
  rows: ProducaoRawRow[],
  teamIdByPessoa: Map<string, string>,
  teamNomeById: Map<string, string>,
): ProducaoPonta[] {
  const pontas: ProducaoPonta[] = [];

  for (const r of rows) {
    const valorNegociado = Number(r.valor_negociado ?? 0);
    const comissaoBruta = Number(r.comissao_bruta ?? 0);
    const base = {
      saleId: r.sale_id,
      imovelId: r.imovel_id,
      codigoInterno: r.codigo_interno,
      modalidade: r.modalidade,
      concluidaEm: r.concluida_em,
    };

    if (r.modalidade === "lancamento") {
      const { teamId, teamNome } = equipeDe(r.vendedor_id, teamIdByPessoa, teamNomeById);
      pontas.push({
        ...base,
        tipo: "venda",
        pessoaId: r.vendedor_id,
        pessoaNome: r.vendedor_nome ?? "Não vinculado",
        teamId,
        teamNome,
        qtd: 1,
        vgv: round2(valorNegociado),
        comissao: round2(comissaoBruta),
      });
      continue;
    }

    const captacao = equipeDe(r.captador_id, teamIdByPessoa, teamNomeById);
    pontas.push({
      ...base,
      tipo: "captacao",
      pessoaId: r.captador_id,
      pessoaNome: r.captador_nome ?? "Não vinculado",
      teamId: captacao.teamId,
      teamNome: captacao.teamNome,
      qtd: 0.5,
      vgv: round2(valorNegociado * 0.5),
      comissao: round2(comissaoBruta * 0.5),
    });

    const venda = equipeDe(r.vendedor_id, teamIdByPessoa, teamNomeById);
    pontas.push({
      ...base,
      tipo: "venda",
      pessoaId: r.vendedor_id,
      pessoaNome: r.vendedor_nome ?? "Não vinculado",
      teamId: venda.teamId,
      teamNome: venda.teamNome,
      qtd: 0.5,
      vgv: round2(valorNegociado * 0.5),
      comissao: round2(comissaoBruta * 0.5),
    });
  }

  return pontas;
}

/** Agrupa as pontas por pessoa. Pessoa não vinculada (pessoaId null) agrupa por nome, sob a chave
 * "sem-vinculo:<nome>" — nunca some do relatório, só fica fora do filtro por pessoa (que trabalha
 * por id). */
export function agruparPorPessoa(pontas: ProducaoPonta[]): ResumoPessoa[] {
  const porPessoa = new Map<string, ResumoPessoa>();

  for (const p of pontas) {
    const chave = p.pessoaId ?? `${CHAVE_SEM_VINCULO}:${p.pessoaNome}`;
    let r = porPessoa.get(chave);
    if (!r) {
      r = {
        chave,
        pessoaId: p.pessoaId,
        pessoaNome: p.pessoaNome,
        teamId: p.teamId,
        teamNome: p.teamNome,
        qtdVendas: 0,
        vgv: 0,
        comissao: 0,
        qtdCaptacao: 0,
        qtdVenda: 0,
      };
      porPessoa.set(chave, r);
    }
    r.qtdVendas = round2(r.qtdVendas + p.qtd);
    r.vgv = round2(r.vgv + p.vgv);
    r.comissao = round2(r.comissao + p.comissao);
    if (p.tipo === "captacao") r.qtdCaptacao = round2(r.qtdCaptacao + p.qtd);
    else r.qtdVenda = round2(r.qtdVenda + p.qtd);
  }

  return Array.from(porPessoa.values()).sort((a, b) => b.comissao - a.comissao);
}

/** Totais gerais sem duplicidade — soma direta das pontas já filtradas. Como cada operação sempre
 * contribui exatamente 1 venda / 100% do VGV / 100% da comissão entre as suas pontas, o total aqui
 * nunca passa do que as operações do período realmente somam. */
export function totaisProducao(pontas: ProducaoPonta[]): TotaisProducao {
  return pontas.reduce(
    (acc, p) => {
      acc.qtdVendas = round2(acc.qtdVendas + p.qtd);
      acc.vgv = round2(acc.vgv + p.vgv);
      acc.comissao = round2(acc.comissao + p.comissao);
      if (p.tipo === "captacao") acc.qtdCaptacao = round2(acc.qtdCaptacao + p.qtd);
      else acc.qtdVenda = round2(acc.qtdVenda + p.qtd);
      return acc;
    },
    { qtdVendas: 0, vgv: 0, comissao: 0, qtdCaptacao: 0, qtdVenda: 0 } as TotaisProducao,
  );
}

export function aplicarFiltrosProducao(
  pontas: ProducaoPonta[],
  filtros: FiltrosProducao,
): ProducaoPonta[] {
  return pontas.filter((p) => {
    const dataConclusao = p.concluidaEm.slice(0, 10);
    if (filtros.dataDe && dataConclusao < filtros.dataDe) return false;
    if (filtros.dataAte && dataConclusao > filtros.dataAte) return false;
    if (filtros.pessoaId && p.pessoaId !== filtros.pessoaId) return false;
    if (filtros.teamId && p.teamId !== filtros.teamId) return false;
    if (filtros.tipo !== "todas" && p.tipo !== filtros.tipo) return false;
    return true;
  });
}

/** Únicos três papéis com acesso ao relatório — mesma regra usada no menu (AppShell), na rota
 * (beforeLoad) e na RPC (producao_por_pessoa_dados, checada no banco independente da RLS). */
const PAPEIS_COM_ACESSO = new Set(["admin", "super_admin", "financeiro"]);
export function podeAcessarProducaoPorPessoa(roles: string[]): boolean {
  return roles.some((r) => PAPEIS_COM_ACESSO.has(r));
}

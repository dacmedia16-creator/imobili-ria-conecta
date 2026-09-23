/**
 * Fórmulas puras do "Produção Gerada por Pessoa". Nenhuma função aqui lê ou escreve no banco — só
 * transforma os dados que a página já carregou, pra poder ser testado sem Supabase.
 *
 * Regra de divisão (validada por simulação em chat com dados reais antes de virar código):
 * - Venda padrão = 1 venda completa, dividida em 2 pontas iguais: captação (0,5) + venda (0,5), cada
 *   uma com metade do VGV e metade da comissão bruta da operação.
 * - Venda de Lançamento = 1 venda inteira distribuída entre os vendedores proporcionalmente à
 *   comissão de cada um. Com um vendedor, ele recebe 100%; com dois em partes iguais, 50% cada.
 * A soma das pontas de uma operação sempre fecha em 1 venda / 100% do VGV / 100% da comissão —
 * nunca duplica nem perde valor.
 */
import type {
  FiltrosProducao,
  ProducaoPonta,
  ProducaoRawRow,
  ProducaoVendedorParticipacao,
  ResumoPessoa,
  TotaisProducao,
} from "@/lib/producao-por-pessoa-types";
import { metricasSemParceria } from "@/lib/metricas-sem-parceria";

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

/** Normaliza a ponta de venda sem deixar o join 1:N transformar uma operação em várias vendas.
 * Aceita o contrato novo (uma linha com `vendedor_participacoes`) e o contrato legado (uma linha
 * por vendedor), para a troca do banco e do frontend continuar reversível durante a publicação. */
function participacoesDe(rows: ProducaoRawRow[]): ProducaoVendedorParticipacao[] {
  const primeira = rows[0];
  const candidatas = rows.flatMap((row) => {
    if (row.vendedor_participacoes && row.vendedor_participacoes.length > 0) {
      return row.vendedor_participacoes;
    }
    return [
      {
        user_id: row.vendedor_id,
        nome: row.vendedor_nome,
        fracao: row.vendedor_fracao,
      },
    ];
  });

  const porPessoa = new Map<
    string,
    { user_id: string | null; nome: string | null; fracao: number | null }
  >();
  for (const candidata of candidatas) {
    const chave = candidata.user_id ?? `sem-id:${candidata.nome ?? ""}`;
    const existente = porPessoa.get(chave);
    if (!existente) {
      porPessoa.set(chave, { ...candidata });
      continue;
    }
    const fracaoAtual = Number(existente.fracao ?? 0);
    const fracaoNova = Number(candidata.fracao ?? 0);
    existente.fracao = fracaoAtual + fracaoNova > 0 ? fracaoAtual + fracaoNova : null;
    existente.nome ||= candidata.nome;
  }

  const semDuplicidade = Array.from(porPessoa.values());
  if (semDuplicidade.length === 0) {
    return [
      {
        user_id: primeira.vendedor_id,
        nome: primeira.vendedor_nome,
        fracao: primeira.vendedor_fracao,
      },
    ];
  }

  const somaInformada = semDuplicidade.reduce((sum, p) => sum + Math.max(0, Number(p.fracao ?? 0)), 0);
  const divisor = somaInformada > 0 ? somaInformada : semDuplicidade.length;
  return semDuplicidade.map((p) => ({
    ...p,
    fracao:
      somaInformada > 0
        ? Math.max(0, Number(p.fracao ?? 0)) / divisor
        : 1 / semDuplicidade.length,
  }));
}

/** Rateia dinheiro em centavos e entrega o resíduo de arredondamento à última participação, para
 * que a soma exibida feche exatamente com a operação. Quantidades permanecem fracionárias. */
function ratearValores(
  vendedores: ProducaoVendedorParticipacao[],
  vgvTotal: number,
  comissaoTotal: number,
): Array<{ vgv: number; comissao: number }> {
  let vgvUsado = 0;
  let comissaoUsada = 0;
  return vendedores.map((vendedor, index) => {
    const ultimo = index === vendedores.length - 1;
    const fracao = Math.max(0, Math.min(1, Number(vendedor.fracao ?? 0)));
    const vgv = ultimo ? round2(vgvTotal - vgvUsado) : round2(vgvTotal * fracao);
    const comissao = ultimo
      ? round2(comissaoTotal - comissaoUsada)
      : round2(comissaoTotal * fracao);
    vgvUsado = round2(vgvUsado + vgv);
    comissaoUsada = round2(comissaoUsada + comissao);
    return { vgv, comissao };
  });
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

  const porVenda = new Map<string, ProducaoRawRow[]>();
  for (const row of rows) {
    const atuais = porVenda.get(row.sale_id) ?? [];
    atuais.push(row);
    porVenda.set(row.sale_id, atuais);
  }

  for (const vendaRows of porVenda.values()) {
    const r = vendaRows[0];
    const proprias = metricasSemParceria({
      vgv: r.valor_negociado,
      comissaoBruta: r.comissao_bruta,
      parceriaExterna: r.parceria_externa,
    });
    const valorNegociado = proprias.vgvProprio;
    const comissaoBruta = proprias.comissaoPropria;
    const base = {
      saleId: r.sale_id,
      imovelId: r.imovel_id,
      codigoInterno: r.codigo_interno,
      modalidade: r.modalidade,
      concluidaEm: r.concluida_em,
    };

    const vendedores = participacoesDe(vendaRows);

    if (r.modalidade === "lancamento") {
      const valoresRateados = ratearValores(vendedores, valorNegociado, comissaoBruta);
      for (const [index, vendedor] of vendedores.entries()) {
        const { teamId, teamNome } = equipeDe(vendedor.user_id, teamIdByPessoa, teamNomeById);
        const fracao = Math.max(0, Math.min(1, Number(vendedor.fracao ?? 0)));
        pontas.push({
          ...base,
          tipo: "venda",
          pessoaId: vendedor.user_id,
          pessoaNome: vendedor.nome ?? "Não vinculado",
          teamId,
          teamNome,
          qtd: fracao,
          vgv: valoresRateados[index].vgv,
          comissao: valoresRateados[index].comissao,
        });
      }
      continue;
    }

    const ladosInternos = Number(!r.parceria_externa_captacao) + Number(!r.parceria_externa_venda);
    const divisorMetricas = Math.max(ladosInternos, 1);

    // Uma parceria externa substitui deliberadamente a pessoa interna daquele lado. Ela não é
    // "sem vínculo" e não pode gerar uma ponta fictícia no relatório. As métricas próprias da
    // unidade (já sem a parceria) ficam distribuídas somente entre os lados internos restantes.
    if (!r.parceria_externa_captacao) {
      const captacao = equipeDe(r.captador_id, teamIdByPessoa, teamNomeById);
      pontas.push({
        ...base,
        tipo: "captacao",
        pessoaId: r.captador_id,
        pessoaNome: r.captador_nome ?? "Não vinculado",
        teamId: captacao.teamId,
        teamNome: captacao.teamNome,
        qtd: 0.5,
        vgv: round2(valorNegociado / divisorMetricas),
        comissao: round2(comissaoBruta / divisorMetricas),
      });
    }

    if (!r.parceria_externa_venda) {
      const valoresRateados = ratearValores(
        vendedores,
        valorNegociado / divisorMetricas,
        comissaoBruta / divisorMetricas,
      );
      for (const [index, vendedor] of vendedores.entries()) {
        const venda = equipeDe(vendedor.user_id, teamIdByPessoa, teamNomeById);
        const fracao = Math.max(0, Math.min(1, Number(vendedor.fracao ?? 0)));
        pontas.push({
          ...base,
          tipo: "venda",
          pessoaId: vendedor.user_id,
          pessoaNome: vendedor.nome ?? "Não vinculado",
          teamId: venda.teamId,
          teamNome: venda.teamNome,
          qtd: fracao * 0.5,
          vgv: valoresRateados[index].vgv,
          comissao: valoresRateados[index].comissao,
        });
      }
    }
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
    r.qtdVendas += p.qtd;
    r.vgv = round2(r.vgv + p.vgv);
    r.comissao = round2(r.comissao + p.comissao);
    if (p.tipo === "captacao") r.qtdCaptacao += p.qtd;
    else r.qtdVenda += p.qtd;
  }

  return Array.from(porPessoa.values()).sort((a, b) => b.comissao - a.comissao);
}

/** Conta operações distintas no recorte já filtrado. Uma operação pode gerar mais de uma ponta,
 * mas deve aparecer apenas uma vez na contagem do cabeçalho detalhado. */
export function contarOperacoes(pontas: ProducaoPonta[]): number {
  return new Set(pontas.map((p) => p.saleId)).size;
}

export function formatarTotalPessoas(total: number): string {
  return `${total} ${total === 1 ? "pessoa" : "pessoas"}`;
}

export function formatarTotalOperacoes(total: number): string {
  return `${total} ${total === 1 ? "operação" : "operações"}`;
}

/** Totais gerais sem duplicidade — soma direta das pontas já filtradas. Como cada operação sempre
 * contribui exatamente 1 venda / 100% do VGV / 100% da comissão entre as suas pontas, o total aqui
 * nunca passa do que as operações do período realmente somam. */
export function totaisProducao(pontas: ProducaoPonta[]): TotaisProducao {
  return pontas.reduce(
    (acc, p) => {
      acc.qtdVendas += p.qtd;
      acc.vgv = round2(acc.vgv + p.vgv);
      acc.comissao = round2(acc.comissao + p.comissao);
      if (p.tipo === "captacao") acc.qtdCaptacao += p.qtd;
      else acc.qtdVenda += p.qtd;
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
    if (filtros.modalidade !== "todas" && p.modalidade !== filtros.modalidade) return false;
    if (filtros.tipo !== "todas" && p.tipo !== filtros.tipo) return false;
    return true;
  });
}

/** Papéis com acesso ao relatório — mesma regra usada no menu (AppShell), na rota
 * (beforeLoad) e na RPC (producao_por_pessoa_dados, checada no banco independente da RLS). */
const PAPEIS_COM_ACESSO = new Set(["admin", "super_admin", "financeiro", "gestor", "team_leader"]);
export function podeAcessarProducaoPorPessoa(roles: string[]): boolean {
  return roles.some((r) => PAPEIS_COM_ACESSO.has(r));
}

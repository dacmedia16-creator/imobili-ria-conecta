/**
 * Lógica pura do seletor de beneficiário da "Divisão da comissão" no formulário de Lançamento
 * (LancamentoDetail.tsx) — extraída pra ser testável sem montar o componente. O projeto não tem
 * hoje ambiente de teste de componente React (vitest.config.ts roda com `environment: "node"`,
 * sem jsdom/@testing-library/react), então a parte de UI em si (o <Select>, onValueChange ligado a
 * estado local) fica só validada por leitura de código + typecheck/build — não por teste
 * automatizado. Esta função é o que dá pra extrair e cobrir de verdade.
 *
 * Fora do escopo da Central Financeira (Fase 1) — é uma correção num formulário pré-existente
 * (Lançamento), feita a pedido, não faz parte de /financeiro.
 */

export type PessoaAtiva = { id: string; nome: string };

/** Sentinela usado no <Select> pra "sem cadastro / parceiro externo, digitar nome" — exportado pra
 * o componente e os testes nunca divergirem sobre qual string especial representa esse caso. */
export const SEM_CADASTRO_VALUE = "__livre__";

/** Combina as 3 listas de pessoas ativas (corretor/gestor/team_leader) numa só, sem duplicar por
 * id — uma pessoa de Lançamento pode atuar em qualquer um dos 3 papéis (ex.: gestor listado como
 * "corretor vendedor" na venda), diferente do fluxo padrão, que usa cada lista separada pro campo
 * equivalente. Em empate de id entre listas, mantém a primeira ocorrência (ordem: corretores,
 * gestores, team leaders). */
export function mesclarPessoasAtivas(
  corretores: PessoaAtiva[],
  gestores: PessoaAtiva[],
  teamLeaders: PessoaAtiva[],
): PessoaAtiva[] {
  const porId = new Map<string, PessoaAtiva>();
  for (const p of [...corretores, ...gestores, ...teamLeaders]) {
    if (!porId.has(p.id)) porId.set(p.id, p);
  }
  return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

/** O que muda no formulário quando o usuário escolhe uma opção no seletor de beneficiário —
 * `SEM_CADASTRO_VALUE` limpa o vínculo e preserva o nome já digitado (pra continuar editável como
 * texto livre); qualquer outro valor busca a pessoa correspondente e passa a travar o nome nela.
 * Chaves em snake_case (`user_id`) de propósito — é o patch aplicado direto na linha do formulário
 * (commRows), que espelha as colunas de `sale_commission_extras`, não um objeto de UI à parte. */
export function resolverSelecaoBeneficiario(
  valorSelecionado: string,
  pessoasAtivas: PessoaAtiva[],
  nomeAtual: string | null,
): { user_id: string | null; nome: string | null } {
  if (valorSelecionado === SEM_CADASTRO_VALUE) return { user_id: null, nome: nomeAtual };
  const pessoa = pessoasAtivas.find((p) => p.id === valorSelecionado);
  return { user_id: valorSelecionado, nome: pessoa ? pessoa.nome : nomeAtual };
}

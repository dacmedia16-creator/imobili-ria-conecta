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
 * `SEM_CADASTRO_VALUE` limpa o vínculo, preserva o nome já digitado (pra continuar editável como
 * texto livre) e marca `sem_cadastro_confirmado: true` — é essa marca, não a ausência de user_id
 * sozinha, que registra "alguém escolheu deliberadamente dizer que esta pessoa não tem cadastro",
 * em vez de simplesmente nunca ter passado por essa escolha (ver constraint
 * *_exige_vinculo_ou_confirmacao). Qualquer outro valor busca a pessoa correspondente, trava o nome
 * nela e limpa a confirmação (linha passa a ter dono de novo). Chaves em snake_case de propósito —
 * é o patch aplicado direto na linha do formulário, que espelha as colunas de
 * sale_commission_extras/occurrence_commissions, não um objeto de UI à parte. */
export function resolverSelecaoBeneficiario(
  valorSelecionado: string,
  pessoasAtivas: PessoaAtiva[],
  nomeAtual: string | null,
): { user_id: string | null; nome: string | null; sem_cadastro_confirmado: boolean } {
  if (valorSelecionado === SEM_CADASTRO_VALUE) {
    return { user_id: null, nome: nomeAtual, sem_cadastro_confirmado: true };
  }
  const pessoa = pessoasAtivas.find((p) => p.id === valorSelecionado);
  return {
    user_id: valorSelecionado,
    nome: pessoa ? pessoa.nome : nomeAtual,
    sem_cadastro_confirmado: false,
  };
}

type LinhaComissao = { user_id?: string | null; sem_cadastro_confirmado?: boolean };

/** Uma linha "precisa de escolha" quando ninguém nunca interagiu com o Select de Nome — sem
 * user_id E sem a marca explícita de "Sem cadastro" confirmada. É exatamente o estado em que
 * addComm() cria uma linha nova. Usado tanto pro valor do <Select> (undefined nesse caso, pra
 * mostrar o placeholder em vez de já aparecer como "Sem cadastro" escolhido) quanto pra bloquear
 * o save com uma mensagem humana antes de a linha bater na constraint do banco
 * (sale_commission_extras_exige_vinculo_ou_confirmacao). */
export function precisaEscolherBeneficiario(linha: LinhaComissao): boolean {
  return !linha.user_id && !linha.sem_cadastro_confirmado;
}

/** Valor a passar pro <Select> de Nome — undefined (mostra o placeholder) quando a linha ainda não
 * teve uma escolha explícita, nunca SEM_CADASTRO_VALUE por padrão. */
export function valorSelectBeneficiario(linha: LinhaComissao): string | undefined {
  if (linha.user_id) return linha.user_id;
  if (linha.sem_cadastro_confirmado) return SEM_CADASTRO_VALUE;
  return undefined;
}

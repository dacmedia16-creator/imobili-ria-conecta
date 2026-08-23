/**
 * Tipos do relatório "Produção Gerada por Pessoa" (/producao-por-pessoa). Mede quanto cada pessoa
 * gerou pra operação (VGV + comissão BRUTA da venda, dividida em pontas de captação/venda) — nunca
 * o valor líquido individual pago a corretor/gestor. Página somente leitura: nenhum tipo aqui é
 * persistido de volta no banco.
 */

export type ModalidadeVenda = "padrao" | "lancamento";

/** Linha bruta por venda, como devolvida pela RPC producao_por_pessoa_dados() — uma linha por
 * operação concluída, ainda não dividida em pontas. */
export type ProducaoRawRow = {
  sale_id: string;
  imovel_id: string | null;
  codigo_interno: string | null;
  modalidade: ModalidadeVenda;
  concluida_em: string; // timestamptz
  valor_negociado: number;
  comissao_bruta: number;
  captador_id: string | null;
  captador_nome: string | null;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  /** Fração da produção atribuída ao vendedor em Lançamento. Ex.: 0,5 para dois vendedores
   * com a mesma participação. Em vendas padrão é null porque a divisão é por ponta. */
  vendedor_fracao: number | null;
};

export type TipoParticipacao = "captacao" | "venda";

/** Uma "ponta" de uma venda — o que o relatório efetivamente lista/soma. Uma venda padrão vira 2
 * pontas (0,5 + 0,5); uma venda de Lançamento vira 1 ponta única (1,0), sempre "venda". */
export type ProducaoPonta = {
  saleId: string;
  imovelId: string | null;
  codigoInterno: string | null;
  modalidade: ModalidadeVenda;
  concluidaEm: string;
  tipo: TipoParticipacao;
  /** null = pessoa não vinculada a uma conta (dado incompleto/legado) — aparece como "Não vinculado". */
  pessoaId: string | null;
  pessoaNome: string;
  teamId: string | null;
  teamNome: string | null;
  /** 0,5 (ponta padrão) ou a fração proporcional do vendedor em um Lançamento. */
  qtd: number;
  vgv: number;
  comissao: number;
};

export type FiltrosProducao = {
  dataDe: string; // YYYY-MM-DD, contra a data de conclusão da ocorrência
  dataAte: string; // YYYY-MM-DD
  pessoaId: string | null; // null = todas
  teamId: string | null; // null = todas
  tipo: "todas" | TipoParticipacao;
};

/** Resumo consolidado por pessoa — soma de todas as pontas dela no período/filtro selecionado. */
export type ResumoPessoa = {
  /** pessoaId quando vinculada, senão uma chave estável derivada do nome ("Não vinculado"). */
  chave: string;
  pessoaId: string | null;
  pessoaNome: string;
  teamId: string | null;
  teamNome: string | null;
  qtdVendas: number;
  vgv: number;
  comissao: number;
  qtdCaptacao: number;
  qtdVenda: number;
};

export type TotaisProducao = {
  qtdVendas: number;
  vgv: number;
  comissao: number;
  qtdCaptacao: number;
  qtdVenda: number;
};

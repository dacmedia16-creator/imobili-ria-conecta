import { supabase } from "@/integrations/supabase/client";

export type ComissaoBeneficiarioResumo = {
  /** user_id -> soma de occurrence_commissions.valor. Só linhas com user_id preenchido entram aqui
   * — nunca confundir com quem CADASTROU a venda (sales.corretor_id), que é o bug que este módulo
   * substitui (ver auditoria "comissão por corretor"). É a fonte do ranking — parceiro externo
   * confirmado (Wilson Grecchi) e vínculo quebrado (Aline antes da correção) nunca entram aqui,
   * mesmo os dois tendo user_id nulo — ver `parceriaExterna` e `semVinculo`. */
  porBeneficiario: Record<string, number>;
  /** Linhas sem user_id E sem `sem_cadastro_confirmado` — nome digitado sem selecionar da lista,
   * ninguém nunca confirmou que a pessoa realmente não tem cadastro. É um vínculo esquecido/quebrado
   * (foi o caso da Aline: existe profiles.nome parecido, só não foi selecionado) — sinalizado como
   * pendência a corrigir, não como parceiro externo legítimo. */
  semVinculo: { quantidade: number; valor: number };
  /** Linhas sem user_id, mas com `sem_cadastro_confirmado = true` — alguém escolheu deliberadamente
   * "Sem cadastro / parceiro externo" no seletor (ex.: Wilson Grecchi, corretor parceiro sem conta no
   * sistema). Não é erro e não deve ser corrigido/vinculado por semelhança de nome — o dinheiro é
   * contado aqui, permanece fora do ranking por pessoa (que só existe pra perfis internos) e fora dos
   * totais por corretor, mas nunca desaparece do resumo. */
  parceriaExterna: { quantidade: number; valor: number };
};

function resumoVazio(): ComissaoBeneficiarioResumo {
  return {
    porBeneficiario: {},
    semVinculo: { quantidade: 0, valor: 0 },
    parceriaExterna: { quantidade: 0, valor: 0 },
  };
}

/**
 * Pura — agrega linhas de occurrence_commissions (user_id + valor + sem_cadastro_confirmado) por
 * beneficiário. Separada do fetch pra ser testável sem rede. A classificação de uma linha sem
 * user_id NUNCA é decidida pelo nome ou pelo papel — só pelo indicador explícito
 * `sem_cadastro_confirmado`, gravado quando alguém escolhe "Sem cadastro" no formulário. Isso é o
 * que distingue um parceiro externo legítimo (Wilson Grecchi) de um vínculo interno esquecido
 * (Aline, que tem cadastro e só não foi selecionada) — sem essa marca, os dois pareceriam iguais.
 */
export function agruparComissaoPorBeneficiario(
  linhas: {
    user_id: string | null;
    valor: number | string | null;
    sem_cadastro_confirmado?: boolean | null;
  }[],
): ComissaoBeneficiarioResumo {
  const resumo = resumoVazio();
  for (const linha of linhas) {
    const valor = Number(linha.valor ?? 0);
    if (linha.user_id) {
      resumo.porBeneficiario[linha.user_id] = (resumo.porBeneficiario[linha.user_id] ?? 0) + valor;
    } else if (linha.sem_cadastro_confirmado) {
      resumo.parceriaExterna.quantidade += 1;
      resumo.parceriaExterna.valor += valor;
    } else {
      resumo.semVinculo.quantidade += 1;
      resumo.semVinculo.valor += valor;
    }
  }
  return resumo;
}

/**
 * Pura — soma, por ocorrência, a parte de occurrence_commissions confirmada como parceiro externo
 * (`sem_cadastro_confirmado = true`). Usada por quem calcula "quanto da comissão de uma ocorrência
 * é realmente da imobiliária" (ex.: `fatorComissaoPropria` em status.ts, já usado em Relatórios/
 * Comissões a Receber/Central Financeira pra descontar `occurrence_partners`) — essa é a MESMA regra
 * de negócio, só que pro caso de um beneficiário INDIVIDUAL sem cadastro (ex.: Wilson Grecchi),
 * diferente de `occurrence_partners`/`sales.parceria_*`, que é uma parceria da ocorrência inteira com
 * outra imobiliária/unidade. As duas fontes se somam — nenhuma substitui a outra.
 */
export function agruparParceriaExternaPorOcorrencia(
  linhas: {
    occurrence_id: string;
    valor: number | string | null;
    sem_cadastro_confirmado?: boolean | null;
  }[],
): Record<string, number> {
  const porOcorrencia: Record<string, number> = {};
  for (const linha of linhas) {
    if (!linha.sem_cadastro_confirmado) continue;
    const valor = Number(linha.valor ?? 0);
    porOcorrencia[linha.occurrence_id] = (porOcorrencia[linha.occurrence_id] ?? 0) + valor;
  }
  return porOcorrencia;
}

/**
 * Busca as parcelas de occurrence_commissions das vendas informadas e agrega por beneficiário. O
 * chamador já filtra `saleIds` pela regra de sempre (ex.: excluir cancelada/arquivada) — esta função
 * não repete filtro de status, só busca e agrega. Dois passos (occurrences -> occurrence_commissions)
 * em vez de um filtro em tabela embutida via PostgREST, pra não depender de sintaxe de filtro
 * aninhado — mesmo princípio de simplicidade já usado em dashboard-perfil-query.ts (Etapa 2C).
 */
export async function fetchComissaoPorBeneficiario(
  saleIds: string[],
): Promise<ComissaoBeneficiarioResumo> {
  if (saleIds.length === 0) return resumoVazio();
  const { data: occs, error: occErr } = await supabase
    .from("occurrences")
    .select("id")
    .in("sale_id", saleIds);
  if (occErr) throw occErr;
  const occIds = (occs ?? []).map((o) => o.id);
  if (occIds.length === 0) return resumoVazio();
  const { data: rows, error } = await supabase
    .from("occurrence_commissions")
    .select("user_id, valor, sem_cadastro_confirmado")
    .in("occurrence_id", occIds);
  if (error) throw error;
  return agruparComissaoPorBeneficiario(rows ?? []);
}

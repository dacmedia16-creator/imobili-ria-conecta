-- Comissão editada na venda durante "análise do Financeiro" passa a atualizar a ocorrência (t_59cb12e0,
-- aprovado por Denis em 04/11/2026; diagnóstico t_d6b8a37b).
--
-- Antes: sincronizar_ocorrencia_antes_financeiro() só copia o cabeçalho da venda para a ocorrência até
-- 'ocorrencia_devolvida_gestor'. Em 'ocorrencia_analise_financeiro' sai sem fazer nada; o Financeiro/Admin
-- pode mudar % e valor da comissão na venda (enforce_sale_comissao_lock deixa), mas a ocorrência (que a
-- Revisão e o relatório leem) fica com o valor antigo, e sync_occurrence_commissions calcula o % de cada
-- pessoa sobre esse valor antigo (ex.: captador 60% em vez de 30%).
--
-- Agora o gatilho da venda (trg_sales_sync_antes_financeiro -> trg_sincronizar_financeiro_ocorrencia_da_venda)
-- também chama sincronizar_comissao_ocorrencia_em_analise() quando, em 'ocorrencia_analise_financeiro',
-- o % ou o valor da comissão DA VENDA mudou nesta gravação. Ela copia só percentual_comissao e
-- valor_comissao para a ocorrência, e só se a ocorrência estiver 'pendente' e aceita_financeiro = false;
-- depois recalcula as linhas por papel (sync_occurrence_commissions lê o valor novo).
--   * Só reage a mudança do VALOR (R$) da comissão: editar previsão/parceria ou só o % de referência
--     na venda nessa etapa não sobrescreve a correção que o Financeiro fez direto na ocorrência.
--   * Regra explícita (t_a10304e6): se o Financeiro corrigiu a ocorrência e DEPOIS alguém (só
--     Financeiro/Admin podem, nessa etapa) grava um NOVO valor de comissão na venda, vale a gravação
--     mais recente: a ocorrência passa a ter o valor novo da venda. O aviso de divergência mostra os
--     dois valores antes disso.
--   * Linhas manuais do Financeiro: o R$ fica igual; só o % é recalculado sobre o total novo.
--   * Depois do aceite do Financeiro ou da conclusão: continua congelado, como hoje.
--   * sincronizar_ocorrencia_antes_financeiro() não muda (etapas anteriores seguem iguais).
--   * Não altera nenhum dado existente: só vale para gravações futuras.
-- Rollback: docs/sql/rollback/20261104160000_comissao_analise_financeiro_sync.rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_valor numeric;
  v_occ_id uuid;
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id;

  if not found
     or v_sale.modalidade = 'lancamento'
     or v_sale.status::text <> 'ocorrencia_analise_financeiro' then
    return;
  end if;

  -- Mesma regra de valor da sincronização das etapas anteriores.
  v_valor := coalesce(
    v_sale.valor_total_comissao,
    case
      when v_sale.valor_negociado is not null and v_sale.percentual_comissao is not null
        then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
      else null
    end
  );

  -- Venda sem comissão informada não apaga o que já está na ocorrência.
  if v_valor is null then
    return;
  end if;

  update public.occurrences
  set
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = v_valor
  where sale_id = p_sale_id
    and status = 'pendente'
    and coalesce(aceita_financeiro, false) = false
    and (
      percentual_comissao is distinct from v_sale.percentual_comissao
      or valor_comissao is distinct from v_valor
    )
  returning id into v_occ_id;

  if v_occ_id is not null then
    perform public.sync_occurrence_commissions(p_sale_id);

    -- t_a10304e6 (revisão adversarial): linhas criadas à mão pelo Financeiro (managed_by_sale=false)
    -- não passam por sync_occurrence_commissions. O valor em R$ delas é mantido (nunca muda dinheiro
    -- sem alguém digitar); só o % é recalculado sobre o total novo, para a Revisão não mostrar
    -- "10%" numa linha que agora é 5% do total.
    if v_valor > 0 then
      update public.occurrence_commissions
      set percentual = round(valor / v_valor * 100, 3)
      where occurrence_id = v_occ_id
        and managed_by_sale = false
        and valor is not null
        and percentual is distinct from round(valor / v_valor * 100, 3);
    end if;
  end if;
end;
$function$;

-- Mesmo dono da sincronização existente (em produção, mt_1b_definer), para ter exatamente os mesmos
-- privilégios/RLS dela; e o mesmo fechamento (sem EXECUTE para usuários; só o gatilho chama).
DO $$
DECLARE v_owner text;
BEGIN
  SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc
   WHERE oid = 'public.sincronizar_ocorrencia_antes_financeiro(uuid)'::regprocedure;
  -- Mesmo padrão das migrations anteriores (ex.: 20261029200000): CREATE temporário só para o ALTER OWNER,
  -- revogado em seguida (em produção o dono não tem CREATE no schema public; t_cd2adcf5).
  EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', v_owner);
  EXECUTE format('ALTER FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(uuid) OWNER TO %I', v_owner);
  EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', v_owner);
END $$;
REVOKE ALL ON FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(uuid) TO service_role;

-- Gatilho AFTER UPDATE da venda (mantém dono e permissões atuais).
CREATE OR REPLACE FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.sincronizar_ocorrencia_antes_financeiro(new.id);

  -- t_59cb12e0: em análise do Financeiro, só quando o VALOR (R$) da comissão da venda mudou nesta
  -- gravação. t_a10304e6: o % da venda é só referência (a tela recalcula quando muda o negociado);
  -- mudar só o % não pode apagar uma correção que o Financeiro fez direto na aba Ocorrência.
  -- Exceção: venda sem valor em R$ (legado), em que o % é a única informação.
  if new.status::text = 'ocorrencia_analise_financeiro'
     and (
       new.valor_total_comissao is distinct from old.valor_total_comissao
       or (
         new.valor_total_comissao is null
         and new.percentual_comissao is distinct from old.percentual_comissao
       )
     ) then
    perform public.sincronizar_comissao_ocorrencia_em_analise(new.id);
  end if;

  return new;
end;
$function$;

COMMIT;

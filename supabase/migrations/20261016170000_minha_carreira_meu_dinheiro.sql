-- Minha carreira, PR 4 (card t_5a47a73c; "pode executar" de Denis em 15/10/2026): bloco "Meu dinheiro".
-- minhas_comissoes(): SÓ LEITURA. Usuário logado e ATIVO (auth.uid() + is_active_user), imobiliária
-- ATIVA (current_org_id). Anon não executa. Devolve só a parte do PRÓPRIO corretor, parcela a parcela.
-- Mesma regra dos relatórios e das etapas 2 e 3: vendas_comerciais_canonicas (vendas válidas, mês da
-- assinatura em SP) + participacoes_comerciais_validas (comissão individual ligada pelo user_id, sem
-- "sem cadastro confirmado").
--   minha_comissao = soma das linhas de occurrence_commissions do corretor naquela ocorrência;
--   parcelas       = occurrences.prev_recebimento{,2,3}_* (previsão e baixa da comissão da venda inteira);
--   minha parte da parcela = minha_comissao × (valor previsto da parcela ÷ soma das parcelas previstas).
--     O banco não guarda a divisão por pessoa em cada parcela; a proporção é a regra mais simples
--     que fecha com o total do corretor. Valor recebido usa o valor baixado da parcela, se houver.
--   Ocorrência sem nenhuma parcela prevista: 1 linha "sem previsão" (data NULL) com a parte inteira.
-- Nunca devolve valores de colegas, cliente nem a comissão total da venda.
-- Não altera vendas, ocorrências, comissões, captações nem metas.
-- Rollback: supabase/rollback/20261016170000_minha_carreira_meu_dinheiro.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.minhas_comissoes()
RETURNS TABLE(sale_id uuid, occurrence_id uuid, venda_em date, imovel text, papel text,
              minha_comissao numeric, parcela integer, parcelas integer, data_prevista date,
              valor_previsto numeric, recebido_em date, valor_recebido numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH minhas AS (           -- vendas válidas da imobiliária ativa em que o corretor tem comissão
    SELECT DISTINCT p.sale_id, p.venda_em
      FROM public.participacoes_comerciais_validas() p
      JOIN public.sales s ON s.id = p.sale_id
     WHERE p.user_id = _me AND s.organization_id = _org),
  occ AS (                   -- parte do corretor em cada ocorrência dessas vendas
    SELECT o.id, o.sale_id, m.venda_em, sum(oc.valor) AS meu,
           string_agg(DISTINCT CASE oc.papel WHEN 'corretor_captador' THEN 'captador'
                                             WHEN 'corretor_vendedor' THEN 'vendedor'
                                             ELSE replace(oc.papel, '_', ' ') END, ' e ') AS papel,
           o.prev_recebimento_data AS d1, o.prev_recebimento_valor AS v1,
           o.prev_recebimento_recebido_em AS r1, o.prev_recebimento_recebido_valor AS rv1,
           o.prev_recebimento2_data AS d2, o.prev_recebimento2_valor AS v2,
           o.prev_recebimento2_recebido_em AS r2, o.prev_recebimento2_recebido_valor AS rv2,
           o.prev_recebimento3_data AS d3, o.prev_recebimento3_valor AS v3,
           o.prev_recebimento3_recebido_em AS r3, o.prev_recebimento3_recebido_valor AS rv3
      FROM minhas m
      JOIN public.occurrences o ON o.sale_id = m.sale_id
      JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
     WHERE oc.user_id = _me AND coalesce(oc.sem_cadastro_confirmado, false) = false
     GROUP BY o.id, o.sale_id, m.venda_em),
  parc AS (                  -- até 3 parcelas com valor previsto > 0
    SELECT occ.*, x.n, x.d, x.v, x.r, x.rv,
           sum(x.v) OVER (PARTITION BY occ.id) AS total_prev,
           count(*) OVER (PARTITION BY occ.id) AS qtd
      FROM occ
      CROSS JOIN LATERAL (VALUES (1, occ.d1, occ.v1, occ.r1, occ.rv1),
                                 (2, occ.d2, occ.v2, occ.r2, occ.rv2),
                                 (3, occ.d3, occ.v3, occ.r3, occ.rv3)) x(n, d, v, r, rv)
     WHERE coalesce(x.v, 0) > 0)
  SELECT p.sale_id, p.id, (p.venda_em AT TIME ZONE 'America/Sao_Paulo')::date,
         nullif(concat_ws(' · ', s.tipo_imovel, coalesce(s.imovel_bairro, s.imovel_endereco)), ''),
         p.papel, round(p.meu, 2),
         (row_number() OVER (PARTITION BY p.id ORDER BY p.n))::integer, p.qtd::integer, p.d,
         round(p.meu * p.v / p.total_prev, 2), p.r,
         CASE WHEN p.r IS NOT NULL THEN round(p.meu * coalesce(nullif(p.rv, 0), p.v) / p.total_prev, 2) END
    FROM parc p JOIN public.sales s ON s.id = p.sale_id
  UNION ALL
  SELECT o.sale_id, o.id, (o.venda_em AT TIME ZONE 'America/Sao_Paulo')::date,
         nullif(concat_ws(' · ', s.tipo_imovel, coalesce(s.imovel_bairro, s.imovel_endereco)), ''),
         o.papel, round(o.meu, 2), 1, 1, NULL::date, round(o.meu, 2), NULL::date, NULL::numeric
    FROM occ o JOIN public.sales s ON s.id = o.sale_id
   WHERE NOT EXISTS (SELECT 1 FROM parc p WHERE p.id = o.id);
END $function$;
REVOKE ALL ON FUNCTION public.minhas_comissoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_comissoes() TO authenticated, service_role;

COMMIT;

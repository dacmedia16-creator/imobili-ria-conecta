-- Minha carreira, PR 4 (cards t_5a47a73c e t_3f1d4f0f): bloco "Meu dinheiro".
-- Decisão de Denis (16/10): mostrar só o valor total da comissão a que o corretor tem direito, venda a
-- venda. Sem "recebido", "a receber", parcelas ou previsão: o sistema não registra o repasse ao corretor.
-- minhas_comissoes(): SÓ LEITURA. Usuário logado e ATIVO (auth.uid() + is_active_user), imobiliária
-- ATIVA (current_org_id). Anon e PUBLIC não executam. Devolve só a parte do PRÓPRIO corretor.
-- Mesma regra dos relatórios e das etapas 2 e 3: vendas_comerciais_canonicas (vendas válidas, mês da
-- assinatura em SP) + participacoes_comerciais_validas (comissão individual ligada pelo user_id, sem
-- "sem cadastro confirmado").
--   minha_comissao = soma das linhas de occurrence_commissions do corretor nas ocorrências da venda.
-- Nunca devolve valores de colegas, cliente nem a comissão total da venda.
-- Não altera vendas, ocorrências, comissões, captações nem metas.
-- Rollback: supabase/rollback/20261016170000_minha_carreira_meu_dinheiro.sql
BEGIN;

-- Só por segurança: se alguma versão anterior desta RPC (com parcelas) existir, troca a assinatura.
DROP FUNCTION IF EXISTS public.minhas_comissoes();

CREATE FUNCTION public.minhas_comissoes()
RETURNS TABLE(sale_id uuid, venda_em date, imovel text, papel text, minha_comissao numeric)
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
  meu AS (                   -- parte do corretor na venda (todas as ocorrências dela)
    SELECT m.sale_id, m.venda_em, sum(oc.valor) AS valor,
           string_agg(DISTINCT CASE oc.papel WHEN 'corretor_captador' THEN 'captador'
                                             WHEN 'corretor_vendedor' THEN 'vendedor'
                                             ELSE replace(oc.papel, '_', ' ') END, ' e ') AS papel
      FROM minhas m
      JOIN public.occurrences o ON o.sale_id = m.sale_id
      JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
     WHERE oc.user_id = _me AND coalesce(oc.sem_cadastro_confirmado, false) = false
     GROUP BY m.sale_id, m.venda_em)
  SELECT x.sale_id, (x.venda_em AT TIME ZONE 'America/Sao_Paulo')::date,
         nullif(concat_ws(' · ', s.tipo_imovel, coalesce(s.imovel_bairro, s.imovel_endereco)), ''),
         x.papel, round(x.valor, 2)
    FROM meu x JOIN public.sales s ON s.id = x.sale_id
   ORDER BY x.venda_em DESC, x.sale_id;
END $function$;
REVOKE ALL ON FUNCTION public.minhas_comissoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_comissoes() TO authenticated, service_role;

COMMIT;

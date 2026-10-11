-- Mesmo bug do ranking da Visão Executiva: comissao_corretor agrupava por sales.corretor_id (quem
-- CRIOU a venda) e somava o valor_comissao INTEIRO da ocorrência — dando a meta batida inteira pra
-- quem criou a venda, mesmo quando captador/vendedor/indicador/gestor reais eram outras pessoas.
-- Corrige pra agregar por occurrence_commissions.user_id (mesma fonte já usada em
-- visao_executiva_stats() depois da correção de atribuição), somando só o que cada pessoa
-- efetivamente recebeu. Mantém a mesma base de data (data_assinatura/created_at da ocorrência) e a
-- mesma exclusão de cancelada/arquivada já existentes — não fazia parte do bug, só a atribuição por
-- pessoa.
CREATE OR REPLACE FUNCTION public.metas_progresso(_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH mes_alvo AS (SELECT date_trunc('month', _mes)::date AS mes),
comissao_corretor AS (
  SELECT oc.user_id AS corretor_id, sum(oc.valor) AS total
  FROM occurrence_commissions oc
  JOIN occurrences o ON o.id = oc.occurrence_id
  JOIN sales s ON s.id = o.sale_id
  CROSS JOIN mes_alvo
  WHERE date_trunc('month', COALESCE(o.data_assinatura, o.created_at::date))::date = mes_alvo.mes
    AND s.status::text NOT IN ('cancelada','arquivada')
    AND oc.user_id IS NOT NULL
  GROUP BY oc.user_id
),
comissao_equipe AS (
  SELECT tm.team_id, sum(cc.total) AS total
  FROM comissao_corretor cc
  JOIN team_members tm ON tm.membro_id = cc.corretor_id
  GROUP BY tm.team_id
)
SELECT jsonb_build_object(
  'corretor', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(cc.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_corretor cc ON cc.corretor_id = m.corretor_id
    WHERE m.tipo = 'corretor' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb),
  'equipe', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(ce.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_equipe ce ON ce.team_id = m.team_id
    WHERE m.tipo = 'equipe' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb)
);
$function$;

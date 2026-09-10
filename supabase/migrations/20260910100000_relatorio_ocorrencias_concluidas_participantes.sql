-- Inclui no relatório as pessoas citadas em occurrence_commissions.
-- A ocorrência continua sendo exibida uma única vez, mas filtros de equipe/corretor
-- passam a considerar qualquer participante vinculado, mesmo quando a venda foi
-- criada por outra pessoa ou pertence originalmente a outra equipe.
-- Rollback: reaplicar a definição de 20260909193000_relatorio_ocorrencias_concluidas.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.relatorio_ocorrencias_concluidas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  resultado jsonb;
BEGIN
  IF caller_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = caller_id AND p.ativo IS TRUE
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = caller_id
        AND ur.role = ANY (ARRAY[
          'corretor', 'gestor', 'team_leader', 'financeiro',
          'admin', 'super_admin', 'juridico', 'lancamento'
        ]::public.app_role[])
    )
  THEN
    RAISE EXCEPTION 'Acesso não autorizado ao relatório de ocorrências concluídas'
      USING ERRCODE = '42501';
  END IF;

  WITH concluidas AS MATERIALIZED (
    SELECT o.id, o.sale_id, o.valor_comissao, o.data_assinatura
    FROM public.occurrences o
    WHERE o.status = 'concluida'
  ), participantes AS MATERIALIZED (
    -- Uma ocorrência pode citar corretores diferentes do responsável pela venda.
    -- DISTINCT por ocorrência/pessoa evita duplicar o mesmo filtro quando a pessoa
    -- recebe por mais de um papel ou lado da operação.
    SELECT oc.occurrence_id, oc.user_id, max(oc.nome) AS nome
    FROM public.occurrence_commissions oc
    WHERE oc.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM concluidas o WHERE o.id = oc.occurrence_id)
    GROUP BY oc.occurrence_id, oc.user_id
  ), vendas AS MATERIALIZED (
    SELECT s.id, s.codigo_interno, s.imovel_id, s.corretor_id
    FROM public.sales s
    WHERE EXISTS (SELECT 1 FROM concluidas o WHERE o.sale_id = s.id)
  ), pessoas AS (
    -- Roster atual canônico + nomes históricos, inclusive de pessoas inativas.
    -- EXISTS evita duplicação por múltiplos papéis, vínculos, vendas ou comissões.
    SELECT p.id, p.nome
    FROM public.profiles p
    WHERE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role = ANY (ARRAY[
          'corretor', 'gestor', 'team_leader', 'lancamento'
        ]::public.app_role[])
    )
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.membro_id = p.id)
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.lider_id = p.id)
    OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.user_id = p.id)
    OR EXISTS (SELECT 1 FROM vendas s WHERE s.corretor_id = p.id)
    OR EXISTS (SELECT 1 FROM participantes pc WHERE pc.user_id = p.id)
  ), equipes AS (
    SELECT t.id, t.nome, t.parent_team_id, t.lider_id FROM public.teams t
  ), membros AS (
    SELECT DISTINCT tm.membro_id, tm.team_id FROM public.team_members tm
  ), auxiliares AS (
    SELECT DISTINCT cl.user_id, cl.team_id FROM public.team_co_leaders cl
  )
  SELECT pg_catalog.jsonb_build_object(
    'occs', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) ORDER BY o.id) FROM concluidas o), '[]'::jsonb),
    'sales', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.id) FROM vendas s), '[]'::jsonb),
    'participants', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pc) ORDER BY pc.occurrence_id, pc.user_id) FROM participantes pc), '[]'::jsonb),
    'profiles', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.id) FROM pessoas p), '[]'::jsonb),
    'teams', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.id) FROM equipes t), '[]'::jsonb),
    'members', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tm) ORDER BY tm.membro_id, tm.team_id) FROM membros tm), '[]'::jsonb),
    'coLeaders', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cl) ORDER BY cl.user_id, cl.team_id) FROM auxiliares cl), '[]'::jsonb)
  ) INTO resultado;

  RETURN resultado;
END;
$function$;

REVOKE ALL ON FUNCTION public.relatorio_ocorrencias_concluidas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relatorio_ocorrencias_concluidas() TO authenticated;

COMMENT ON FUNCTION public.relatorio_ocorrencias_concluidas() IS
  'Leitura mínima global de ocorrências concluídas, incluindo participantes de occurrence_commissions para filtros por pessoa/equipe. Não altera autorização de tabelas nem permite escrita.';

COMMIT;

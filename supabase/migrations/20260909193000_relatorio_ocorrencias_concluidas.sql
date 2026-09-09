-- Relatório global de Ocorrências concluídas para usuários ativos do ADM.
-- Projeto dedicado xvvymgurpchhlmbpjbgc: as fontes canônicas não têm tenant_id.
-- A ampliação fica exclusivamente nesta RPC; não altera RLS, helpers ou escrita.
-- Não reutilizar em projeto multiempresa sem adicionar isolamento explícito.
-- Rollback: DROP FUNCTION public.relatorio_ocorrencias_concluidas();
BEGIN;

CREATE FUNCTION public.relatorio_ocorrencias_concluidas()
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
  -- is_active_user não serve aqui: o helper legado aceita profile ausente/NULL.
  -- Papel legado coordenador não é papel ADM canônico autorizado neste relatório.
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
  ), vendas AS MATERIALIZED (
    SELECT s.id, s.codigo_interno, s.imovel_id, s.corretor_id
    FROM public.sales s
    WHERE EXISTS (SELECT 1 FROM concluidas o WHERE o.sale_id = s.id)
  ), pessoas AS (
    -- Roster atual canônico + nomes históricos, inclusive de pessoas inativas.
    -- EXISTS evita duplicação por múltiplos papéis, vínculos ou vendas.
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
    'profiles', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.id) FROM pessoas p), '[]'::jsonb),
    'teams', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.id) FROM equipes t), '[]'::jsonb),
    'members', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tm) ORDER BY tm.membro_id, tm.team_id) FROM membros tm), '[]'::jsonb),
    'coLeaders', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cl) ORDER BY cl.user_id, cl.team_id) FROM auxiliares cl), '[]'::jsonb)
  ) INTO resultado;

  RETURN resultado;
END;
$function$;

-- Sem parâmetros de identidade: auth.uid() é a única identidade aceita.
REVOKE ALL ON FUNCTION public.relatorio_ocorrencias_concluidas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relatorio_ocorrencias_concluidas() TO authenticated;

COMMENT ON FUNCTION public.relatorio_ocorrencias_concluidas() IS
  'Leitura mínima global de ocorrências concluídas para usuários ativos com papel ADM canônico. Não altera autorização de tabelas nem permite escrita.';

COMMIT;

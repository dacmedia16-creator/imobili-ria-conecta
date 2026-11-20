-- Meu Plano 2027 → "Reabrir plano" (cartão t_495e4305; decisão de Denis 20/11/2026, opção C, tópico 6238).
--
-- ADITIVA: cria 1 função nova. Não altera tabela, coluna, policy, outra função nem dado existente.
-- Rollback: docs/sql/rollback/20261209130000_meu_plano_reabrir.rollback.sql
-- Teste: supabase/tests/run-meu-plano-reabrir.sh (transação desfeita; homologação ou banco local).
--
-- carreira_plano_reabrir(_corretor, _ano, _motivo): volta o plano assinado para "em preenchimento".
--   O que zera: assinado_corretor_em (assinatura do corretor) e, se houver, assinado_broker_em/assinado_broker_por
--   (a assinatura do broker só existe depois da do corretor: CHECK carreira_plano_broker_depois; sem a do corretor
--   ela não pode ficar).
--   O que NÃO mexe: respostas (todos os valores digitados), trilha, início da Ativação, meta_oficial/meta_oficial_em
--   (cópia da meta gravada na assinatura) e a meta anual em minhas_metas. Ao assinar de novo, o app regrava a meta
--   oficial com os números do plano (carreira_plano_usar_meta com _substituir = true), como já faz hoje.
--   Quem pode (regra proposta, mesma base dos painéis de metas 2027):
--     * admin, gestor ou administrador principal (super_admin) com o papel NESTA imobiliária: qualquer plano dela;
--     * super admin da plataforma no contexto da imobiliária: qualquer plano dela (auditoria com ator_plataforma_id);
--     * Team Leader com o papel nesta imobiliária: só membros das equipes que lidera/co-lidera (ou equipe-filha);
--     * ninguém reabre o PRÓPRIO plano; corretor e demais papéis: recusado (42501).
--   Exige motivo (5 a 300 caracteres) e grava o histórico em activity_logs (acao 'meu_plano_reaberto'): quem
--   reabriu, quando (created_at), motivo, a data da assinatura anterior do corretor e do broker.
BEGIN;

CREATE OR REPLACE FUNCTION public.carreira_plano_reabrir(_corretor uuid, _ano integer, _motivo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _me uuid := auth.uid();
  _org uuid;
  -- Tira espaços, quebras de linha e espaços invisíveis das pontas (NBSP, zero-width).
  _mot text := regexp_replace(coalesce(_motivo, ''),
                 '^[[:space:]\u00a0\u200b\u200c\u200d\ufeff]+|[[:space:]\u00a0\u200b\u200c\u200d\ufeff]+$', '', 'g');
  _papel text;
  _plat boolean;
  _p public.carreira_plano%ROWTYPE;
BEGIN
  _org := public.meu_plano_org_ok();   -- login, usuário ativo, imobiliária e módulo ligado
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF _corretor IS NULL THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _corretor = _me THEN
    RAISE EXCEPTION 'Você não pode reabrir o seu próprio plano' USING ERRCODE = '42501';
  END IF;

  _plat := coalesce(public.is_platform_super_admin(_me), false);
  SELECT CASE WHEN bool_or(r.role = 'super_admin') THEN 'super_admin'
              WHEN bool_or(r.role = 'admin') THEN 'admin'
              WHEN bool_or(r.role = 'gestor') THEN 'gestor'
              WHEN bool_or(r.role = 'team_leader') THEN 'team_leader' END
    INTO _papel
    FROM public.user_roles r
   WHERE r.user_id = _me AND r.organization_id = _org
     AND r.role IN ('super_admin', 'admin', 'gestor', 'team_leader');
  -- Super admin da plataforma vale como broker (mesmo que também seja TL nesta imobiliária).
  IF _plat AND (_papel IS NULL OR _papel = 'team_leader') THEN _papel := 'plataforma'; END IF;
  IF _papel = 'team_leader' AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.membro_id = _corretor AND t.organization_id = _org
          AND coalesce(public.leads_team_or_parent(t.id, _me), false)) THEN
    _papel := NULL;
  END IF;
  IF _papel IS NULL THEN
    RAISE EXCEPTION 'Só o gestor, o administrador ou o líder da equipe reabre o plano' USING ERRCODE = '42501';
  END IF;

  IF char_length(_mot) < 5 OR char_length(_mot) > 300 OR _mot !~ '[[:alnum:]]' THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura (5 a 300 caracteres)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _p FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _p.assinado_corretor_em IS NULL THEN
    RAISE EXCEPTION 'Este plano não está assinado' USING ERRCODE = '22023';
  END IF;

  -- Só as colunas de assinatura. respostas, meta_oficial e minhas_metas ficam como estão.
  UPDATE public.carreira_plano
     SET assinado_corretor_em = NULL, assinado_broker_em = NULL, assinado_broker_por = NULL
   WHERE id = _p.id;

  -- Histórico. Super admin da plataforma sem perfil nesta imobiliária: autor nulo + ator_plataforma_id
  -- (mesmo padrão de src/lib/platform-audit.server.ts; o gatilho recusa autor de outra imobiliária).
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
  VALUES (
    CASE WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _me AND pr.organization_id = _org)
         THEN _me END,
    NULL, 'meu_plano_reaberto',
    jsonb_build_object(
      'corretor_id', _corretor, 'ano', _ano, 'motivo', _mot, 'papel', _papel,
      'ator_id', _me, 'ator_plataforma_id', CASE WHEN _papel = 'plataforma' THEN _me END,
      'assinado_corretor_em_anterior', _p.assinado_corretor_em,
      'assinado_broker_em_anterior', _p.assinado_broker_em,
      'assinado_broker_por_anterior', _p.assinado_broker_por,
      'meta_oficial_em', _p.meta_oficial_em),
    _org);

  RETURN jsonb_build_object('status', 'reaberto',
    'assinado_corretor_em_anterior', _p.assinado_corretor_em,
    'assinado_broker_em_anterior', _p.assinado_broker_em);
END $function$;
-- Dono postgres (igual às outras funções do Meu Plano): grava o histórico com autor nulo para o super admin da
-- plataforma, o que a policy log_insert (autor_id = auth.uid()) recusaria para um dono sujeito a RLS.
ALTER FUNCTION public.carreira_plano_reabrir(uuid, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_reabrir(uuid, integer, text) TO authenticated, service_role;

COMMIT;

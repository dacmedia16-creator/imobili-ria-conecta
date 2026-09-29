-- Fase 2h (somente clone/homologação até o "pode ir" de Denis): decisão de Denis de 29/09/2026 sobre
-- reservas de sala. SUBSTITUI a parte de reservas da 2e (que dava ao team_leader a agência toda).
--
-- Regra nova, para ver os detalhes (can_view_room_reservation) e para cancelar (can_cancel_room_reservation):
--   * responsável: as próprias (sem mudança);
--   * participante marcado: vê os detalhes (sem mudança; não cancela);
--   * gestor e team_leader: só as próprias e as dos membros das equipes que lideram (is_lead_of:
--     líder principal, líder da equipe-mãe e co-líder, como já vale para vendas);
--   * admin, super_admin e staff: qualquer reserva da própria imobiliária (sem mudança);
--   * corretor e demais: sem mudança.
-- Tudo continua preso à imobiliária do chamador (guard da 1b/2g e a policy RESTRICTIVE org_isolation).
-- A grade de ocupação (list_room_occupancy: sala, data, horário e quem reservou) continua para todos
-- da imobiliária, para ninguém reservar por cima.
-- A interface usa can_cancel_room_reservation para mostrar o botão Cancelar: nada muda na tela além
-- dos textos de ajuda.
--
-- Pré-requisito: 1a–2g. Não muda dados. Rollback: .down.sql (restaura as definições exatas).
-- Ordem do rollback: 2h antes da 2g.
BEGIN;
CREATE TABLE public.mt_2h_backup (name text PRIMARY KEY, ddl text NOT NULL, owner_name text NOT NULL, acl text);
REVOKE ALL ON public.mt_2h_backup FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.mt_2h_backup(name, ddl, owner_name, acl)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text, p.proacl::text
  FROM pg_catalog.pg_proc p
 WHERE p.oid IN ('public.can_cancel_room_reservation(uuid,uuid)'::regprocedure,
                 'public.can_view_room_reservation(uuid,uuid[],uuid)'::regprocedure);

DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2h_backup) <> 2 THEN
    RAISE EXCEPTION 'Funcoes de reserva ausentes; abortando 2h';
  END IF;
  IF to_regclass('public.mt_2e_backup') IS NULL
     OR to_regclass('public.mt_2g_backup') IS NULL
     OR to_regprocedure('public.mt_in_ctx_org(uuid)') IS NULL
     OR to_regprocedure('public.mt_1b_gate(uuid)') IS NULL
     OR to_regprocedure('public.is_lead_of(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-requisitos 1a-2g ausentes; abortando 2h';
  END IF;
END $$;

-- Cancelar: gestor/team_leader só a própria equipe.
CREATE OR REPLACE FUNCTION public.can_cancel_room_reservation(_responsible_id uuid, _actor uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE(COALESCE((
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR public.has_any_role(_actor, ARRAY['admin', 'super_admin', 'staff']::public.app_role[])
    OR (public.has_any_role(_actor, ARRAY['gestor', 'team_leader']::public.app_role[])
        AND public.is_lead_of(_actor, _responsible_id))
  )
  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND public.mt_in_ctx_org(_responsible_id))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user='supabase_admin')), false));
END
$function$;

-- Ver detalhes: mesmo escopo, mais o participante marcado.
CREATE OR REPLACE FUNCTION public.can_view_room_reservation(_responsible_id uuid, _participant_user_ids uuid[], _actor uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE(COALESCE((
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR _actor = ANY(COALESCE(_participant_user_ids, ARRAY[]::uuid[]))
    OR public.has_any_role(_actor, ARRAY['admin', 'super_admin', 'staff']::public.app_role[])
    OR (public.has_any_role(_actor, ARRAY['gestor', 'team_leader']::public.app_role[])
        AND public.is_lead_of(_actor, _responsible_id))
  )
  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND public.mt_in_ctx_org(_responsible_id))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user='supabase_admin')), false));
END
$function$;

COMMENT ON FUNCTION public.can_cancel_room_reservation(uuid, uuid)
  IS 'Cancela: responsável; gestor/team leader só a própria equipe; staff/admin/super_admin qualquer reserva da imobiliária (fase 2h).';

-- CREATE OR REPLACE preserva dono e ACL; conferir para falhar fechado.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2h_backup LOOP
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid = f.name::regprocedure) IS DISTINCT FROM f.acl THEN
      RAISE EXCEPTION 'Dono/ACL de % mudou; abortando 2h', f.name;
    END IF;
    IF has_function_privilege('anon', f.name, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon nao pode executar %; abortando 2h', f.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_reservations' AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_reservations' AND policyname = 'room_reservations_select_scope')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_reservations' AND policyname = 'room_reservations_update_cancel_scope') THEN
    RAISE EXCEPTION 'Policies de reserva ausentes; abortando 2h';
  END IF;
END $$;
COMMIT;

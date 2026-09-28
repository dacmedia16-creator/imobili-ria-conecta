-- Fase 2e (somente clone/homologação até aprovação de Denis): decisões de Denis de 28/09/2026 sobre
-- perfis. Roda depois de 1a–2d; não muda dados.
--
-- 1. Team Leader = Gestor. Diferenças encontradas no banco e alinhadas ao Gestor:
--    a) cancelar reserva de sala de outra pessoa (can_cancel_room_reservation): gestor = agência toda,
--       team_leader = só a equipe  -> team_leader passa a ser agência toda;
--    b) ver detalhes de reserva de outra pessoa (can_view_room_reservation): mesma assimetria -> idem;
--    c) listar vínculos da agência (policy organization_members_select): gestor lia, team_leader não
--       -> team_leader passa a ler, sempre só da própria agência.
--    Não são permissão (não mudam): list_active_gestores (lista quem TEM o cargo gestor),
--    comissao_coordenador_dados (informa o cargo de cada beneficiário) e equipe_vigente/vigencias
--    (usam o cargo para achar a equipe de um líder sem membros).
-- 2. Excluir venda: só em 'rascunho' e só por quem já pode editar aquela venda (mesma regra das
--    policies de UPDATE: sales_update_owner_draft + co_leader_sale_update). Demais etapas: só
--    cancelar (fluxo existente, inalterado).
-- Financeiro (edita todas as vendas/comissões da agência) e Staff (cancela reserva de qualquer
-- pessoa da agência) já estavam corretos: só confirmados pelo teste isolation_2e.
--
-- Falha fechada: tudo continua preso à agência do chamador (current_org_id / gate da 1b e a policy
-- RESTRICTIVE org_isolation). Backup exato das definições anteriores para o down.
BEGIN;
CREATE TABLE public.mt_2e_backup (kind text NOT NULL, name text PRIMARY KEY, ddl text NOT NULL, owner_name text);
REVOKE ALL ON public.mt_2e_backup FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.mt_2e_backup(kind, name, ddl, owner_name)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
  FROM pg_proc p
 WHERE p.oid IN ('public.can_cancel_room_reservation(uuid,uuid)'::regprocedure,
                 'public.can_view_room_reservation(uuid,uuid[],uuid)'::regprocedure);

INSERT INTO public.mt_2e_backup(kind, name, ddl)
SELECT 'policy', format('%I.%I.%I', schemaname, tablename, policyname),
       format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s', policyname, schemaname, tablename,
         permissive, cmd,
         (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r),
         CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END,
         CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END)
  FROM pg_policies
 WHERE (schemaname, tablename, policyname) IN
       (('public', 'sales', 'delete_sales_por_papel'),
        ('public', 'organization_members', 'organization_members_select'));

DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2e_backup WHERE kind = 'function') <> 2
     OR (SELECT count(*) FROM public.mt_2e_backup WHERE kind = 'policy') <> 2 THEN
    RAISE EXCEPTION 'Objetos esperados ausentes; abortando 2e';
  END IF;
  IF to_regclass('public.mt_1e_function_backup') IS NULL
     OR to_regprocedure('public.current_org_id()') IS NULL
     OR to_regprocedure('public.mt_1b_gate(uuid)') IS NULL
     OR to_regprocedure('public.can_edit_sale_stage(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_edit_sale_as_co_leader(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-requisitos 1a-1e ausentes; abortando 2e';
  END IF;
END $$;

-- 1a) Cancelar reserva: team_leader com o mesmo escopo do gestor (agência toda).
CREATE OR REPLACE FUNCTION public.can_cancel_room_reservation(_responsible_id uuid, _actor uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- COALESCE externo: responsável de outra agência dava NULL (não "false"); agora é "false" explícito.
  SELECT COALESCE(COALESCE((
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR public.has_any_role(
      _actor,
      ARRAY['admin', 'super_admin', 'staff', 'gestor', 'team_leader']::public.app_role[]
    )
  )
  ),false) AND public.mt_1b_gate() AND ((public.user_org(_actor) = public.current_org_id() AND public.user_org(_responsible_id) = public.current_org_id())
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user='supabase_admin')), false);
$function$;

-- 1b) Ver detalhes da reserva: mesmo alinhamento.
CREATE OR REPLACE FUNCTION public.can_view_room_reservation(_responsible_id uuid, _participant_user_ids uuid[], _actor uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COALESCE((
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR _actor = ANY(COALESCE(_participant_user_ids, ARRAY[]::uuid[]))
    OR public.has_any_role(
      _actor,
      ARRAY['admin', 'super_admin', 'staff', 'gestor', 'team_leader']::public.app_role[]
    )
  )
  ),false) AND public.mt_1b_gate() AND ((public.user_org(_actor) = public.current_org_id() AND public.user_org(_responsible_id) = public.current_org_id())
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user='supabase_admin')), false);
$function$;

-- 1c) Vínculos da agência: team_leader lê como o gestor, só da própria agência.
DROP POLICY organization_members_select ON public.organization_members;
CREATE POLICY organization_members_select ON public.organization_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_super_admin()
    OR (organization_id = public.current_org_id()
        AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','gestor','team_leader']::public.app_role[])));

-- 2) Excluir venda: só rascunho, só quem pode editar a venda.
DROP POLICY delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    status = 'rascunho'::public.sale_status
    AND public.is_active_user((SELECT auth.uid()))
    AND (
      (public.can_view_sale((SELECT auth.uid()), id)
        AND public.can_edit_sale_stage((SELECT auth.uid()), id)
        AND ((NOT public.is_sale_locked(id))
          OR public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[])))
      OR public.can_edit_sale_as_co_leader(id)
    )
  );

-- CREATE OR REPLACE preserva dono e ACL; conferir para falhar fechado.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2e_backup WHERE kind = 'function' LOOP
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono de % mudou; abortando 2e', f.name;
    END IF;
    IF has_function_privilege('anon', f.name, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon nao pode executar %; abortando 2e', f.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales' AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'room_reservations' AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Isolamento por agencia ausente; abortando 2e';
  END IF;
END $$;
COMMIT;

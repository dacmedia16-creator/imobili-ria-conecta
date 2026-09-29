-- Upgrade APÓS a migration publicada 20260929100000, no ambiente multiempresa 1a-2f.
-- Ela sobrescreve guards de SECURITY DEFINER da 1b e a regra de cancelar da 2f.
-- Não altera dados. Executar 291000 + este upgrade na mesma transação, sem janela insegura.
-- Reversão: ROLLBACK da transação conjunta. Após commit com mais de uma agência,
-- nunca restaurar isoladamente o DDL 291000 guardado abaixo: ele abre leitura cruzada.
-- Nesse caso restaurar snapshot isolado pré-transação ou corrigir para frente.
CREATE TABLE public.mt_upgrade_atribuicao_backup (
  signature text PRIMARY KEY, ddl text NOT NULL, owner_name text NOT NULL
);
REVOKE ALL ON public.mt_upgrade_atribuicao_backup FROM PUBLIC, anon, authenticated, service_role;

DO $upgrade$
DECLARE
  f record;
  body text;
  guarded text;
  ddl text;
  condition text;
  original_cancel text := $old$
  -- Regra publicada em 20260929090000_excluir_cancelar_venda (preservada literalmente).
  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: exclua o rascunho.' using errcode = '42501';
    end if;
    if not (public.is_active_user(actor) and public.is_platform_super_admin(actor)) then
      raise exception 'Somente o dono da plataforma pode cancelar vendas.' using errcode = '42501';
    end if;
    return new;
  end if;$old$;
  restored_cancel text := $new$
  -- Fase 2f: cancelar só pela RPC da plataforma, depois do rascunho.
  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: use Excluir venda.' using errcode = '42501';
    end if;
    if actor is not null
       and public.is_platform_super_admin(actor)
       and current_setting('mt.platform_cancel_sale', true) = old.id::text then
      return new;
    end if;
    raise exception 'Somente o dono da plataforma cancela venda.' using errcode = '42501';
  end if;$new$;
BEGIN
  IF to_regclass('public.mt_2f_backup') IS NULL
    OR to_regclass('public.mt_1b_function_backup') IS NULL
    OR to_regprocedure('public.mt_1b_gate(uuid)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='sales' AND policyname='org_isolation' AND permissive='RESTRICTIVE') THEN
    RAISE EXCEPTION 'Pre-requisitos de isolamento 1b/2f ausentes';
  END IF;

  FOR f IN SELECT p.oid, p.oid::regprocedure::text AS signature,
      p.proowner::regrole::text AS owner_name, pg_get_functiondef(p.oid) AS definition,
      p.proname
    FROM pg_proc p WHERE p.oid IN (
      'public.can_view_sale(uuid,uuid)'::regprocedure,
      'public.can_edit_sale_stage(uuid,uuid)'::regprocedure,
      'public.can_edit_sale_comissao(uuid,uuid)'::regprocedure,
      'public.is_sale_corretor(uuid,uuid)'::regprocedure,
      'public.is_sale_responsavel(uuid,uuid)'::regprocedure,
      'public.is_lead_of_sale_corretor(uuid,uuid)'::regprocedure,
      'public.is_lead_of_sale_responsavel(uuid,uuid)'::regprocedure)
  LOOP
    IF position('AS $function$' IN f.definition) = 0
      OR position('public.mt_1b_gate()' IN f.definition) > 0 THEN
      RAISE EXCEPTION 'Definicao inesperada/ja protegida: %', f.signature;
    END IF;
    INSERT INTO public.mt_upgrade_atribuicao_backup VALUES (f.signature, f.definition, f.owner_name);
    body := split_part(split_part(f.definition, 'AS $function$', 2), '$function$', 1);
    body := regexp_replace(btrim(body), ';[[:space:]]*$', '');
    condition := CASE WHEN f.proname LIKE 'is_lead_of_sale_%'
      THEN 'public.user_org(_lider) = public.current_org_id()'
      ELSE 'public.user_org(_user) = public.current_org_id()' END;
    condition := condition || ' AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND s.organization_id = public.current_org_id())';
    -- Mesmo modelo da 1b: bloqueia parâmetros forjados na RPC e preserva service_role.
    guarded := E'\n  SELECT COALESCE((' || body || E'\n  ), false) AND public.mt_1b_gate() AND ((' || condition || E')\n    OR current_setting(''role'',true)=''service_role''\n    OR (current_setting(''role'',true)=''none'' AND session_user IN (''supabase_admin'',''postgres'')));\n';
    ddl := replace(f.definition,
      split_part(split_part(f.definition, 'AS $function$', 2), '$function$', 1), guarded);
    EXECUTE ddl;
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid=f.oid) <> f.owner_name THEN
      RAISE EXCEPTION 'Proprietario mudou: %', f.signature;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.mt_upgrade_atribuicao_backup) <> 7 THEN
    RAISE EXCEPTION 'Esperadas sete funcoes protegidas';
  END IF;

  SELECT pg_get_functiondef('public.validate_sale_status_transition()'::regprocedure) INTO ddl;
  IF position(original_cancel IN ddl)=0
    OR position('to_status in (''cancelada'', ''arquivada'')' IN ddl)=0 THEN
    RAISE EXCEPTION 'Trigger de atribuicao inesperada; abortando sem alterar';
  END IF;
  INSERT INTO public.mt_upgrade_atribuicao_backup
    SELECT p.oid::regprocedure::text, ddl, p.proowner::regrole::text
    FROM pg_proc p WHERE p.oid='public.validate_sale_status_transition()'::regprocedure;
  ddl := replace(ddl, original_cancel, restored_cancel);
  ddl := replace(ddl, 'to_status in (''cancelada'', ''arquivada'')', 'to_status = ''arquivada''');
  IF position(original_cancel IN ddl)>0
    OR position('to_status in (''cancelada'', ''arquivada'')' IN ddl)>0 THEN
    RAISE EXCEPTION 'Trigger nao protegido';
  END IF;
  EXECUTE ddl;
END $upgrade$;

-- Rollback de 20261105130100_papel_fotografo (card t_0666d3f0, PR #269).
-- Volta os corpos originais (copiados do banco antes da migration) e remove a barreira do só-fotógrafo.
-- Quem tiver só o papel 'fotografo' passa a ser tratado como os demais papéis sem acesso específico;
-- retire o papel antes (ver rollback 20261105130000).

DO $$ DECLARE _t text; BEGIN
  FOR _t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'zz_fotografo_fora' LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_fotografo_fora ON public.%I', _t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _in boolean := public.mt_in_ctx_org(_user);
BEGIN
  IF current_setting('mt.ctx_pc',true)='1' AND _user=auth.uid() THEN
    RETURN public.mt_1b_gate() AND coalesce(_in,false);
  END IF;
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((_in
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$
;

CREATE OR REPLACE FUNCTION public.photo_eh_fotografo(_org uuid, _uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.photo_settings s
    WHERE s.organization_id = _org AND s.fotografo_id = _uid)
    AND public.has_role(_uid, 'staff'::public.app_role)
$function$
;

CREATE OR REPLACE FUNCTION public.photo_staff_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.photo_org_ativa();
BEGIN
  IF NOT public.photo_eh_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o admin configura' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome)
    FROM public.profiles p
   WHERE p.organization_id = _org AND p.ativo IS TRUE
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'staff')), '[]'::jsonb);
END $function$
;

CREATE OR REPLACE FUNCTION public.photo_configurar(_fotografo uuid, _valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa();
BEGIN
  IF NOT public.photo_eh_admin(_uid) THEN RAISE EXCEPTION 'Apenas o admin configura' USING ERRCODE = '42501'; END IF;
  IF _valor IS NULL OR _valor < 0 OR _valor > 100000 THEN
    RAISE EXCEPTION 'Valor por sessao invalido' USING ERRCODE = '22023';
  END IF;
  IF _fotografo IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = _fotografo AND p.organization_id = _org AND p.ativo IS TRUE
          AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'staff')) THEN
    RAISE EXCEPTION 'O fotografo precisa ser um usuario staff ativo desta imobiliaria' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_settings (organization_id, fotografo_id, valor_sessao, updated_at, updated_by)
  VALUES (_org, _fotografo, round(_valor, 2), now(), _uid)
  ON CONFLICT (organization_id) DO UPDATE
    SET fotografo_id = EXCLUDED.fotografo_id, valor_sessao = EXCLUDED.valor_sessao, updated_at = now(), updated_by = _uid;
  INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
  VALUES (_org, _uid, 'configuracao', jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2)));
  RETURN jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2));
END $function$
;

CREATE OR REPLACE FUNCTION public.achievements_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'mural_conquistas'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'captacao_exclusiva'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.leads_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'leads'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.opportunities_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'oportunidades'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.owner_feedback_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'feedback_proprietario'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.room_reservation_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'reserva_salas'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.academia_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'academia'), false)
$function$
;

CREATE OR REPLACE FUNCTION public.list_room_reservation_users()
 RETURNS TABLE(id uuid, nome text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.nome
  FROM public.profiles p
  WHERE p.ativo = true
    AND p.organization_id = public.current_org_id()
  ORDER BY p.nome NULLS LAST, p.id;
$function$
;

DROP FUNCTION IF EXISTS public.eh_so_fotografo(uuid);

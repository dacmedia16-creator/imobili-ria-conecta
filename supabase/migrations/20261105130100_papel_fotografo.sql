-- Papel "Fotógrafo" (card t_0666d3f0, PR #269), parte B de 2. Decisão de Denis (05/11): "é só fotógrafo".
-- Quem tem SÓ o papel 'fotografo' (nenhum outro papel de agência) enxerga apenas a área de fotos:
--  * is_active_user() devolve false para ele -> has_role/has_any_role e as ~40 funções e políticas que
--    dependem deles (vendas, clientes, carreira, metas, rankings, dashboard, listas de corretores) o tratam
--    como fora da agência. Fica fora de rankings, metas e contagens de corretor.
--  * Política RESTRICTIVE 'zz_fotografo_fora' em toda tabela com RLS que o app lê direto (captações, vendas,
--    salas, mural, leads, equipes etc.), exceto as que ele precisa para entrar: o próprio perfil, papéis,
--    vínculo com a imobiliária, imobiliária/módulos, sino, tour, aniversário, suporte e as photo_*.
--  * Os *_enabled() dos outros módulos devolvem false para ele (RPCs SECURITY DEFINER desses módulos recusam).
--  * photo_eh_fotografo, photo_staff_listar e photo_configurar aceitam 'staff' OU 'fotografo' (staff segue igual).
--    photo_eh_fotografo deixa de usar has_role (que agora barra o só-fotógrafo) e confere direto
--    user_roles + perfil ativo + vínculo ativo + imobiliária do contexto (mt_1b_gate), como has_role fazia.
-- As RPCs photo_* são SECURITY DEFINER com dono que ignora RLS: a política nova não as afeta.
-- Rollback: docs/sql/rollback/20261105130100_papel_fotografo.rollback.sql (corpos originais).

-- 1) Quem é "só fotógrafo" --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eh_so_fotografo(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'fotografo')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role <> 'fotografo')
$$;
REVOKE ALL ON FUNCTION public.eh_so_fotografo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_so_fotografo(uuid) TO authenticated, service_role; -- usada pela RLS
COMMENT ON FUNCTION public.eh_so_fotografo(uuid)
  IS 'Usuário com papel fotografo e nenhum outro papel: só enxerga a área de fotos (t_0666d3f0).';

-- 2) Bloqueio central: o só-fotógrafo não é "usuário ativo da agência" --------------------------------------
-- Corpo original (20261002000002_mt_platform_context.sql) + a linha "AND NOT eh_so_fotografo" no caminho
-- normal. O caminho de contexto da plataforma (mt.ctx_pc) fica igual.
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
  IF public.eh_so_fotografo(_user) THEN RETURN false; END IF; -- t_0666d3f0: só-fotógrafo fica fora
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((_in
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$;

-- 3) Fotos aceitam 'staff' ou 'fotografo' -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.photo_eh_fotografo(_org uuid, _uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND _org IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.photo_settings s WHERE s.organization_id = _org AND s.fotografo_id = _uid)
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('staff', 'fotografo'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.ativo IS TRUE)
    AND EXISTS (SELECT 1 FROM public.organization_members m
                 WHERE m.user_id = _uid AND m.organization_id = _org AND m.ativo)
    AND public.mt_1b_gate(_org)
$$;
REVOKE ALL ON FUNCTION public.photo_eh_fotografo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_eh_fotografo(uuid, uuid) TO authenticated; -- usada pela RLS

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
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role IN ('staff', 'fotografo'))), '[]'::jsonb);
END $function$;

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
          AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role IN ('staff', 'fotografo'))) THEN
    RAISE EXCEPTION 'O fotografo precisa ser um usuario staff ou fotografo ativo desta imobiliaria' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_settings (organization_id, fotografo_id, valor_sessao, updated_at, updated_by)
  VALUES (_org, _fotografo, round(_valor, 2), now(), _uid)
  ON CONFLICT (organization_id) DO UPDATE
    SET fotografo_id = EXCLUDED.fotografo_id, valor_sessao = EXCLUDED.valor_sessao, updated_at = now(), updated_by = _uid;
  INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
  VALUES (_org, _uid, 'configuracao', jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2)));
  RETURN jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2));
END $function$;

-- 4) Outros módulos: desligados para o só-fotógrafo ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.achievements_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'mural_conquistas'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'captacao_exclusiva'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.leads_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'leads'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.opportunities_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'oportunidades'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.owner_feedback_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'feedback_proprietario'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.room_reservation_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'reserva_salas'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.academia_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'academia'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$;
-- crm_enabled() já depende de leads_enabled(): não precisa mudar.

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
    AND NOT public.eh_so_fotografo(auth.uid())
  ORDER BY p.nome NULLS LAST, p.id;
$function$;

-- 5) RLS: barreira RESTRICTIVE nas tabelas que o app lê direto ----------------------------------------------
-- Lista tirada do catálogo no momento da migration (tabelas com RLS e SELECT para authenticated), menos as
-- que o fotógrafo precisa para entrar e usar a área de fotos.
DO $$
DECLARE _t text;
BEGIN
  FOR _t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND has_table_privilege('authenticated', c.oid, 'SELECT')
       AND c.relname NOT LIKE 'photo\_%'
       AND c.relname NOT IN ('profiles', 'user_roles', 'organization_members', 'organizations',
                             'organization_modules', 'notifications', 'user_tour_estado', 'profile_birthdates',
                             'support_tickets', 'support_ticket_messages')
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_fotografo_fora ON public.%I', _t);
    EXECUTE format('CREATE POLICY zz_fotografo_fora ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                   'USING (NOT (SELECT public.eh_so_fotografo((SELECT auth.uid())))) '
                   'WITH CHECK (NOT (SELECT public.eh_so_fotografo((SELECT auth.uid()))))', _t);
  END LOOP;
END $$;

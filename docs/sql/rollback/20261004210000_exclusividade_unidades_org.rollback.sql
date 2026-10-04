-- Reverte 20261004210000_exclusividade_unidades_org.sql.
-- Só funciona enquanto nenhuma captação nova (template 'remax-padrao' ou unit_id preenchido)
-- existir; se existir, arquive/decida antes — o bloco abaixo falha fechado.
-- Reversão LEVE (sem rollback): para a Única voltar/sair do PDF antigo basta
--   UPDATE public.exclusive_units SET contrato_antigo = true|false WHERE legacy_template IS NOT NULL;
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.exclusive_captures
    WHERE unit_id IS NOT NULL AND template NOT IN ('campolim','barao-de-tatui'))
  THEN RAISE EXCEPTION 'Há captações no contrato-base; rollback bloqueado'; END IF;
END $$;

DROP POLICY exclusive_templates_read ON storage.objects;
CREATE POLICY exclusive_templates_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'exclusive-templates'
  AND public.mt_1c_relative_path(name) IN ('campolim.pdf','barao-de-tatui.pdf')
  AND public.exclusive_capture_enabled() AND public.exclusive_actor_active(auth.uid())
  AND public.has_any_role(auth.uid(),
    ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
);
CREATE OR REPLACE FUNCTION public.mt_1c_storage_scope(_bucket text, _name text, _new_only boolean DEFAULT false)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $function$
  SELECT COALESCE(public.current_org_id() IS NOT NULL AND _bucket IN
    ('sale-documents','exclusive-captures','exclusive-templates','avatars')
    AND CASE WHEN split_part(_name,'/',1)=public.current_org_id()::text
      THEN public.mt_1c_relative_path(_name) <> ''
      ELSE NOT _new_only AND public.current_org_id()=public.legacy_default_org_id()
        AND CASE _bucket
          WHEN 'sale-documents' THEN EXISTS (SELECT 1 FROM public.sales s
            WHERE s.id::text=split_part(_name,'/',1) AND s.organization_id=public.current_org_id())
          WHEN 'exclusive-captures' THEN EXISTS (SELECT 1 FROM public.exclusive_captures c
            WHERE c.id::text=split_part(_name,'/',1) AND c.organization_id=public.current_org_id())
          WHEN 'avatars' THEN EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id::text=split_part(_name,'/',1) AND p.organization_id=public.current_org_id())
          WHEN 'exclusive-templates' THEN _name IN ('campolim.pdf','barao-de-tatui.pdf')
          ELSE false END END,false)
$function$;

-- exclusive_create volta à versão anterior (com a mensagem do contexto da plataforma).
CREATE OR REPLACE FUNCTION public.exclusive_create(_template text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid; _p public.profiles%ROWTYPE;
BEGIN
  IF NOT public.exclusive_capture_enabled() OR auth.uid() IS NULL OR
    NOT public.has_any_role(auth.uid(), ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[])
  THEN RAISE EXCEPTION 'Captação exclusiva indisponível'; END IF;
  IF _template NOT IN ('campolim','barao-de-tatui') THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = auth.uid() AND ativo;
  IF NOT FOUND AND public.platform_current_org() IS NOT NULL THEN RAISE EXCEPTION 'A captação deve ser criada por um corretor desta imobiliária'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil inativo'; END IF;
  IF nullif(trim(_p.nome),'') IS NULL THEN RAISE EXCEPTION 'Preencha seu nome no perfil antes de criar'; END IF;
  INSERT INTO public.exclusive_captures(captor_id,created_by,template,broker_name,broker_cpf,broker_creci)
  VALUES (auth.uid(),auth.uid(),_template,_p.nome,coalesce(_p.cpf,''),coalesce(_p.creci,'')) RETURNING id INTO _id;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'criada',nullif(concat_ws(',',
      CASE WHEN _p.cpf IS NOT NULL THEN 'CPF:perfil' END,
      CASE WHEN _p.creci IS NOT NULL THEN 'CRECI:perfil' END),''));
  RETURN _id;
END $$;

DROP FUNCTION public.exclusive_unit_save(uuid, jsonb);
DROP FUNCTION public.exclusive_create_unit(uuid);
ALTER TABLE public.exclusive_captures DROP CONSTRAINT exclusive_captures_template_check;
UPDATE public.exclusive_captures SET unit_id = NULL WHERE unit_id IS NOT NULL;
ALTER TABLE public.exclusive_captures ADD CONSTRAINT exclusive_captures_template_check
  CHECK (template IN ('campolim','barao-de-tatui'));
DROP INDEX public.exclusive_captures_unit_idx;
ALTER TABLE public.exclusive_captures DROP CONSTRAINT exclusive_captures_unit_org_fk;
ALTER TABLE public.exclusive_captures DROP COLUMN unit_id;
DROP TABLE public.exclusive_units;
COMMIT;

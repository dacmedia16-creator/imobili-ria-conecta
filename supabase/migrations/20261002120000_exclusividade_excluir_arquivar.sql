-- Decisão Denis 02/10/2026: limpar captações exclusivas da lista.
-- EXCLUIR: só rascunho que nunca teve contrato (sem PDF gerado/assinado). Exclusão lógica:
--   discarded_at some da lista e de toda leitura (exclusive_can_view), mas a linha, o histórico
--   e os arquivos ficam guardados para auditoria. Não há botão de restaurar.
-- ARQUIVAR / DESARQUIVAR: captação com contrato gerado ou já fora do rascunho. Reversível.
--   Arquivada não pode ser editada (exclusive_is_editor) até ser desarquivada.
-- Quem pode: quem já vê a captação (captador, líder da equipe, admin, super_admin).
-- Tudo grava exclusive_history. Sem DML de dados existentes.
-- Rollback: docs/sql/rollback/20261002120000_exclusividade_excluir_arquivar.rollback.sql
BEGIN;
ALTER TABLE public.exclusive_captures
  ADD COLUMN archived_at timestamptz, ADD COLUMN archived_by uuid,
  ADD COLUMN discarded_at timestamptz, ADD COLUMN discarded_by uuid;

CREATE OR REPLACE FUNCTION public.exclusive_can_view(_id uuid, _actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.exclusive_capture_enabled() AND public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c
    WHERE c.id = _id AND c.discarded_at IS NULL AND (
      c.captor_id = _actor
      OR public.has_any_role(_actor, ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_actor, ARRAY['gestor','team_leader']::public.app_role[])
          AND public.is_lead_of(_actor, c.captor_id))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$
;

CREATE OR REPLACE FUNCTION public.exclusive_is_editor(_id uuid, _actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.exclusive_can_view(_id, _actor) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c WHERE c.id = _id
      AND c.status IN ('rascunho','devolvida') AND c.archived_at IS NULL
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$
;

CREATE FUNCTION public.exclusive_archive(_id uuid, _action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _contract boolean;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  _contract := _c.status <> 'rascunho' OR EXISTS (SELECT 1 FROM public.exclusive_documents
    WHERE capture_id = _id AND kind IN ('gerado','assinado'));
  IF _action = 'excluir' THEN
    IF _contract THEN RAISE EXCEPTION 'Captação com contrato gerado não pode ser excluída; use Arquivar'; END IF;
    UPDATE public.exclusive_captures SET discarded_at = now(), discarded_by = auth.uid(), updated_at = now() WHERE id = _id;
  ELSIF _action = 'arquivar' THEN
    IF NOT _contract THEN RAISE EXCEPTION 'Rascunho sem contrato: use Excluir'; END IF;
    IF _c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Captação já arquivada'; END IF;
    UPDATE public.exclusive_captures SET archived_at = now(), archived_by = auth.uid(), updated_at = now() WHERE id = _id;
  ELSIF _action = 'desarquivar' THEN
    IF _c.archived_at IS NULL THEN RAISE EXCEPTION 'Captação não está arquivada'; END IF;
    UPDATE public.exclusive_captures SET archived_at = NULL, archived_by = NULL, updated_at = now() WHERE id = _id;
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action) VALUES (_id, auth.uid(), _action);
END $function$;
-- Mesmo padrão da fase 1b: CREATE temporário só para o ALTER OWNER, revogado em seguida.
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_archive(uuid, text) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_archive(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_archive(uuid, text) TO authenticated, service_role;
COMMIT;

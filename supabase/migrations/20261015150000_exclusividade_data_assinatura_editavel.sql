-- Data de assinatura editável (card t_f19b654f, escopo ampliado por Denis em 15/10/2026).
-- Antes: só gestor; data mínima = created_on_sp (exceto manual). Como nenhuma tela marca captação
-- como manual, contrato assinado antes do cadastro não era aceito e a vigência/alerta ficavam errados.
-- Agora:
--   * data entre 2000-01-01 e hoje (America/Sao_Paulo), sem depender de manual; futuro continua proibido;
--   * gestor (exclusive_is_manager): enviada, em_assinatura e aprovada (como antes);
--   * corretor captador (captor_id = auth.uid() e exclusive_can_view): só antes da aprovação
--     (enviada ou em_assinatura); depois de aprovada só o gestor corrige;
--   * toda alteração continua gravando 'data_assinatura' em exclusive_history com o autor.
-- A aprovação NÃO muda (exclusive_transition intocada). Rollback: supabase/rollback/20261015150000_….sql
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_set_signed_on(_id uuid, _date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _uid uuid := auth.uid(); _gestor boolean; _captor boolean;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  _gestor := public.exclusive_is_manager(_id, _uid);
  _captor := _c.captor_id = _uid AND public.exclusive_can_view(_id, _uid);
  IF NOT (_gestor OR _captor) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  IF _c.status NOT IN ('enviada','em_assinatura','aprovada') THEN RAISE EXCEPTION 'Captação ainda não foi enviada'; END IF;
  IF _c.status = 'aprovada' AND NOT _gestor THEN
    RAISE EXCEPTION 'Captação aprovada: só o gestor corrige a data de assinatura';
  END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR _date < date '2000-01-01'
  THEN RAISE EXCEPTION 'Data de assinatura inválida'; END IF;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, _uid, 'data_assinatura', to_char(_date, 'DD/MM/YYYY'));
END $function$;

-- CREATE OR REPLACE mantém o dono atual (como em 20261008160000); só os grants são reafirmados.
REVOKE ALL ON FUNCTION public.exclusive_set_signed_on(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_set_signed_on(uuid, date) TO authenticated, service_role;

COMMIT;

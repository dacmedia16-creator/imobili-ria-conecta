-- Rollback de 20261015150000_exclusividade_data_assinatura_editavel.sql
-- Restaura exclusive_set_signed_on como em 20261008160000 (só gestor; mínimo = created_on_sp, exceto manual).
-- Datas já gravadas (signed_on) e o histórico continuam como estão. Fazer junto com o rollback do
-- frontend (a tela do corretor chamaria a RPC e receberia "Ação não permitida").
-- Depois de rodar, remover a linha 20261015150000 de supabase_migrations.schema_migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_set_signed_on(_id uuid, _date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _min date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_is_manager(_id, auth.uid()) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  IF _c.status NOT IN ('enviada','em_assinatura','aprovada') THEN RAISE EXCEPTION 'Captação ainda não foi enviada'; END IF;
  -- Manual: contrato assinado antes do cadastro no sistema; a data pode ser anterior à criação.
  -- (variável à parte: o IF do plpgsql corta a condição no primeiro THEN, inclusive o de um CASE)
  _min := _c.created_on_sp;
  IF _c.manual THEN _min := date '2000-01-01'; END IF;
  IF _date IS NULL OR _date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR _date < _min
  THEN RAISE EXCEPTION 'Data de assinatura inválida'; END IF;
  UPDATE public.exclusive_captures SET signed_on = _date, updated_at = now() WHERE id = _id;
  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, auth.uid(), 'data_assinatura', to_char(_date, 'DD/MM/YYYY'));
END $function$;

REVOKE ALL ON FUNCTION public.exclusive_set_signed_on(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_set_signed_on(uuid, date) TO authenticated, service_role;

COMMIT;

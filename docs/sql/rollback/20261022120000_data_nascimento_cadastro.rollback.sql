-- Rollback de 20261022120000_data_nascimento_cadastro.sql (t_dff88e75).
-- Remove as RPCs da gestão e devolve profile_set_birthdate à versão do Mural (sem idade mínima).
-- NÃO apaga a tabela public.profile_birthdates nem as datas já gravadas (são do Mural de Conquistas).
BEGIN;

DROP FUNCTION IF EXISTS public.profile_birthdate_set_for_user(uuid, date);
DROP FUNCTION IF EXISTS public.profile_birthdate_get_for_user(uuid);
DROP FUNCTION IF EXISTS public.profile_birthdate_can_manage(uuid);

CREATE OR REPLACE FUNCTION public.profile_set_birthdate(_data date) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF _data IS NULL THEN
    DELETE FROM public.profile_birthdates WHERE user_id = _uid;
    RETURN NULL;
  END IF;
  IF _data < DATE '1900-01-01' OR _data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_uid, _data)
  ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now();
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_set_birthdate(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_birthdate(date) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.profile_birthdate_valida(date);

COMMIT;

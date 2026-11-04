-- Rollback de 20261104170000_comemora_aniversario_pergunta_login (t_05a37081). Volta
-- profile_set_birthdate e ficha_salvar_minha EXATAMENTE como na 20261104150000, remove as RPCs da
-- janela e a coluna comemora_respondido_em. A escolha Sim/Não (comemora_aniversario) de cada pessoa
-- é mantida. Efeito: a janela deixa de aparecer (o front novo trata a falta da RPC como "não perguntar").
BEGIN;

DROP FUNCTION IF EXISTS public.comemora_responder(boolean);
DROP FUNCTION IF EXISTS public.comemora_pergunta_pendente();

CREATE OR REPLACE FUNCTION public.profile_set_birthdate(_data date, _comemora boolean DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF _data IS NULL THEN
    DELETE FROM public.profile_birthdates WHERE user_id = _uid;
    RETURN NULL;
  END IF;
  IF NOT public.profile_birthdate_valida(_data) THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profile_birthdates AS b (user_id, data_nascimento, comemora_aniversario)
  VALUES (_uid, _data, coalesce(_comemora, true))
  ON CONFLICT (user_id) DO UPDATE SET
    data_nascimento = EXCLUDED.data_nascimento,
    comemora_aniversario = coalesce(_comemora, b.comemora_aniversario),
    updated_at = now();
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_set_birthdate(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_birthdate(date, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ficha_salvar_minha(
  _qtd_filhos integer,
  _tem_plano_saude boolean,
  _plano_saude text,
  _emergencia_nome text,
  _emergencia_parentesco text,
  _emergencia_telefone text,
  _hospital_preferencia text,
  _religiao text,
  _data_nascimento date,
  _ciente boolean,
  _filhos_faixas text[] DEFAULT NULL,
  _comemora_aniversario boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _plano text := nullif(btrim(regexp_replace(coalesce(_plano_saude, ''), '\s+', ' ', 'g')), '');
  _en text := nullif(btrim(regexp_replace(coalesce(_emergencia_nome, ''), '\s+', ' ', 'g')), '');
  _ep text := nullif(btrim(regexp_replace(coalesce(_emergencia_parentesco, ''), '\s+', ' ', 'g')), '');
  _et text := nullif(btrim(coalesce(_emergencia_telefone, '')), '');
  _hosp text := nullif(btrim(regexp_replace(coalesce(_hospital_preferencia, ''), '\s+', ' ', 'g')), '');
  _rel text := nullif(btrim(regexp_replace(coalesce(_religiao, ''), '\s+', ' ', 'g')), '');
  _dig integer;
  _faixas_ok constant text[] := ARRAY['0-5', '6-10', '11-15', '16+'];
  _faixas text[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'A ficha so pode ser preenchida pela propria pessoa' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem imobiliaria ativa' USING ERRCODE = '42501'; END IF;

  IF _ciente IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirme que leu o aviso de uso dos dados' USING ERRCODE = '22023';
  END IF;
  IF _qtd_filhos IS NULL OR _qtd_filhos < 0 OR _qtd_filhos > 30 THEN
    RAISE EXCEPTION 'Quantidade de filhos invalida' USING ERRCODE = '22023';
  END IF;
  IF _filhos_faixas IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(_filhos_faixas) x WHERE x IS NULL OR NOT (x = ANY (_faixas_ok))) THEN
      RAISE EXCEPTION 'Faixa de idade dos filhos invalida' USING ERRCODE = '22023';
    END IF;
    -- Sem repetidos, na ordem da lista.
    SELECT coalesce(array_agg(o.f ORDER BY o.n), ARRAY[]::text[]) INTO _faixas
      FROM unnest(_faixas_ok) WITH ORDINALITY AS o(f, n)
     WHERE o.f = ANY (_filhos_faixas);
  END IF;
  IF _tem_plano_saude IS NULL THEN
    RAISE EXCEPTION 'Informe se tem plano de saude' USING ERRCODE = '22023';
  END IF;
  IF _tem_plano_saude AND (_plano IS NULL OR char_length(_plano) < 2 OR char_length(_plano) > 120) THEN
    RAISE EXCEPTION 'Informe qual e o plano de saude' USING ERRCODE = '22023';
  END IF;
  IF NOT _tem_plano_saude THEN _plano := NULL; END IF;
  IF _en IS NULL OR char_length(_en) < 2 OR char_length(_en) > 120 THEN
    RAISE EXCEPTION 'Informe o nome do contato de emergencia' USING ERRCODE = '22023';
  END IF;
  IF _ep IS NULL OR char_length(_ep) < 2 OR char_length(_ep) > 60 THEN
    RAISE EXCEPTION 'Informe o parentesco do contato de emergencia' USING ERRCODE = '22023';
  END IF;
  _dig := char_length(regexp_replace(coalesce(_et, ''), '\D', '', 'g'));
  IF _dig < 10 OR _dig > 13 OR char_length(_et) > 20 OR _et !~ '^[0-9()+\-. ]+$' THEN
    RAISE EXCEPTION 'Telefone de emergencia invalido (com DDD)' USING ERRCODE = '22023';
  END IF;
  IF _hosp IS NULL OR char_length(_hosp) < 2 OR char_length(_hosp) > 160 THEN
    RAISE EXCEPTION 'Informe o hospital de preferencia' USING ERRCODE = '22023';
  END IF;
  IF _rel IS NOT NULL AND char_length(_rel) > 60 THEN
    RAISE EXCEPTION 'Religiao muito longa' USING ERRCODE = '22023';
  END IF;
  IF NOT public.profile_birthdate_valida(_data_nascimento) THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;

  -- Comemora aniversário: NULL (tela antiga) mantém o que já estava; registro novo nasce "Sim".
  INSERT INTO public.profile_birthdates AS b (user_id, data_nascimento, comemora_aniversario)
  VALUES (_uid, _data_nascimento, coalesce(_comemora_aniversario, true))
  ON CONFLICT (user_id) DO UPDATE SET
    data_nascimento = EXCLUDED.data_nascimento,
    comemora_aniversario = coalesce(_comemora_aniversario, b.comemora_aniversario),
    updated_at = now()
    WHERE b.data_nascimento IS DISTINCT FROM EXCLUDED.data_nascimento
       OR b.comemora_aniversario IS DISTINCT FROM coalesce(_comemora_aniversario, b.comemora_aniversario);

  INSERT INTO public.colaborador_fichas AS f (user_id, organization_id, qtd_filhos, filhos_faixas,
      tem_plano_saude, plano_saude, emergencia_nome, emergencia_parentesco, emergencia_telefone,
      hospital_preferencia, religiao)
  VALUES (_uid, _org, _qtd_filhos,
      CASE WHEN _qtd_filhos = 0 THEN ARRAY[]::text[] ELSE coalesce(_faixas, ARRAY[]::text[]) END,
      _tem_plano_saude, _plano, _en, _ep, _et, _hosp, _rel)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    qtd_filhos = EXCLUDED.qtd_filhos,
    -- 0 filhos limpa; NULL (tela antiga) mantém o que já estava.
    filhos_faixas = CASE WHEN EXCLUDED.qtd_filhos = 0 THEN ARRAY[]::text[]
                         ELSE coalesce(_faixas, f.filhos_faixas) END,
    tem_plano_saude = EXCLUDED.tem_plano_saude,
    plano_saude = EXCLUDED.plano_saude,
    emergencia_nome = EXCLUDED.emergencia_nome,
    emergencia_parentesco = EXCLUDED.emergencia_parentesco,
    emergencia_telefone = EXCLUDED.emergencia_telefone,
    hospital_preferencia = EXCLUDED.hospital_preferencia,
    religiao = EXCLUDED.religiao,
    updated_at = now();

  RETURN public.ficha_minha_situacao();
END $$;
REVOKE ALL ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean, text[], boolean) TO authenticated;

ALTER TABLE public.profile_birthdates DROP COLUMN IF EXISTS comemora_respondido_em;

NOTIFY pgrst, 'reload schema';
COMMIT;

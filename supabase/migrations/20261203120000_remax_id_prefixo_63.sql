-- ID RE/MAX: aceita 9 digitos comecando com 63 (630, 631...), antes so 630.
-- Pedido de Denis 18/11 (t_e60b5acc): corretor de outra RE/MAX com ID 631xxxxxx.
-- Muda SO o padrao nas 3 funcoes; 9 digitos (CHECK) e unicidade entre ativos seguem iguais.
-- Corpos copiados da producao em 18/11. Reversao: docs/sql/rollback/20261203120000_remax_id_prefixo_63.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.cadastro_pendencias(_uid uuid, _org uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _p record;
  _r text[] := ARRAY[]::text[];
  _tel integer;
BEGIN
  SELECT p.nome, p.telefone, p.cpf, p.remax_id INTO _p FROM public.profiles p WHERE p.id = _uid;
  IF NOT FOUND THEN RETURN _r; END IF;
  IF cardinality(array_remove(regexp_split_to_array(
       btrim(regexp_replace(coalesce(_p.nome, ''), '\s+', ' ', 'g')), ' '), '')) < 2 THEN
    _r := _r || 'nome'::text;
  END IF;
  _tel := char_length(regexp_replace(coalesce(_p.telefone, ''), '\D', '', 'g'));
  IF _tel < 10 OR _tel > 13 THEN _r := _r || 'telefone'::text; END IF;
  IF public.cadastro_exige_registro(_uid, _org) THEN
    IF _p.cpf IS NULL OR NOT public.exclusive_valid_cpf(_p.cpf) THEN _r := _r || 'cpf'::text; END IF;
    IF _p.remax_id IS NULL OR btrim(_p.remax_id) = '' THEN
      _r := _r || 'remax_id'::text;
    ELSIF _p.remax_id !~ '^63[0-9]{7}$' THEN
      _r := _r || 'remax_id_invalido'::text;
    ELSIF EXISTS (SELECT 1 FROM public.profiles o
                   WHERE o.remax_id = _p.remax_id AND o.id <> _uid AND o.ativo IS TRUE) THEN
      _r := _r || 'remax_id_duplicado'::text;
    END IF;
  END IF;
  RETURN _r;
EXCEPTION WHEN others THEN
  RETURN ARRAY[]::text[];
END $function$;

CREATE OR REPLACE FUNCTION public.cadastro_salvar_meu(_nome text, _telefone text, _cpf text, _remax_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _exige boolean;
  _n text := nullif(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), '');
  _t text := nullif(btrim(coalesce(_telefone, '')), '');
  _c text := nullif(regexp_replace(coalesce(_cpf, ''), '\D', '', 'g'), '');
  _r text := nullif(regexp_replace(coalesce(_remax_id, ''), '\D', '', 'g'), '');
  _dig integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'O cadastro so pode ser atualizado pela propria pessoa' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Sem imobiliaria ativa' USING ERRCODE = '42501'; END IF;
  _exige := public.cadastro_exige_registro(_uid, _org);

  IF _n IS NOT NULL AND (cardinality(array_remove(regexp_split_to_array(_n, ' '), '')) < 2
                         OR char_length(_n) > 160) THEN
    RAISE EXCEPTION 'Informe o nome completo' USING ERRCODE = '22023';
  END IF;
  IF _t IS NOT NULL THEN
    _dig := char_length(regexp_replace(_t, '\D', '', 'g'));
    IF _dig < 10 OR _dig > 13 OR char_length(_t) > 20 OR _t !~ '^[0-9()+\-. ]+$' THEN
      RAISE EXCEPTION 'Telefone invalido (com DDD)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT _exige THEN
    _c := NULL;
    _r := NULL;
  END IF;
  IF _c IS NOT NULL THEN
    IF char_length(_c) <> 11 THEN RAISE EXCEPTION 'CPF invalido' USING ERRCODE = '22023'; END IF;
    _c := substr(_c, 1, 3) || '.' || substr(_c, 4, 3) || '.' || substr(_c, 7, 3) || '-' || substr(_c, 10, 2);
    IF NOT public.exclusive_valid_cpf(_c) THEN RAISE EXCEPTION 'CPF invalido' USING ERRCODE = '22023'; END IF;
  END IF;
  IF _r IS NOT NULL THEN
    IF _r !~ '^63[0-9]{7}$' THEN
      RAISE EXCEPTION 'ID RE/MAX invalido: sao 9 numeros comecando com 63' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles o WHERE o.remax_id = _r AND o.id <> _uid AND o.ativo IS TRUE) THEN
      RAISE EXCEPTION 'ID RE/MAX ja esta em outro cadastro' USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.profiles p SET
    nome = coalesce(_n, p.nome),
    telefone = coalesce(_t, p.telefone),
    cpf = coalesce(_c, p.cpf),
    remax_id = coalesce(_r, p.remax_id)
  WHERE p.id = _uid
    AND (p.nome IS DISTINCT FROM coalesce(_n, p.nome)
      OR p.telefone IS DISTINCT FROM coalesce(_t, p.telefone)
      OR p.cpf IS DISTINCT FROM coalesce(_c, p.cpf)
      OR p.remax_id IS DISTINCT FROM coalesce(_r, p.remax_id));

  RETURN public.ficha_minha_situacao();
END $function$;

CREATE OR REPLACE FUNCTION public.profiles_remax_id_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.remax_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.remax_id IS DISTINCT FROM OLD.remax_id)
     AND NEW.remax_id !~ '^63[0-9]{7}$' THEN
    RAISE EXCEPTION 'ID RE/MAX invalido: sao 9 numeros comecando com 63' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;

COMMIT;

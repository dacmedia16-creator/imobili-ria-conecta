-- "Comemora aniversário?" no próximo login para quem já tinha data (t_05a37081, Denis 04/11/2026,
-- tópico 6238). Base: 20261104150000_comemora_aniversario (no ar).
--
-- Regras:
--   * coluna nova profile_birthdates.comemora_respondido_em (NULL = a pessoa nunca escolheu);
--   * só a PRÓPRIA pessoa marca como respondido: janela do login (comemora_responder), Meu acesso /
--     1º acesso (profile_set_birthdate com a escolha) e ficha (ficha_salvar_minha com a escolha).
--     A gestão (profile_birthdate_set_for_user) não marca. Chamada antiga, sem a escolha, não marca;
--   * enquanto não responde, continua valendo comemora_aniversario (Sim por padrão): o mural não muda;
--   * quem vê a janela (comemora_pergunta_pendente): perfil ativo, membro ativo da imobiliária atual,
--     com data cadastrada e sem resposta. Nunca na visão da plataforma, no "Entrar como" nem para o
--     dono da plataforma;
--   * carga inicial: conta como respondido quem gravou a data pela tela nova (depois do deploy do
--     PR #265) ou já está "Não", exceto se a última gravação foi da gestão.
--
-- Rollback: docs/sql/rollback/20261104170000_comemora_aniversario_pergunta_login.rollback.sql
-- Sem BEGIN/COMMIT próprios (o teste a inclui numa transação desfeita).

-- 1) Coluna -------------------------------------------------------------------------------------------
ALTER TABLE public.profile_birthdates ADD COLUMN IF NOT EXISTS comemora_respondido_em timestamptz;
COMMENT ON COLUMN public.profile_birthdates.comemora_respondido_em IS
  'Quando a própria pessoa respondeu "Você comemora aniversário?". NULL = nunca respondeu: a pergunta aparece uma vez depois do login (t_05a37081).';

-- 2) Carga inicial ---------------------------------------------------------------------------------------
-- shortcut: o banco não guardava "quem escolheu"; usa a última gravação (updated_at) depois do deploy
-- da tela nova, ou a escolha "Não", e tira quem foi gravado pela gestão naquele instante.
UPDATE public.profile_birthdates b
   SET comemora_respondido_em = b.updated_at
 WHERE b.comemora_respondido_em IS NULL
   AND (NOT b.comemora_aniversario OR b.updated_at >= timestamptz '2026-11-04 18:08:26+00')
   AND NOT EXISTS (
     SELECT 1 FROM public.activity_logs a
      WHERE a.acao IN ('user_birthdate_set', 'user_birthdate_set_platform_context')
        AND a.payload->>'target_user' = b.user_id::text
        AND a.created_at BETWEEN b.updated_at - interval '5 seconds' AND b.updated_at + interval '5 seconds');

-- 3) Própria pessoa: Meu acesso / 1º acesso (resto igual à 20261104150000) --------------------------------
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
  -- Escolha enviada (tela nova) = a pessoa respondeu (t_05a37081); NULL (tela antiga) não marca.
  INSERT INTO public.profile_birthdates AS b (user_id, data_nascimento, comemora_aniversario,
      comemora_respondido_em)
  VALUES (_uid, _data, coalesce(_comemora, true), CASE WHEN _comemora IS NOT NULL THEN now() END)
  ON CONFLICT (user_id) DO UPDATE SET
    data_nascimento = EXCLUDED.data_nascimento,
    comemora_aniversario = coalesce(_comemora, b.comemora_aniversario),
    comemora_respondido_em = CASE WHEN _comemora IS NULL THEN b.comemora_respondido_em
                                  ELSE coalesce(b.comemora_respondido_em, now()) END,
    updated_at = now();
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_set_birthdate(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_birthdate(date, boolean) TO authenticated, service_role;

-- 4) Ficha do colaborador (resto igual à 20261104150000) ---------------------------------------------------
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
  -- Escolha enviada (tela nova) = a pessoa respondeu (t_05a37081); NULL (tela antiga) não marca.
  INSERT INTO public.profile_birthdates AS b (user_id, data_nascimento, comemora_aniversario,
      comemora_respondido_em)
  VALUES (_uid, _data_nascimento, coalesce(_comemora_aniversario, true),
          CASE WHEN _comemora_aniversario IS NOT NULL THEN now() END)
  ON CONFLICT (user_id) DO UPDATE SET
    data_nascimento = EXCLUDED.data_nascimento,
    comemora_aniversario = coalesce(_comemora_aniversario, b.comemora_aniversario),
    comemora_respondido_em = CASE WHEN _comemora_aniversario IS NULL THEN b.comemora_respondido_em
                                  ELSE coalesce(b.comemora_respondido_em, now()) END,
    updated_at = now()
    WHERE b.data_nascimento IS DISTINCT FROM EXCLUDED.data_nascimento
       OR b.comemora_aniversario IS DISTINCT FROM coalesce(_comemora_aniversario, b.comemora_aniversario)
       OR (_comemora_aniversario IS NOT NULL AND b.comemora_respondido_em IS NULL);

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

-- 5) A janela aparece? ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comemora_pergunta_pendente() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  -- Visão da plataforma e "Entrar como": quem está na tela não é a pessoa.
  IF public.ficha_sessao_restrita() THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _uid) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profile_birthdates b
      JOIN public.profiles p ON p.id = b.user_id AND p.ativo IS TRUE
      JOIN public.organization_members m ON m.user_id = b.user_id AND m.ativo
                                         AND m.organization_id = public.current_org_id()
     WHERE b.user_id = _uid AND b.comemora_respondido_em IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.comemora_pergunta_pendente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comemora_pergunta_pendente() TO authenticated;

-- 6) Resposta da janela (só a própria pessoa; precisa já ter data) --------------------------------------------
CREATE OR REPLACE FUNCTION public.comemora_responder(_comemora boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RAISE EXCEPTION 'So a propria pessoa responde' USING ERRCODE = '42501';
  END IF;
  IF _comemora IS NULL THEN RAISE EXCEPTION 'Resposta invalida' USING ERRCODE = '22023'; END IF;
  UPDATE public.profile_birthdates
     SET comemora_aniversario = _comemora, comemora_respondido_em = now(), updated_at = now()
   WHERE user_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sem data de nascimento cadastrada' USING ERRCODE = 'P0002';
  END IF;
  RETURN _comemora;
END $$;
REVOKE ALL ON FUNCTION public.comemora_responder(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comemora_responder(boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

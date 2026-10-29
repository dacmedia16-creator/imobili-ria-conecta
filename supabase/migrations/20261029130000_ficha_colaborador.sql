-- Ficha pessoal e de emergência de cada colaborador + tela do staff "Ficha dos colaboradores"
-- (t_618b64bc, pedido de Denis em 29/10/2026, tópico 6238).
--
-- Campos: nº de filhos, plano de saúde (sim/não + qual), contato de emergência (nome, parentesco,
-- telefone), hospital de preferência, religião (OPCIONAL) e data de nascimento (reaproveita
-- public.profile_birthdates; na ficha passa a ser obrigatória).
--
-- LGPD: religião é dado sensível e plano/hospital são ligados à saúde. Por isso:
--   * tabela própria (fora de profiles), RLS ligada e NENHUM acesso direto (nem SELECT) para
--     anon/authenticated: tudo passa por RPCs SECURITY DEFINER com search_path vazio;
--   * a própria pessoa lê/grava a sua ficha (ficha_minha_situacao / ficha_salvar_minha);
--   * staff, admin e administrador principal (super_admin) leem as fichas da MESMA imobiliária
--     (ficha_colaboradores_listar); gestor, team leader e corretores não leem;
--   * visão da plataforma (super-admin dentro de uma imobiliária, papéis virtuais) e sessão de
--     "Entrar como" (impersonação operacional) NUNCA leem nem gravam ficha (ficha_sessao_restrita);
--   * exportação registrada em activity_logs só com formato e total (sem dados pessoais).
--
-- Obrigatoriedade (ajuste de Denis 29/10 01:24): a tela aparece já ao logar com "Preencher depois";
-- a partir de ficha_config.obrigatoria_a_partir_de (por imobiliária; padrão 30/10/2026 01:30 em
-- America/Sao_Paulo) o sistema só libera depois de salvar. A comparação usa now() do BANCO
-- (nunca o relógio do navegador) e não depende de cron.
--
-- Rollback: docs/sql/rollback/20261029130000_ficha_colaborador.rollback.sql
-- Sem BEGIN/COMMIT próprios (igual às migrations recentes): o teste a inclui numa transação desfeita.

-- 1) Tabelas ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.colaborador_fichas (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  qtd_filhos integer NOT NULL CHECK (qtd_filhos BETWEEN 0 AND 30),
  tem_plano_saude boolean NOT NULL,
  plano_saude text CHECK (plano_saude IS NULL OR char_length(plano_saude) <= 120),
  emergencia_nome text NOT NULL CHECK (char_length(emergencia_nome) BETWEEN 2 AND 120),
  emergencia_parentesco text NOT NULL CHECK (char_length(emergencia_parentesco) BETWEEN 2 AND 60),
  emergencia_telefone text NOT NULL CHECK (char_length(emergencia_telefone) BETWEEN 10 AND 20),
  hospital_preferencia text NOT NULL CHECK (char_length(hospital_preferencia) BETWEEN 2 AND 160),
  religiao text CHECK (religiao IS NULL OR char_length(religiao) <= 60),
  -- Aceite do aviso de finalidade: primeira vez e última confirmação.
  aceite_em timestamptz NOT NULL DEFAULT now(),
  preenchida_em timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT colaborador_fichas_plano_qual CHECK (
    (tem_plano_saude AND plano_saude IS NOT NULL AND char_length(btrim(plano_saude)) >= 2)
    OR (NOT tem_plano_saude AND plano_saude IS NULL))
);
CREATE INDEX IF NOT EXISTS colaborador_fichas_org_idx ON public.colaborador_fichas (organization_id, user_id);
ALTER TABLE public.colaborador_fichas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.colaborador_fichas FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.colaborador_fichas IS
  'Ficha pessoal/emergência (LGPD: religião sensível; plano/hospital = saúde). Sem acesso direto: só RPCs ficha_*.';

CREATE TABLE IF NOT EXISTS public.ficha_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  obrigatoria_a_partir_de timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.ficha_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ficha_config FROM PUBLIC, anon, authenticated;

-- 2) Helpers ---------------------------------------------------------------------------------------
-- Padrão quando a imobiliária não tem linha em ficha_config: 30/10/2026 01:30 (São Paulo).
CREATE OR REPLACE FUNCTION public.ficha_obrigatoria_desde(_org uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(
    (SELECT c.obrigatoria_a_partir_de FROM public.ficha_config c WHERE c.organization_id = _org),
    timestamptz '2026-10-30 01:30:00 America/Sao_Paulo')
$$;
REVOKE ALL ON FUNCTION public.ficha_obrigatoria_desde(uuid) FROM PUBLIC, anon, authenticated;

-- Visão da plataforma ou sessão de "Entrar como": nunca lê nem grava ficha (não vaza dado sensível
-- para quem está operando a conta de outra pessoa). Qualquer status da sessão conta: o login foi
-- criado para a impersonação.
CREATE OR REPLACE FUNCTION public.ficha_sessao_restrita() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _sid uuid;
BEGIN
  IF public.mt_pc_in_context() THEN RETURN true; END IF;
  BEGIN
    _sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN _sid := NULL;
  END;
  IF _sid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.operational_impersonation_sessions s
     WHERE s.auth_session_id = _sid AND s.target_user_id = auth.uid()) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.ficha_sessao_restrita() FROM PUBLIC, anon, authenticated;

-- Regra única de "ficha completa" (data de nascimento vem de profile_birthdates).
CREATE OR REPLACE FUNCTION public.ficha_esta_completa(_f public.colaborador_fichas, _nasc date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT _f.user_id IS NOT NULL
     AND _nasc IS NOT NULL
     AND _f.qtd_filhos IS NOT NULL AND _f.qtd_filhos >= 0
     AND _f.tem_plano_saude IS NOT NULL
     AND (NOT _f.tem_plano_saude OR char_length(btrim(coalesce(_f.plano_saude, ''))) >= 2)
     AND char_length(btrim(coalesce(_f.emergencia_nome, ''))) >= 2
     AND char_length(btrim(coalesce(_f.emergencia_parentesco, ''))) >= 2
     AND char_length(regexp_replace(coalesce(_f.emergencia_telefone, ''), '\D', '', 'g')) BETWEEN 10 AND 13
     AND char_length(btrim(coalesce(_f.hospital_preferencia, ''))) >= 2
$$;
REVOKE ALL ON FUNCTION public.ficha_esta_completa(public.colaborador_fichas, date) FROM PUBLIC, anon, authenticated;

-- Quem pode ver as fichas da imobiliária atual (staff, admin, administrador principal).
CREATE OR REPLACE FUNCTION public.ficha_pode_ver_colaboradores() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR public.current_org_id() IS NULL THEN RETURN false; END IF;
  IF public.ficha_sessao_restrita() THEN RETURN false; END IF;
  RETURN public.has_any_role(_uid, ARRAY['staff', 'admin', 'super_admin']::public.app_role[]);
END $$;
REVOKE ALL ON FUNCTION public.ficha_pode_ver_colaboradores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_pode_ver_colaboradores() TO authenticated;

-- 3) Própria pessoa --------------------------------------------------------------------------------
-- Situação da ficha de quem está logado. "bloqueia" é decidido aqui, com o relógio do banco.
CREATE OR REPLACE FUNCTION public.ficha_minha_situacao() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _desde timestamptz;
  _f public.colaborador_fichas;
  _nasc date;
  _completa boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF public.ficha_sessao_restrita() THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'sessao_restrita');
  END IF;
  -- Conta do dono da plataforma não preenche ficha de imobiliária (mesma exceção dos outros porteiros).
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _uid) THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'plataforma');
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RETURN jsonb_build_object('aplica', false, 'motivo', 'sem_imobiliaria'); END IF;

  _desde := public.ficha_obrigatoria_desde(_org);
  SELECT * INTO _f FROM public.colaborador_fichas WHERE user_id = _uid;
  SELECT b.data_nascimento INTO _nasc FROM public.profile_birthdates b WHERE b.user_id = _uid;
  _completa := public.ficha_esta_completa(_f, _nasc);

  RETURN jsonb_build_object(
    'aplica', true,
    'completa', _completa,
    'obrigatoria_a_partir_de', _desde,
    'bloqueia', NOT _completa AND now() >= _desde,
    'data_nascimento', _nasc,
    'ficha', CASE WHEN _f.user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'qtd_filhos', _f.qtd_filhos,
      'tem_plano_saude', _f.tem_plano_saude,
      'plano_saude', _f.plano_saude,
      'emergencia_nome', _f.emergencia_nome,
      'emergencia_parentesco', _f.emergencia_parentesco,
      'emergencia_telefone', _f.emergencia_telefone,
      'hospital_preferencia', _f.hospital_preferencia,
      'religiao', _f.religiao,
      'aceite_em', _f.aceite_em,
      'preenchida_em', _f.preenchida_em,
      'updated_at', _f.updated_at) END);
END $$;
REVOKE ALL ON FUNCTION public.ficha_minha_situacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_minha_situacao() TO authenticated;

-- Grava a própria ficha (e a data de nascimento). Valida tudo no banco; exige o aceite do aviso.
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
  _ciente boolean
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

  INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_uid, _data_nascimento)
  ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now()
    WHERE public.profile_birthdates.data_nascimento IS DISTINCT FROM EXCLUDED.data_nascimento;

  INSERT INTO public.colaborador_fichas AS f (user_id, organization_id, qtd_filhos, tem_plano_saude,
      plano_saude, emergencia_nome, emergencia_parentesco, emergencia_telefone, hospital_preferencia,
      religiao)
  VALUES (_uid, _org, _qtd_filhos, _tem_plano_saude, _plano, _en, _ep, _et, _hosp, _rel)
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    qtd_filhos = EXCLUDED.qtd_filhos,
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
REVOKE ALL ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean) TO authenticated;

-- 4) Staff / admin da mesma imobiliária ------------------------------------------------------------
-- Lista todos os membros ativos da imobiliária atual com a ficha (ou pendente). Sem permissão → 42501.
-- shortcut: devolve a imobiliária inteira de uma vez (filtros na tela); paginar se passar de ~2 mil pessoas.
CREATE OR REPLACE FUNCTION public.ficha_colaboradores_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.ficha_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissao para ver as fichas dos colaboradores' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  RETURN jsonb_build_object(
    'obrigatoria_a_partir_de', public.ficha_obrigatoria_desde(_org),
    'colaboradores', coalesce((
      SELECT jsonb_agg(x.j ORDER BY x.nome) FROM (
        SELECT p.nome, jsonb_build_object(
          'user_id', p.id,
          'nome', p.nome,
          'email', p.email,
          'telefone', p.telefone,
          'papeis', coalesce((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                               WHERE ur.user_id = p.id AND ur.organization_id = _org), '[]'::jsonb),
          'equipes', coalesce((SELECT jsonb_agg(DISTINCT t.nome) FROM public.teams t
                                WHERE t.organization_id = _org
                                  AND (t.lider_id = p.id OR EXISTS (
                                        SELECT 1 FROM public.team_members tm
                                         WHERE tm.team_id = t.id AND tm.membro_id = p.id))), '[]'::jsonb),
          'data_nascimento', b.data_nascimento,
          'completa', public.ficha_esta_completa(f, b.data_nascimento),
          'qtd_filhos', f.qtd_filhos,
          'tem_plano_saude', f.tem_plano_saude,
          'plano_saude', f.plano_saude,
          'emergencia_nome', f.emergencia_nome,
          'emergencia_parentesco', f.emergencia_parentesco,
          'emergencia_telefone', f.emergencia_telefone,
          'hospital_preferencia', f.hospital_preferencia,
          'religiao', f.religiao,
          'preenchida_em', f.preenchida_em,
          'updated_at', f.updated_at) AS j
        FROM public.organization_members m
        JOIN public.profiles p ON p.id = m.user_id AND p.ativo IS TRUE
        LEFT JOIN public.colaborador_fichas f ON f.user_id = p.id AND f.organization_id = _org
        LEFT JOIN public.profile_birthdates b ON b.user_id = p.id
        WHERE m.organization_id = _org AND m.ativo
          AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
      ) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ficha_colaboradores_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_colaboradores_listar() TO authenticated;

-- Log de exportação (Excel/PDF): só quem exportou, formato e total. Nenhum dado pessoal.
CREATE OR REPLACE FUNCTION public.ficha_colaboradores_registrar_exportacao(_formato text, _total integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.ficha_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF _formato IS NULL OR _formato NOT IN ('excel', 'pdf') THEN
    RAISE EXCEPTION 'Formato invalido' USING ERRCODE = '22023';
  END IF;
  IF _total IS NULL OR _total < 0 OR _total > 100000 THEN
    RAISE EXCEPTION 'Total invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.activity_logs (organization_id, autor_id, sale_id, acao, payload)
  VALUES (public.current_org_id(), auth.uid(), NULL, 'colaborador_fichas_exportadas',
          jsonb_build_object('formato', _formato, 'total', _total));
END $$;
REVOKE ALL ON FUNCTION public.ficha_colaboradores_registrar_exportacao(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_colaboradores_registrar_exportacao(text, integer) TO authenticated;

-- Data a partir da qual a ficha trava o acesso (por imobiliária). Staff/admin/administrador principal.
CREATE OR REPLACE FUNCTION public.ficha_config_salvar(_obrigatoria_a_partir_de timestamptz)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.ficha_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = '42501';
  END IF;
  IF _obrigatoria_a_partir_de IS NULL
     OR _obrigatoria_a_partir_de < timestamptz '2026-01-01 00:00:00+00'
     OR _obrigatoria_a_partir_de > now() + interval '2 years' THEN
    RAISE EXCEPTION 'Data invalida' USING ERRCODE = '22023';
  END IF;
  _org := public.current_org_id();
  INSERT INTO public.ficha_config (organization_id, obrigatoria_a_partir_de, updated_at, updated_by)
  VALUES (_org, _obrigatoria_a_partir_de, now(), auth.uid())
  ON CONFLICT (organization_id) DO UPDATE SET
    obrigatoria_a_partir_de = EXCLUDED.obrigatoria_a_partir_de, updated_at = now(),
    updated_by = EXCLUDED.updated_by;
  INSERT INTO public.activity_logs (organization_id, autor_id, sale_id, acao, payload)
  VALUES (_org, auth.uid(), NULL, 'colaborador_fichas_prazo_alterado',
          jsonb_build_object('obrigatoria_a_partir_de', _obrigatoria_a_partir_de));
  RETURN _obrigatoria_a_partir_de;
END $$;
REVOKE ALL ON FUNCTION public.ficha_config_salvar(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_config_salvar(timestamptz) TO authenticated;

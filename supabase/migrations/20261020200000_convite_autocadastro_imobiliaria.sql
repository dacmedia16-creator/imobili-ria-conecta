-- Convite por e-mail para o dono de imobiliária se autocadastrar (t_6e4dab96, "sim" de Denis 20/10/2026).
--
-- Fluxo: super-admin da plataforma cria o convite (só o HASH do token fica aqui) → o dono abre
-- /convite/<token>, entra pela Conta MAX (Google) → a ponte conta-max-bridge confere que o e-mail
-- verificado é EXATAMENTE o convidado e grava uma "reserva" (claim, 1 h) → o dono preenche o cadastro →
-- org_invite_accept cria a imobiliária ATIVA + módulos (todos, menos Oportunidades) numa transação,
-- com trava de linha (FOR UPDATE): aceitar duas vezes não cria duas imobiliárias.
--
-- Segurança: RLS ligada; leitura só para o super-admin da plataforma; nenhuma escrita direta por
-- anon/authenticated. Todas as funções são SECURITY DEFINER e só o service_role (servidor) executa.
-- Rollback: supabase/rollback/20261020200000_convite_autocadastro_imobiliaria.sql

CREATE TABLE public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'
                             AND length(email) <= 255),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'enviado'
    CHECK (status IN ('enviado', 'aceito', 'cancelado', 'substituido')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  sent_at timestamptz,
  send_error text CHECK (send_error IS NULL OR length(send_error) <= 300),
  claim_hash text UNIQUE CHECK (claim_hash IS NULL OR claim_hash ~ '^[0-9a-f]{64}$'),
  claim_expires_at timestamptz,
  claim_workos_sub text,
  accepted_at timestamptz,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  canceled_at timestamptz,
  canceled_by uuid REFERENCES auth.users(id),
  replaced_by uuid REFERENCES public.organization_invites(id)
);
-- No máximo um convite em aberto por e-mail (reenviar substitui o anterior).
CREATE UNIQUE INDEX organization_invites_um_aberto_por_email
  ON public.organization_invites (email) WHERE status = 'enviado';
CREATE INDEX organization_invites_created_idx ON public.organization_invites (created_at DESC);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_invites TO authenticated;
GRANT ALL ON public.organization_invites TO service_role;
CREATE POLICY organization_invites_platform_select ON public.organization_invites
  FOR SELECT TO authenticated USING ((SELECT public.is_platform_super_admin()));

-- E-mail já tem conta no ADM? (um e-mail pertence a uma só agência; convite é só para dono novo)
CREATE OR REPLACE FUNCTION public.org_invite_email_em_uso(_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(_email)));
$$;

-- Cria (ou reenvia) convite. Um convite aberto anterior para o mesmo e-mail vira 'substituido'.
CREATE OR REPLACE FUNCTION public.org_invite_create(_email text, _token_hash text, _actor uuid,
                                                     _ttl interval DEFAULT interval '7 days')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _e text := lower(btrim(coalesce(_email, ''))); _id uuid; _old uuid;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'convite_sem_permissao' USING ERRCODE = '42501';
  END IF;
  IF _ttl IS NULL OR _ttl <= interval '0' OR _ttl > interval '7 days' THEN
    RAISE EXCEPTION 'convite_validade_invalida' USING ERRCODE = '22023';
  END IF;
  IF public.org_invite_email_em_uso(_e) THEN
    RAISE EXCEPTION 'email_ja_cadastrado' USING ERRCODE = '23505';
  END IF;
  SELECT id INTO _old FROM public.organization_invites WHERE email = _e AND status = 'enviado' FOR UPDATE;
  IF _old IS NOT NULL THEN
    UPDATE public.organization_invites SET status = 'substituido', claim_hash = NULL WHERE id = _old;
  END IF;
  INSERT INTO public.organization_invites (email, token_hash, expires_at, created_by)
  VALUES (_e, _token_hash, now() + _ttl, _actor) RETURNING id INTO _id;
  IF _old IS NOT NULL THEN
    UPDATE public.organization_invites SET replaced_by = _id WHERE id = _old;
  END IF;
  RETURN _id;
END $$;

-- Reenviar: gera novo link para o e-mail de um convite que ainda não foi aceito (invalida o anterior).
CREATE OR REPLACE FUNCTION public.org_invite_resend(_id uuid, _token_hash text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'convite_sem_permissao' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _row FROM public.organization_invites WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'convite_invalido' USING ERRCODE = 'P0002'; END IF;
  IF _row.status = 'aceito' THEN RAISE EXCEPTION 'convite_ja_usado' USING ERRCODE = '22023'; END IF;
  RETURN public.org_invite_create(_row.email, _token_hash, _actor);
END $$;

CREATE OR REPLACE FUNCTION public.org_invite_cancel(_id uuid, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _status text;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'convite_sem_permissao' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO _status FROM public.organization_invites WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'convite_invalido' USING ERRCODE = 'P0002'; END IF;
  IF _status <> 'enviado' THEN RAISE EXCEPTION 'convite_nao_aberto' USING ERRCODE = '22023'; END IF;
  UPDATE public.organization_invites
     SET status = 'cancelado', canceled_at = now(), canceled_by = _actor, claim_hash = NULL
   WHERE id = _id;
END $$;

-- Resultado do envio do e-mail (só registro; nunca muda o status do convite).
CREATE OR REPLACE FUNCTION public.org_invite_mark_sent(_id uuid, _ok boolean, _erro text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  UPDATE public.organization_invites
     SET sent_at = CASE WHEN _ok THEN now() ELSE sent_at END,
         send_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_erro, 'falha'), 300) END
   WHERE id = _id;
$$;

-- Dados para o e-mail do convite (a Edge Function confere o hash do token do link antes de enviar).
CREATE OR REPLACE FUNCTION public.org_invite_email_data(_id uuid)
RETURNS TABLE (email text, token_hash text, status text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT i.email, i.token_hash, i.status, i.expires_at FROM public.organization_invites i WHERE i.id = _id;
$$;

-- Chamada pela ponte Conta MAX depois de validar o passe (e-mail verificado pelo Google/WorkOS).
-- Confere token + e-mail EXATO (sem maiúsculas/espaços) e grava a reserva de 1 h para o cadastro.
CREATE OR REPLACE FUNCTION public.org_invite_claim(_token_hash text, _email text, _workos_sub text,
                                                    _claim_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites;
BEGIN
  IF coalesce(_workos_sub, '') = '' OR coalesce(_claim_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'convite_invalido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _row FROM public.organization_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'convite_invalido' USING ERRCODE = 'P0002'; END IF;
  IF _row.status = 'aceito' THEN RAISE EXCEPTION 'convite_ja_usado' USING ERRCODE = '22023'; END IF;
  IF _row.status = 'cancelado' THEN RAISE EXCEPTION 'convite_cancelado' USING ERRCODE = '22023'; END IF;
  IF _row.status = 'substituido' THEN RAISE EXCEPTION 'convite_substituido' USING ERRCODE = '22023'; END IF;
  IF _row.expires_at <= now() THEN RAISE EXCEPTION 'convite_expirado' USING ERRCODE = '22023'; END IF;
  IF _row.email <> lower(btrim(coalesce(_email, ''))) THEN
    RAISE EXCEPTION 'convite_outro_email' USING ERRCODE = '42501';
  END IF;
  IF public.org_invite_email_em_uso(_row.email) THEN
    RAISE EXCEPTION 'email_ja_cadastrado' USING ERRCODE = '23505';
  END IF;
  UPDATE public.organization_invites
     SET claim_hash = _claim_hash, claim_expires_at = now() + interval '1 hour', claim_workos_sub = _workos_sub
   WHERE id = _row.id;
  RETURN _row.email;
END $$;

-- Lê a reserva (para a tela de cadastro mostrar o e-mail). Não altera nada.
CREATE OR REPLACE FUNCTION public.org_invite_claim_info(_claim_hash text)
RETURNS TABLE (invite_id uuid, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites;
BEGIN
  SELECT * INTO _row FROM public.organization_invites WHERE claim_hash = _claim_hash;
  IF NOT FOUND OR _row.status <> 'enviado' OR _row.claim_expires_at <= now() THEN
    RAISE EXCEPTION 'reserva_invalida' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT _row.id, _row.email;
END $$;

-- Aceite atômico: trava o convite, cria a imobiliária ATIVA e liga os módulos (menos Oportunidades).
-- O usuário do dono é criado em seguida pelo servidor (API de Auth); se falhar, org_invite_accept_undo.
CREATE OR REPLACE FUNCTION public.org_invite_accept(_claim_hash text, _slug text, _nome text, _cnpj text,
    _razao_social text, _creci text, _cidade text, _uf text, _cor_primaria text, _cor_secundaria text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites; _org uuid; _base text; _try text; _n int := 1; _m text;
BEGIN
  SELECT * INTO _row FROM public.organization_invites WHERE claim_hash = _claim_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reserva_invalida' USING ERRCODE = '22023'; END IF;
  IF _row.status = 'aceito' THEN RAISE EXCEPTION 'convite_ja_usado' USING ERRCODE = '22023'; END IF;
  IF _row.status <> 'enviado' OR _row.claim_expires_at <= now() THEN
    RAISE EXCEPTION 'reserva_invalida' USING ERRCODE = '22023';
  END IF;
  IF public.org_invite_email_em_uso(_row.email) THEN
    RAISE EXCEPTION 'email_ja_cadastrado' USING ERRCODE = '23505';
  END IF;
  _base := left(lower(btrim(coalesce(_slug, ''))), 58);
  IF _base !~ '^[a-z0-9][a-z0-9-]{1,57}$' THEN RAISE EXCEPTION 'slug_invalido' USING ERRCODE = '22023'; END IF;
  _base := rtrim(_base, '-');
  _try := _base;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = _try) LOOP
    _n := _n + 1;
    IF _n > 99 THEN RAISE EXCEPTION 'slug_indisponivel' USING ERRCODE = '23505'; END IF;
    _try := _base || '-' || _n;
  END LOOP;
  INSERT INTO public.organizations (slug, nome, status, created_by, cnpj, razao_social, creci, cidade, uf,
                                    cor_primaria, cor_secundaria)
  VALUES (_try, btrim(_nome), 'ativa', _row.created_by,
          nullif(regexp_replace(coalesce(_cnpj, ''), '[^0-9]', '', 'g'), ''),
          nullif(btrim(coalesce(_razao_social, '')), ''), nullif(btrim(coalesce(_creci, '')), ''),
          nullif(btrim(coalesce(_cidade, '')), ''), nullif(upper(btrim(coalesce(_uf, ''))), ''),
          nullif(lower(btrim(coalesce(_cor_primaria, ''))), ''),
          nullif(lower(btrim(coalesce(_cor_secundaria, ''))), ''))
  RETURNING id INTO _org;
  -- Módulos: todos ligados, exceto Oportunidades (decisão de Denis). Mesma lista de
  -- platform_set_organization_module; o teste org-invites.test.ts compara com ORGANIZATION_MODULES.
  FOREACH _m IN ARRAY ARRAY['captacao_exclusiva', 'reserva_salas', 'feedback_proprietario',
                            'mural_conquistas', 'ranking_valores', 'oportunidades'] LOOP
    INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
    VALUES (_org, _m, _m <> 'oportunidades', now(), _row.created_by)
    ON CONFLICT (organization_id, module) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
    INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
    VALUES (_org, _m, _m <> 'oportunidades', _row.created_by);
  END LOOP;
  UPDATE public.organization_invites
     SET status = 'aceito', accepted_at = now(), organization_id = _org
   WHERE id = _row.id;
  RETURN jsonb_build_object('invite_id', _row.id, 'organization_id', _org, 'slug', _try,
                            'email', _row.email, 'workos_sub', _row.claim_workos_sub);
END $$;

-- Depois de criar o usuário do dono: grava quem aceitou e liga a conta Google (Conta MAX) a ele,
-- para o próximo login entrar direto. Nunca sobrescreve vínculo existente.
CREATE OR REPLACE FUNCTION public.org_invite_accept_finish(_invite_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites;
BEGIN
  SELECT * INTO _row FROM public.organization_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR _row.status <> 'aceito' OR _row.accepted_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'convite_invalido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_invites SET accepted_user_id = _user_id, claim_hash = NULL WHERE id = _invite_id;
  IF _row.claim_workos_sub IS NOT NULL THEN
    INSERT INTO public.conta_max_identity_links (workos_user_id, adm_user_id, active)
    VALUES (_row.claim_workos_sub, _user_id, true)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Compensação: a criação do usuário falhou → apaga a imobiliária recém-criada (ainda sem membros)
-- e devolve o convite para 'enviado', com a mesma reserva, para o dono tentar de novo.
CREATE OR REPLACE FUNCTION public.org_invite_accept_undo(_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row public.organization_invites;
BEGIN
  SELECT * INTO _row FROM public.organization_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR _row.status <> 'aceito' OR _row.accepted_user_id IS NOT NULL THEN RETURN; END IF;
  UPDATE public.organization_invites SET status = 'enviado', accepted_at = NULL, organization_id = NULL
   WHERE id = _invite_id;
  IF _row.organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = _row.organization_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE organization_id = _row.organization_id) THEN
    DELETE FROM public.organizations WHERE id = _row.organization_id;
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.org_invite_email_em_uso(text)',
    'public.org_invite_create(text, text, uuid, interval)',
    'public.org_invite_resend(uuid, text, uuid)',
    'public.org_invite_cancel(uuid, uuid)',
    'public.org_invite_mark_sent(uuid, boolean, text)',
    'public.org_invite_email_data(uuid)',
    'public.org_invite_claim(text, text, text, text)',
    'public.org_invite_claim_info(text)',
    'public.org_invite_accept(text, text, text, text, text, text, text, text, text, text)',
    'public.org_invite_accept_finish(uuid, uuid)',
    'public.org_invite_accept_undo(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

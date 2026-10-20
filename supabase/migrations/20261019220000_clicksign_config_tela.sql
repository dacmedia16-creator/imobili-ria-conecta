-- Tela "Assinatura digital" (cartão t_7508c6b6): o super admin da imobiliária configura a Clicksign
-- da PRÓPRIA organização sem trabalho técnico. Tudo passa pela edge clicksign-config:
--   1) clicksign_config_authorize() com o JWT de quem pede: devolve a org do contexto só para
--      super_admin ativo (a org nunca vem do navegador — um super admin não toca em outra org);
--   2) as funções abaixo, só service_role, gravam e registram auditoria SEM valores secretos.
-- Aditiva: 4 colunas novas que aceitam NULL (sem default, sem reescrita, sem UPDATE em linhas
-- existentes — a configuração atual da Única Escolha não muda), tabela de auditoria e funções novas.
-- Caminho de volta: supabase/rollback/20261019220000_clicksign_config_tela.sql.

ALTER TABLE public.clicksign_org_settings
  ADD COLUMN IF NOT EXISTS access_token_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_secret_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_ok boolean,
  ADD COLUMN IF NOT EXISTS connection_checked_at timestamptz;

-- Auditoria: quem alterou o quê e quando. Só inclusão (sem UPDATE/DELETE para ninguém além do dono).
-- detail nunca leva chave, segredo nem e-mail: só nomes de campos, contagens e códigos.
CREATE TABLE public.clicksign_config_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN
    ('chave_api','segredo_webhook','configuracao','teste_conexao','ligar','desligar')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(detail) = 'object' AND length(detail::text) <= 600),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clicksign_config_audit_org_idx
  ON public.clicksign_config_audit (organization_id, created_at DESC);
ALTER TABLE public.clicksign_config_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_config_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.clicksign_config_audit TO service_role;

-- ===== Chamada com o JWT do usuário (edge clicksign-config) =====

-- Só super_admin ativo da org do contexto (inclui o dono da plataforma dentro da imobiliária).
-- Admin, gestor e demais papéis recebem erro 42501 e a edge não faz mais nada.
CREATE FUNCTION public.clicksign_config_authorize() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _org IS NULL
     OR NOT coalesce(public.has_role(_uid, 'super_admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'Apenas o super admin da imobiliária configura a assinatura digital'
      USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_authorize() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_config_authorize() TO authenticated;

-- ===== Somente service_role (depois do authorize) =====

CREATE FUNCTION public.clicksign_config_mask_email(_e text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN position('@' IN coalesce(_e, '')) > 1
    THEN left(lower(trim(_e)), least(2, position('@' IN lower(trim(_e))) - 1)) || '***'
      || substr(lower(trim(_e)), position('@' IN lower(trim(_e))))
    ELSE '' END
$$;
REVOKE ALL ON FUNCTION public.clicksign_config_mask_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_mask_email(text) TO service_role;

-- O que a tela mostra. Nunca devolve chave nem segredo (nem mascarado): só "configurado" e a data.
-- Cria a linha da org se faltar (enabled=false e test_mode=true por padrão) para gerar o endereço
-- do webhook; linhas existentes não são alteradas.
CREATE FUNCTION public.clicksign_config_view(_org uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _s public.clicksign_org_settings%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Organização inexistente';
  END IF;
  INSERT INTO public.clicksign_org_settings (organization_id) VALUES (_org) ON CONFLICT DO NOTHING;
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org;
  RETURN jsonb_build_object(
    'enabled', _s.enabled,
    'sale_enabled', _s.sale_enabled,
    'test_mode', _s.test_mode,
    'allowlist_count', cardinality(_s.test_allowlist_sha256),
    'deadline_days', _s.deadline_days,
    'signer_ids', to_jsonb(_s.imobiliaria_signer_ids),
    'valid_signers', (SELECT count(*) FROM public.clicksign_imobiliaria_signers(_org)),
    'token', jsonb_build_object(
      'configured', _s.access_token_secret_id IS NOT NULL,
      'set_at', CASE WHEN _s.access_token_secret_id IS NOT NULL THEN coalesce(_s.access_token_set_at,
        (SELECT v.updated_at FROM vault.secrets v WHERE v.id = _s.access_token_secret_id)) END),
    'webhook', jsonb_build_object(
      'configured', _s.webhook_secret_id IS NOT NULL,
      'set_at', CASE WHEN _s.webhook_secret_id IS NOT NULL THEN coalesce(_s.webhook_secret_set_at,
        (SELECT v.updated_at FROM vault.secrets v WHERE v.id = _s.webhook_secret_id)) END,
      'slug', _s.webhook_slug),
    'connection', jsonb_build_object('ok', _s.connection_ok, 'checked_at', _s.connection_checked_at),
    'candidates', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', p.id,
          'nome', p.nome,
          'email', public.clicksign_config_mask_email(p.email),
          'email_ok', nullif(trim(coalesce(p.email, '')), '') IS NOT NULL)
        ORDER BY p.nome)
      FROM public.profiles p
      JOIN public.organization_members m
        ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
      WHERE p.ativo IS TRUE AND nullif(trim(coalesce(p.nome, '')), '') IS NOT NULL), '[]'::jsonb),
    'audit', coalesce((
      SELECT jsonb_agg(jsonb_build_object('action', a.action, 'detail', a.detail,
          'created_at', a.created_at, 'actor', coalesce(p.nome, 'Usuário removido'))
        ORDER BY a.created_at DESC, a.id DESC)
      FROM (SELECT * FROM public.clicksign_config_audit x WHERE x.organization_id = _org
            ORDER BY x.created_at DESC, x.id DESC LIMIT 20) a
      LEFT JOIN public.profiles p ON p.id = a.actor_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_view(uuid) TO service_role;

-- Grava/troca a chave de API ou o segredo do webhook (Vault, pela função já existente) e audita.
-- Trocar a chave zera o teste de conexão: ligar de novo exige testar a chave nova.
CREATE FUNCTION public.clicksign_config_store_secret(_org uuid, _actor uuid, _kind text, _value text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _had boolean;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Autor obrigatório'; END IF;
  SELECT CASE WHEN _kind = 'access_token' THEN access_token_secret_id IS NOT NULL
              ELSE webhook_secret_id IS NOT NULL END
    INTO _had FROM public.clicksign_org_settings WHERE organization_id = _org;
  PERFORM public.clicksign_admin_set_secret(_org, _kind, _value);
  IF _kind = 'access_token' THEN
    UPDATE public.clicksign_org_settings SET access_token_set_at = now(),
      connection_ok = NULL, connection_checked_at = NULL WHERE organization_id = _org;
  ELSE
    UPDATE public.clicksign_org_settings SET webhook_secret_set_at = now()
      WHERE organization_id = _org;
  END IF;
  INSERT INTO public.clicksign_config_audit (organization_id, actor_id, action, detail)
    VALUES (_org, _actor, CASE WHEN _kind = 'access_token' THEN 'chave_api' ELSE 'segredo_webhook' END,
      jsonb_build_object('operacao', CASE WHEN coalesce(_had, false) THEN 'trocou' ELSE 'cadastrou' END));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_store_secret(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_store_secret(uuid, uuid, text, text) TO service_role;

-- Modo teste, quem assina pela imobiliária, allowlist (só sha256) e prazo. NULL = não altera.
-- Usa a validação da função administrativa existente (signatários da PRÓPRIA org, ativos, com e-mail).
CREATE FUNCTION public.clicksign_config_save(_org uuid, _actor uuid, _test_mode boolean DEFAULT NULL,
  _signer_ids uuid[] DEFAULT NULL, _allowlist text[] DEFAULT NULL, _deadline_days integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _s public.clicksign_org_settings%ROWTYPE; _d jsonb := '{}'::jsonb;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'Autor obrigatório'; END IF;
  IF _deadline_days IS NOT NULL AND _deadline_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'O prazo precisa ficar entre 1 e 90 dias';
  END IF;
  IF _signer_ids IS NOT NULL AND cardinality(_signer_ids) > 10 THEN
    RAISE EXCEPTION 'Escolha no máximo 10 pessoas para assinar pela imobiliária';
  END IF;
  IF _allowlist IS NOT NULL AND cardinality(_allowlist) > 50 THEN
    RAISE EXCEPTION 'A lista de e-mails de teste aceita no máximo 50 e-mails';
  END IF;
  PERFORM public.clicksign_admin_configure(_org, NULL, _test_mode, _signer_ids, _allowlist,
    _deadline_days);
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org;
  IF _s.enabled AND (SELECT count(*) FROM public.clicksign_imobiliaria_signers(_org)) = 0 THEN
    RAISE EXCEPTION 'Com a assinatura digital ligada é preciso manter ao menos 1 pessoa assinando pela imobiliária';
  END IF;
  IF _test_mode IS NOT NULL THEN _d := _d || jsonb_build_object('modo_teste', _test_mode); END IF;
  IF _deadline_days IS NOT NULL THEN _d := _d || jsonb_build_object('prazo_dias', _deadline_days); END IF;
  IF _signer_ids IS NOT NULL THEN
    _d := _d || jsonb_build_object('assinam_pela_imobiliaria', cardinality(_s.imobiliaria_signer_ids));
  END IF;
  IF _allowlist IS NOT NULL THEN
    _d := _d || jsonb_build_object('emails_teste', cardinality(_s.test_allowlist_sha256));
  END IF;
  INSERT INTO public.clicksign_config_audit (organization_id, actor_id, action, detail)
    VALUES (_org, _actor, 'configuracao', _d);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_save(uuid, uuid, boolean, uuid[], text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_save(uuid, uuid, boolean, uuid[], text[], integer)
  TO service_role;

-- Resultado do "Testar conexão" (chamada só de leitura feita pela edge com a chave salva).
CREATE FUNCTION public.clicksign_config_record_test(_org uuid, _actor uuid, _ok boolean, _code text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _actor IS NULL OR _ok IS NULL THEN RAISE EXCEPTION 'Parâmetros inválidos'; END IF;
  IF _code IS NOT NULL AND _code !~ '^[a-z_0-9]{1,40}$' THEN RAISE EXCEPTION 'Código inválido'; END IF;
  UPDATE public.clicksign_org_settings SET connection_ok = _ok, connection_checked_at = now()
    WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração inexistente'; END IF;
  INSERT INTO public.clicksign_config_audit (organization_id, actor_id, action, detail)
    VALUES (_org, _actor, 'teste_conexao',
      jsonb_build_object('ok', _ok) || CASE WHEN _code IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('codigo', _code) END);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_record_test(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_record_test(uuid, uuid, boolean, text) TO service_role;

-- Liga/desliga a assinatura digital (captação E venda: enabled e sale_enabled juntos).
-- Ligar exige: chave, segredo do webhook, ao menos 1 signatário válido e teste de conexão aprovado
-- depois da última troca de chave. O banco confere de novo (a tela só ajuda).
CREATE FUNCTION public.clicksign_config_set_enabled(_org uuid, _actor uuid, _on boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _s public.clicksign_org_settings%ROWTYPE; _falta text[] := '{}';
BEGIN
  IF _actor IS NULL OR _on IS NULL THEN RAISE EXCEPTION 'Parâmetros inválidos'; END IF;
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração inexistente'; END IF;
  IF _on THEN
    IF _s.access_token_secret_id IS NULL THEN _falta := _falta || 'chave de API'::text; END IF;
    IF _s.webhook_secret_id IS NULL THEN _falta := _falta || 'segredo do webhook'::text; END IF;
    IF (SELECT count(*) FROM public.clicksign_imobiliaria_signers(_org)) = 0 THEN
      _falta := _falta || 'quem assina pela imobiliária'::text;
    END IF;
    IF _s.connection_ok IS NOT TRUE THEN _falta := _falta || 'teste de conexão aprovado'::text; END IF;
    IF cardinality(_falta) > 0 THEN
      RAISE EXCEPTION 'Para ligar falta: %', array_to_string(_falta, ', ');
    END IF;
  END IF;
  UPDATE public.clicksign_org_settings SET enabled = _on, sale_enabled = _on, updated_at = now()
    WHERE organization_id = _org;
  INSERT INTO public.clicksign_config_audit (organization_id, actor_id, action, detail)
    VALUES (_org, _actor, CASE WHEN _on THEN 'ligar' ELSE 'desligar' END,
      jsonb_build_object('antes', jsonb_build_object('captacao', _s.enabled, 'venda', _s.sale_enabled),
        'modo_teste', _s.test_mode));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_config_set_enabled(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_config_set_enabled(uuid, uuid, boolean) TO service_role;

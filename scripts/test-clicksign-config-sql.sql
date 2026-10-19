-- Teste SQL da tela "Assinatura digital" (t_7508c6b6) — rodar SÓ em banco local de homologação, com a
-- migration 20261019220000 aplicada. Tudo dentro de uma transação desfeita no fim (ROLLBACK).
-- Usuários fictícios: definidos por \set abaixo (ids da base de homologação; troque se preciso).
-- Uso: psql -v ON_ERROR_STOP=1 -v org_a=... -v org_b=... -v super_a=... -v admin_a=... \
--        -v gestor_a=... -v corretor_a=... -v admin_b=... -v signer_b=... -f este_arquivo.sql
-- Saída esperada: várias linhas "PASS ..." e nenhuma exceção.
BEGIN;
CREATE TEMP TABLE _ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO _ids VALUES ('org_a', :'org_a'), ('org_b', :'org_b'), ('super_a', :'super_a'),
  ('admin_a', :'admin_a'), ('gestor_a', :'gestor_a'), ('corretor_a', :'corretor_a'),
  ('admin_b', :'admin_b'), ('signer_b', :'signer_b');
GRANT SELECT ON _ids TO authenticated, service_role;
CREATE TEMP TABLE _fp_a ON COMMIT DROP AS
  SELECT md5(t::text) AS h FROM public.clicksign_org_settings t
  WHERE organization_id = (SELECT v FROM _ids WHERE k = 'org_a');
GRANT SELECT ON _fp_a TO service_role;

-- 1) Por papel: só super_admin passa no authorize, e devolve a org DELE.
CREATE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _u::text, true),
         set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true),
         set_config('mt.ctx', '', true)
$$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT v FROM _ids WHERE k = 'super_a'));
DO $$ BEGIN
  IF public.clicksign_config_authorize() IS DISTINCT FROM (SELECT v FROM _ids WHERE k = 'org_a') THEN
    RAISE EXCEPTION 'FAIL super_admin deveria receber a própria org';
  END IF;
  RAISE NOTICE 'PASS super_admin autorizado na própria org';
END $$;
DO $$ DECLARE _k text; _ok boolean; BEGIN
  FOREACH _k IN ARRAY ARRAY['admin_a','gestor_a','corretor_a','admin_b'] LOOP
    PERFORM set_config('request.jwt.claim.sub', (SELECT v FROM _ids WHERE k = _k)::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT v FROM _ids WHERE k = _k))::text, true);
    PERFORM set_config('mt.ctx', '', true);
    _ok := false;
    BEGIN PERFORM public.clicksign_config_authorize();
    EXCEPTION WHEN insufficient_privilege THEN _ok := true; END;
    IF NOT _ok THEN RAISE EXCEPTION 'FAIL % não deveria ser autorizado', _k; END IF;
    RAISE NOTICE 'PASS % recusado (42501)', _k;
  END LOOP;
END $$;
-- Sem login: recusado.
DO $$ DECLARE _ok boolean := false; BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN PERFORM public.clicksign_config_authorize();
  EXCEPTION WHEN insufficient_privilege THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL anônimo autorizado'; END IF;
  RAISE NOTICE 'PASS sem login recusado';
END $$;
-- 2) Usuário logado (qualquer papel, até super_admin) não chama as funções de gravação nem lê a tabela.
SELECT pg_temp.as_user((SELECT v FROM _ids WHERE k = 'super_a'));
DO $$ DECLARE _f text; _ok boolean; BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'SELECT public.clicksign_config_view(''00000000-0000-4000-8000-000000000001'')',
    'SELECT public.clicksign_config_set_enabled(''00000000-0000-4000-8000-000000000001'', ''00000000-0000-4000-8000-000000000001'', true)',
    'SELECT public.clicksign_config_store_secret(''00000000-0000-4000-8000-000000000001'', ''00000000-0000-4000-8000-000000000001'', ''access_token'', ''abcdefghijklmnopqrstu'')',
    'SELECT public.clicksign_config_save(''00000000-0000-4000-8000-000000000001'', ''00000000-0000-4000-8000-000000000001'', false)',
    'SELECT public.clicksign_config_record_test(''00000000-0000-4000-8000-000000000001'', ''00000000-0000-4000-8000-000000000001'', true, NULL)',
    'SELECT * FROM public.clicksign_config_audit',
    'SELECT * FROM public.clicksign_org_settings'] LOOP
    _ok := false;
    BEGIN EXECUTE _f; EXCEPTION WHEN insufficient_privilege THEN _ok := true; END;
    IF NOT _ok THEN RAISE EXCEPTION 'FAIL authenticated executou: %', _f; END IF;
  END LOOP;
  RAISE NOTICE 'PASS authenticated sem acesso direto às funções de gravação, à auditoria e à tabela';
END $$;
RESET ROLE;

-- 3) Fluxo completo na org B como service_role (o que a edge faz depois do authorize).
SET LOCAL ROLE service_role;
DO $$ DECLARE _b uuid := (SELECT v FROM _ids WHERE k = 'org_b'); _who uuid := (SELECT v FROM _ids WHERE k = 'admin_b');
  _v jsonb; _ok boolean; _msg text;
BEGIN
  _v := public.clicksign_config_view(_b);
  IF (_v->>'enabled')::boolean OR NOT (_v->>'test_mode')::boolean OR (_v->'token'->>'configured')::boolean
     OR length(_v->'webhook'->>'slug') < 32 THEN
    RAISE EXCEPTION 'FAIL org nova deveria vir desligada, em modo teste, sem chave e com endereço: %', _v;
  END IF;
  RAISE NOTICE 'PASS org nova: desligada, modo teste, sem chave, com endereço de webhook';
  -- Ligar sem nada configurado: bloqueado com a lista do que falta.
  BEGIN PERFORM public.clicksign_config_set_enabled(_b, _who, true); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT; END;
  IF NOT _ok OR _msg NOT LIKE '%chave de API%segredo do webhook%quem assina%teste de conexão%' THEN
    RAISE EXCEPTION 'FAIL ligar sem configuração: %', _msg;
  END IF;
  RAISE NOTICE 'PASS ligar bloqueado: %', _msg;
  PERFORM public.clicksign_config_store_secret(_b, _who, 'access_token', 'chave-ficticia-de-teste-0001');
  PERFORM public.clicksign_config_store_secret(_b, _who, 'webhook', 'segredo-ficticio-webhook-0001');
  PERFORM public.clicksign_config_save(_b, _who, true, ARRAY[(SELECT v FROM _ids WHERE k = 'signer_b')],
    ARRAY['Teste.Um@Example.com', 'teste.um@example.com ', 'dois@example.com'], 15);
  _v := public.clicksign_config_view(_b);
  IF _v::text LIKE '%chave-ficticia%' OR _v::text LIKE '%segredo-ficticio%' OR _v::text LIKE '%teste.um@%'
     OR NOT (_v->'token'->>'configured')::boolean OR _v->'token'->>'set_at' IS NULL
     OR (_v->>'allowlist_count')::int <> 2 OR (_v->>'deadline_days')::int <> 15
     OR (_v->>'valid_signers')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL tela depois de salvar: %', _v;
  END IF;
  RAISE NOTICE 'PASS chave/segredo nunca voltam; allowlist só conta (2, sha256); prazo 15; 1 signatário';
  -- Teste de conexão ainda não feito: continua bloqueado só por ele.
  BEGIN PERFORM public.clicksign_config_set_enabled(_b, _who, true); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT; END;
  IF NOT _ok OR _msg <> 'Para ligar falta: teste de conexão aprovado' THEN RAISE EXCEPTION 'FAIL %', _msg; END IF;
  PERFORM public.clicksign_config_record_test(_b, _who, false, 'chave_recusada');
  BEGIN PERFORM public.clicksign_config_set_enabled(_b, _who, true); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL ligou com teste reprovado'; END IF;
  RAISE NOTICE 'PASS teste reprovado mantém ligar bloqueado';
  PERFORM public.clicksign_config_record_test(_b, _who, true, NULL);
  PERFORM public.clicksign_config_set_enabled(_b, _who, true);
  IF NOT (SELECT enabled AND sale_enabled FROM public.clicksign_org_settings WHERE organization_id = _b) THEN
    RAISE EXCEPTION 'FAIL não ligou captação e venda';
  END IF;
  RAISE NOTICE 'PASS ligou captação e venda juntos';
  -- Ligada: não dá para zerar quem assina.
  BEGIN PERFORM public.clicksign_config_save(_b, _who, NULL, '{}'::uuid[]); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL ligada ficou sem signatário'; END IF;
  RAISE NOTICE 'PASS ligada exige ao menos 1 signatário';
  -- Trocar a chave zera o teste (ligar de novo exigiria testar); desligar funciona.
  PERFORM public.clicksign_config_store_secret(_b, _who, 'access_token', 'chave-ficticia-de-teste-0002');
  IF (SELECT connection_ok FROM public.clicksign_org_settings WHERE organization_id = _b) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL trocar chave não zerou o teste';
  END IF;
  PERFORM public.clicksign_config_set_enabled(_b, _who, false);
  IF (SELECT enabled OR sale_enabled FROM public.clicksign_org_settings WHERE organization_id = _b) THEN
    RAISE EXCEPTION 'FAIL não desligou';
  END IF;
  RAISE NOTICE 'PASS trocar chave zera o teste; desligar desliga captação e venda';
  IF public.clicksign_org_secret(_b, 'access_token') <> 'chave-ficticia-de-teste-0002' THEN
    RAISE EXCEPTION 'FAIL Vault não guardou a chave nova';
  END IF;
  RAISE NOTICE 'PASS chave nova lida pelas edges via clicksign_org_secret (Vault)';
  -- Signatário de OUTRA org é recusado (isolamento).
  BEGIN PERFORM public.clicksign_config_save(_b, _who, NULL, ARRAY[(SELECT v FROM _ids WHERE k = 'gestor_a')]); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL aceitou signatário de outra org'; END IF;
  RAISE NOTICE 'PASS signatário de outra imobiliária recusado';
  -- Validações de entrada.
  BEGIN PERFORM public.clicksign_config_save(_b, _who, NULL, NULL, NULL, 0); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL prazo 0 aceito'; END IF;
  BEGIN PERFORM public.clicksign_config_store_secret(_b, _who, 'access_token', 'curta'); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL chave curta aceita'; END IF;
  BEGIN PERFORM public.clicksign_config_record_test(_b, _who, false, 'Texto Livre <x>'); _ok := false;
  EXCEPTION WHEN raise_exception THEN _ok := true; END;
  IF NOT _ok THEN RAISE EXCEPTION 'FAIL código livre aceito na auditoria'; END IF;
  RAISE NOTICE 'PASS validações (prazo, chave curta, código livre)';
  -- Auditoria: tem quem e o quê, sem segredo nem e-mail.
  IF (SELECT count(*) FROM public.clicksign_config_audit WHERE organization_id = _b) < 8
     OR EXISTS (SELECT 1 FROM public.clicksign_config_audit WHERE organization_id = _b
       AND (detail::text ~* '(chave-ficticia|segredo-ficticio|@)' OR actor_id IS DISTINCT FROM _who)) THEN
    RAISE EXCEPTION 'FAIL auditoria';
  END IF;
  RAISE NOTICE 'PASS auditoria: % registros com autor, sem segredo nem e-mail',
    (SELECT count(*) FROM public.clicksign_config_audit WHERE organization_id = _b);
END $$;
-- 4) A org A (configuração existente) não foi tocada por nada acima.
DO $$ BEGIN
  IF (SELECT md5(t::text) FROM public.clicksign_org_settings t
      WHERE organization_id = (SELECT v FROM _ids WHERE k = 'org_a')) IS DISTINCT FROM (SELECT h FROM _fp_a) THEN
    RAISE EXCEPTION 'FAIL org A alterada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_config_audit WHERE organization_id = (SELECT v FROM _ids WHERE k = 'org_a')) THEN
    RAISE EXCEPTION 'FAIL auditoria na org A';
  END IF;
  RAISE NOTICE 'PASS org A intacta (configurar a B não toca nas outras)';
END $$;
RESET ROLE;
ROLLBACK;

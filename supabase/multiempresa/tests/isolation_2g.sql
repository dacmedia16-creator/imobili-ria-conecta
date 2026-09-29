-- Suíte 2g: a memória por comando da agência não pode sobreviver a mudança de vínculo/perfil/agência
-- nem vazar entre usuários. Tudo num DO (um único comando = mesmo statement_timestamp) + ROLLBACK.
-- Usa dois perfis ativos da mesma agência (reais ou do seed). Mudanças de cadastro feitas como
-- service_role (caminho do servidor). Saída sem PII.
BEGIN;
DO $t$
DECLARE a uuid; b uuid; o uuid; ok int := 0; tot int := 0;
  r uuid; x boolean;
BEGIN
  SELECT m.user_id, m.organization_id INTO a, o FROM public.organization_members m
    JOIN public.profiles p ON p.id = m.user_id AND p.ativo WHERE m.ativo ORDER BY m.user_id LIMIT 1;
  SELECT m.user_id INTO b FROM public.organization_members m
    JOIN public.profiles p ON p.id = m.user_id AND p.ativo
   WHERE m.ativo AND m.organization_id = o AND m.user_id <> a ORDER BY m.user_id LIMIT 1;
  IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Sem usuarios para a suite 2g'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tot := tot + 1; IF public.current_org_id() = o THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA ctx inicial'; END IF;
  tot := tot + 1; IF public.mt_in_ctx_org(b) THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA colega visivel'; END IF;
  tot := tot + 1; IF public.user_org(b) = o THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA user_org colega'; END IF;
  RESET ROLE;

  -- Colega desativado no MESMO comando: a memória do colega precisa cair.
  PERFORM set_config('role', 'service_role', true); UPDATE public.organization_members SET ativo = false WHERE user_id = b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tot := tot + 1; IF public.mt_in_ctx_org(b) IS NULL THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA colega desativado ainda visivel'; END IF;
  tot := tot + 1; IF public.user_org(b) IS NULL THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA user_org colega desativado'; END IF;
  RESET ROLE;
  PERFORM set_config('role', 'service_role', true); UPDATE public.organization_members SET ativo = true WHERE user_id = b;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- Perfil do próprio usuário desativado no mesmo comando: perde o contexto na hora.
  PERFORM set_config('role', 'service_role', true); UPDATE public.profiles SET ativo = false WHERE id = a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tot := tot + 1; IF public.current_org_id() IS NULL THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA perfil desativado mantem agencia'; END IF;
  tot := tot + 1; IF NOT public.mt_1b_gate() THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA gate com perfil desativado'; END IF;
  RESET ROLE;
  PERFORM set_config('role', 'service_role', true); UPDATE public.profiles SET ativo = true WHERE id = a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- Agência suspensa no mesmo comando.
  PERFORM set_config('role', 'service_role', true); UPDATE public.organizations SET status = 'suspensa' WHERE id = o;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tot := tot + 1; IF public.current_org_id() IS NULL AND public.user_org(a) IS NULL THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA agencia suspensa mantem contexto'; END IF;
  RESET ROLE;
  PERFORM set_config('role', 'service_role', true); UPDATE public.organizations SET status = 'ativa' WHERE id = o;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- Troca de usuário no mesmo comando: sem vazamento de memória entre usuários.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  tot := tot + 1; IF public.current_org_id() IS NULL AND NOT public.mt_1b_gate() AND public.mt_in_ctx_org(b) IS NULL
    THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA memoria vazou entre usuarios'; END IF;
  RESET ROLE;

  -- Chamador anônimo (sem sub) não herda nada.
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  tot := tot + 1; IF public.mt_ctx_org(true) IS NULL AND public.mt_ctx_org(false) IS NULL THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA anon com contexto'; END IF;

  -- anon não executa as funções de contexto.
  tot := tot + 1; IF NOT has_function_privilege('anon', 'public.mt_ctx_org(boolean)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.mt_in_ctx_org(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.mt_ctx_invalidate()', 'EXECUTE')
    THEN ok := ok + 1; ELSE RAISE NOTICE 'FALHA grants 2g'; END IF;

  RAISE NOTICE 'TOTAL=% OK=% FALHAS=%', tot, ok, tot - ok;
  IF ok <> tot THEN RAISE EXCEPTION 'Testes 2g falhando'; END IF;
END $t$;
ROLLBACK;

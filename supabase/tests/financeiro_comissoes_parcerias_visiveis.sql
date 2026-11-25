-- Suíte da RPC financeiro_comissoes_parcerias_visiveis (t_205ec8f5 B). Roda DENTRO da transação do
-- runner (run-financeiro-comissoes-parcerias-visiveis.sh), que desfaz tudo no fim.
-- Para TODO usuário ativo de TODA imobiliária do banco: o que a RPC devolve tem de ser IDÊNTICO
-- (mesmas linhas, mesmas colunas, mesma ordem) ao que o próprio usuário lê das tabelas com o RLS.
-- Depois confere as travas: anônimo bloqueado, grants mínimos, search_path fixo, SECURITY DEFINER.
DO $suite$
DECLARE
  _u record; _old_c jsonb; _old_p jsonb; _new jsonb;
  _n int := 0; _bad int := 0; _papeis text := '';
BEGIN
  FOR _u IN
    SELECT m.user_id, m.organization_id
      FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id AND p.ativo
     WHERE m.ativo
     ORDER BY m.organization_id, m.user_id
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _u.user_id, 'role', 'authenticated')::text, true);
    PERFORM set_config('mt.ctx', '', true);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'occurrence_id', c.occurrence_id, 'papel', c.papel, 'nome', c.nome,
             'percentual', c.percentual, 'valor', c.valor, 'user_id', c.user_id,
             'managed_by_sale', c.managed_by_sale, 'sale_commission_extra_id', c.sale_commission_extra_id,
             'sem_cadastro_confirmado', c.sem_cadastro_confirmado) ORDER BY c.id), '[]'::jsonb)
      INTO _old_c FROM public.occurrence_commissions c;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'occurrence_id', p.occurrence_id,
             'valor', p.valor) ORDER BY p.id), '[]'::jsonb)
      INTO _old_p FROM public.occurrence_partners p;
    PERFORM set_config('mt.ctx', '', true);
    _new := public.financeiro_comissoes_parcerias_visiveis();
    RESET ROLE;
    _n := _n + 1;
    IF _new->'comissoes' IS DISTINCT FROM _old_c OR _new->'parcerias' IS DISTINCT FROM _old_p THEN
      _bad := _bad + 1;
      RAISE NOTICE 'FALHA: usuario % (md5) rls=%/% rpc=%/%', substr(md5(_u.user_id::text), 1, 6),
        jsonb_array_length(_old_c), jsonb_array_length(_old_p),
        jsonb_array_length(coalesce(_new->'comissoes', '[]')), jsonb_array_length(coalesce(_new->'parcerias', '[]'));
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE NOTICE 'FALHA: nenhum usuário ativo para conferir'; END IF;
  RAISE NOTICE 'equivalencia: % usuarios, % diferentes', _n, _bad;
  IF _bad = 0 AND _n > 0 THEN RAISE NOTICE 'OK: RPC = RLS para todos os usuários'; END IF;
END
$suite$;

-- Travas de segurança.
DO $travas$
DECLARE _f oid := 'public.financeiro_comissoes_parcerias_visiveis()'::regprocedure;
BEGIN
  IF has_function_privilege('anon', _f, 'EXECUTE') THEN RAISE NOTICE 'FALHA: anon executa';
  ELSE RAISE NOTICE 'OK: anon não executa'; END IF;
  IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN RAISE NOTICE 'FALHA: authenticated não executa';
  ELSE RAISE NOTICE 'OK: authenticated executa'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = _f) THEN RAISE NOTICE 'OK: SECURITY DEFINER';
  ELSE RAISE NOTICE 'FALHA: não é SECURITY DEFINER'; END IF;
  IF (SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = _f) THEN RAISE NOTICE 'OK: search_path fixo vazio';
  ELSE RAISE NOTICE 'FALHA: search_path não fixo'; END IF;
  IF (SELECT provolatile = 's' FROM pg_proc WHERE oid = _f) THEN RAISE NOTICE 'OK: STABLE (só leitura)';
  ELSE RAISE NOTICE 'FALHA: não é STABLE'; END IF;
END
$travas$;

-- Sem login: recusa com 42501.
DO $anon$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('mt.ctx', '', true);
  BEGIN
    PERFORM public.financeiro_comissoes_parcerias_visiveis();
    RAISE NOTICE 'FALHA: sem login devolveu dados';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: sem login recusado (42501)';
  END;
END
$anon$;

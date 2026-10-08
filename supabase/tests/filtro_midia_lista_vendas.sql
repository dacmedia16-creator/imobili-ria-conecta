-- Suíte do filtro de Mídia nas RPCs da lista de Vendas (20261008140000). Roda num clone local, dentro de
-- transação que termina em ROLLBACK. Saída: linhas "FALHA ..." e uma linha "TOTAL=n".
-- Usa vendas reais do clone, sem alterar nenhuma: compara o resultado com contagens diretas em sales.
BEGIN;

CREATE TEMP TABLE _r (ok boolean, nome text) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated;

-- Admin (vê tudo): sem filtro x filtro por cada mídia x "sem mídia"
DO $$
DECLARE
  adm uuid := (SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
               WHERE ur.role = 'admin' AND coalesce(p.ativo, true) LIMIT 1);
  tot int; soma int; n int; esperado int; m text; v_sem int; v_val numeric; esp_val numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;

  tot := (public.list_vendas_comerciais_paginadas(0, 10)->>'total_count')::int;
  -- parâmetro NULL explícito = sem filtro
  INSERT INTO _r VALUES ((public.list_vendas_comerciais_paginadas(0, 10, _midia => NULL)->>'total_count')::int = tot,
                         'midia NULL = sem filtro');
  soma := 0;
  FOR m IN SELECT DISTINCT midia FROM public.sales WHERE midia IS NOT NULL LOOP
    n := (public.list_vendas_comerciais_paginadas(0, 10, _midia => m)->>'total_count')::int;
    esperado := (SELECT count(*) FROM public.sales WHERE midia = m);
    INSERT INTO _r VALUES (n = esperado, format('midia %s: rpc=%s direto=%s', m, n, esperado));
    soma := soma + n;
  END LOOP;
  v_sem := (public.list_vendas_comerciais_paginadas(0, 10, _midia => '__sem_midia__')->>'total_count')::int;
  INSERT INTO _r VALUES (v_sem = (SELECT count(*) FROM public.sales WHERE midia IS NULL),
                         format('sem midia: rpc=%s', v_sem));
  INSERT INTO _r VALUES (soma + v_sem = tot, format('soma das midias + sem midia (%s) = total (%s)', soma + v_sem, tot));
  -- valor inexistente: nada
  INSERT INTO _r VALUES ((public.list_vendas_comerciais_paginadas(0, 10, _midia => 'Nao Existe')->>'total_count')::int = 0,
                         'midia inexistente = 0');
  -- total_valor respeita o filtro
  v_val := (public.list_vendas_comerciais_paginadas(0, 10, _midia => 'Outro')->>'total_valor')::numeric;
  esp_val := (SELECT coalesce(sum(coalesce(valor_negociado, 0)), 0) FROM public.sales
              WHERE midia = 'Outro' AND status::text NOT IN ('cancelada', 'arquivada'));
  INSERT INTO _r VALUES (v_val = esp_val, format('total_valor Outro rpc=%s direto=%s', v_val, esp_val));
  -- combina com status e período: interseção
  n := (public.list_vendas_comerciais_paginadas(0, 10, _status => 'rascunho', _midia => '__sem_midia__')->>'total_count')::int;
  INSERT INTO _r VALUES (n = (SELECT count(*) FROM public.sales WHERE midia IS NULL AND status::text = 'rascunho'),
                         format('status rascunho + sem midia = %s', n));
  -- período: soma por mídia (+ sem mídia) dentro do período = total do período, e menor que o total geral
  n := (public.list_vendas_comerciais_paginadas(0, 10, _desde => '2026-09-01', _ate => '2026-09-30', _midia => '__sem_midia__')->>'total_count')::int;
  FOR m IN SELECT DISTINCT midia FROM public.sales WHERE midia IS NOT NULL LOOP
    n := n + (public.list_vendas_comerciais_paginadas(0, 10, _desde => '2026-09-01', _ate => '2026-09-30', _midia => m)->>'total_count')::int;
  END LOOP;
  esperado := (public.list_vendas_comerciais_paginadas(0, 10, _desde => '2026-09-01', _ate => '2026-09-30')->>'total_count')::int;
  INSERT INTO _r VALUES (n = esperado AND esperado < tot, format('período set/26: soma por mídia %s = total do período %s', n, esperado));
  n := (public.list_vendas_comerciais_paginadas(0, 10, _desde => '2026-09-01', _ate => '2026-09-30', _midia => 'Outro')->>'total_count')::int;
  INSERT INTO _r VALUES (n < (SELECT count(*) FROM public.sales WHERE midia = 'Outro'), format('período restringe Outro (%s)', n));
  -- linhas retornadas têm mesmo a mídia pedida
  INSERT INTO _r VALUES (NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.list_vendas_comerciais_paginadas(0, 50, _midia => 'Site Remax')->'rows') r
      JOIN public.sales s ON s.id = (r->>'id')::uuid WHERE s.midia IS DISTINCT FROM 'Site Remax'),
    'linhas de Site Remax só têm Site Remax');
  RESET ROLE;
END $$;

-- Corretor comum: filtro só restringe o que ele já vê (subconjunto da visão sem filtro)
DO $$
DECLARE
  cor uuid := (SELECT s.corretor_id FROM public.sales s
               JOIN public.user_roles ur ON ur.user_id = s.corretor_id AND ur.role = 'corretor'
               WHERE NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = s.corretor_id
                                 AND x.role IN ('admin','super_admin','financeiro','juridico','gestor','team_leader'))
               GROUP BY s.corretor_id ORDER BY count(*) DESC LIMIT 1);
  visiveis int; com int; sem int; outras int; m text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cor, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', cor::text, true);
  SET LOCAL ROLE authenticated;
  visiveis := (public.list_vendas_comerciais_paginadas(0, 10)->>'total_count')::int;
  sem := (public.list_vendas_comerciais_paginadas(0, 10, _midia => '__sem_midia__')->>'total_count')::int;
  outras := 0;
  FOR m IN SELECT unnest(ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','Imovelweb','Chaves na Mão','Outro']) LOOP
    outras := outras + (public.list_vendas_comerciais_paginadas(0, 10, _midia => m)->>'total_count')::int;
  END LOOP;
  INSERT INTO _r VALUES (visiveis > 0, format('corretor vê vendas (%s)', visiveis));
  INSERT INTO _r VALUES (outras + sem = visiveis, format('corretor: soma por mídia %s = visíveis %s', outras + sem, visiveis));
  -- fila "Só minha vez" aceita o filtro e nunca devolve mais que sem filtro
  com := (public.list_vendas_comerciais_paginadas_fila(0, 10, _midia => '__sem_midia__')->>'total_count')::int;
  INSERT INTO _r VALUES (com <= (public.list_vendas_comerciais_paginadas_fila(0, 10)->>'total_count')::int,
                         format('fila corretor sem mídia %s <= fila total', com));
  RESET ROLE;
END $$;

-- Sem identidade (anon) continua sem acesso
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.list_vendas_comerciais_paginadas(0, 10, _midia => 'Outro');
    INSERT INTO _r VALUES (false, 'anon executou a RPC');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; INSERT INTO _r VALUES (true, 'anon bloqueado');
  END;
  RESET ROLE;
END $$;

-- Catálogo: só a assinatura nova, ACL igual à anterior
INSERT INTO _r SELECT count(*) = 2, 'uma única versão de cada RPC'
  FROM pg_proc WHERE proname IN ('list_vendas_comerciais_paginadas', 'list_vendas_comerciais_paginadas_fila');
INSERT INTO _r SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                               AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                               AND NOT p.prosecdef), 'ACL: authenticated sim, anon não; security invoker'
  FROM pg_proc p WHERE proname IN ('list_vendas_comerciais_paginadas', 'list_vendas_comerciais_paginadas_fila');

SELECT 'FALHA ' || nome FROM _r WHERE NOT ok;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) FROM _r;
ROLLBACK;

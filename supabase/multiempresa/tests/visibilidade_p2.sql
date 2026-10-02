-- Matriz de visibilidade/escrita por papel (P2: TO authenticated + (SELECT auth.uid())).
-- Rodar ANTES e DEPOIS da migration 20261002000003 e comparar as linhas (devem ser idênticas).
-- Amostra: até 2 usuários por papel + usuário inativo + anon. Tudo em ROLLBACK. Saída sem PII
-- (só uuid do usuário, tabela, contagem e hash).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE vm (u text, t text, r text) ON COMMIT DROP;
GRANT ALL ON vm TO authenticated, anon;
DO $v$
DECLARE u record; t text; r text; n bigint; h text;
  -- activity_logs/sale_documents ficam fora da contagem total (RLS por linha leva ~27 s/usuário,
  -- item P1-B); suas policies só trocaram de papel e activity_logs é medida filtrada em bench_p2.sql.
  tabs text[] := ARRAY['clientes','metas','organization_members','sale_comments','sales',
    'profiles','team_co_leaders','occurrence_commissions','sale_parties','exclusive_history','user_roles',
    'teams','notifications','occurrences'];
  upd text[] := ARRAY['clientes','metas'];
  alvo uuid;
BEGIN
  SELECT id INTO alvo FROM public.sales ORDER BY id LIMIT 1;
  FOR u IN
    WITH amostra AS (
      SELECT DISTINCT ON (ur.role, ur.user_id) ur.role::text k, ur.user_id id,
        row_number() OVER (PARTITION BY ur.role ORDER BY ur.user_id) rn
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
      UNION ALL
      SELECT 'inativo', p.id, row_number() OVER (ORDER BY p.id) FROM public.profiles p WHERE NOT p.ativo
      UNION ALL
      SELECT 'platform', pa.user_id, row_number() OVER (ORDER BY pa.user_id) FROM public.platform_admins pa
    )
    SELECT DISTINCT a.id::text uid, au.raw_app_meta_data am, 'authenticated' rl
    FROM amostra a JOIN auth.users au ON au.id = a.id WHERE a.rn <= 1
    UNION ALL SELECT 'anon', '{}'::jsonb, 'anon'
    ORDER BY 1
  LOOP
    IF u.rl = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated',
        'app_metadata', u.am)::text, true);
    END IF;
    PERFORM set_config('role', u.rl, true);
    FOREACH t IN ARRAY tabs LOOP
      BEGIN
        EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(x::text), '''' ORDER BY md5(x::text)), ''''))
                        FROM public.%I x', t) INTO n, h;
        r := 'sel n=' || n || ' h=' || left(h, 12);
      EXCEPTION WHEN OTHERS THEN r := 'sel erro=' || SQLSTATE;
      END;
      INSERT INTO vm VALUES (u.uid, t, r);
    END LOOP;
    -- Escrita: UPDATE sem efeito exercita USING + WITH CHECK das policies alteradas.
    FOREACH t IN ARRAY upd LOOP
      -- Desfeito na hora (RAISE interno): gatilhos de updated_at não podem vazar para o próximo usuário.
      BEGIN
        EXECUTE format('UPDATE public.%I SET organization_id = organization_id', t);
        GET DIAGNOSTICS n = ROW_COUNT;
        RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
      EXCEPTION
        WHEN SQLSTATE 'P0099' THEN r := 'upd n=' || SQLERRM;
        WHEN OTHERS THEN r := 'upd erro=' || SQLSTATE;
      END;
      INSERT INTO vm VALUES (u.uid, t, r);
    END LOOP;
    -- INSERT em sale_comments (co_leader_comments_insert e demais); desfeito pelo RAISE interno.
    BEGIN
      INSERT INTO public.sale_comments (sale_id, autor_id, texto, organization_id)
      SELECT alvo, nullif(u.uid, 'anon')::uuid, 'p2-teste', s.organization_id FROM public.sales s WHERE s.id = alvo;
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN r := 'ins n=' || SQLERRM;
      WHEN OTHERS THEN r := 'ins erro=' || SQLSTATE;
    END;
    INSERT INTO vm VALUES (u.uid, 'sale_comments', r);
    PERFORM set_config('role', 'none', true);
    RESET ROLE;
  END LOOP;
END $v$;
SELECT 'VIS ' || u || ' ' || t || ' ' || r FROM vm ORDER BY u, t, r;
SELECT 'VIS_TOTAL linhas=' || count(*) || ' usuarios=' || count(DISTINCT u) || ' md5=' ||
  md5(string_agg(u || t || r, '|' ORDER BY u, t, r)) FROM vm;
ROLLBACK;

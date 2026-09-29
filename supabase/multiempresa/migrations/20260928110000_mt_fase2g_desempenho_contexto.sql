-- Fase 2g: desempenho das policies multiempresa (ensaio na cópia real: relatórios 38 s -> 719 s).
--
-- Causa: user_org/current_org_id/mt_1b_gate são SECURITY DEFINER (não são incorporadas à consulta)
-- e são chamadas dentro de is_active_user/can_view_sale/has_any_role/is_lead_of POR LINHA e por
-- verificação aninhada. Cada chamada relia organization_members/organizations/profiles.
--
-- Correção (as regras de isolamento NÃO mudam; as funções devolvem exatamente os mesmos valores):
--  1. A agência do usuário da requisição é resolvida UMA vez por comando e memorizada numa variável
--     de sessão com chave = início do comando + usuário. A fonte continua sendo a tabela (não a claim
--     do token): desativar membro/perfil/agência vale na hora, como antes. Escrita em
--     organization_members/organizations/profiles apaga a memória (gatilho por comando).
--  2. O teste "user_org(x) = current_org_id()" dos guards da 1b vira mt_in_ctx_org(x), que devolve
--     o mesmo resultado (TRUE ou NULL) e memoriza, no mesmo comando, quais usuários já foram vistos.
--  3. Nas policies, has_role/has_any_role/is_active_user com argumentos constantes
--     ((SELECT auth.uid()) e papéis fixos) passam a (SELECT fn(...)), avaliadas uma vez (initPlan).
--
-- Pré-requisito: 1a–2f. Rollback: .down.sql (restaura definições exatas de funções e policies).
BEGIN;
SET LOCAL search_path TO '';
CREATE TABLE public.mt_2g_backup (kind text NOT NULL, name text NOT NULL, ddl text NOT NULL,
  owner_name text, PRIMARY KEY (kind, name));
REVOKE ALL ON public.mt_2g_backup FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 1. Contexto por comando
-- ---------------------------------------------------------------------------------------------
-- _current=false: vínculo ativo em agência ativa (= user_org(auth.uid()) original)
-- _current=true : o mesmo, exigindo perfil ativo (= current_org_id() original)
-- set_config(..., false): a função tem SET search_path e um SET LOCAL feito dentro dela seria
-- desfeito na saída. A chave inclui statement_timestamp(): nada vale para outro comando.
CREATE FUNCTION public.mt_ctx_org(_current boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _key text := statement_timestamp()::text || '|' || coalesce(_uid::text, '-');
  _val text := current_setting('mt.ctx', true);
  _u uuid; _c uuid;
BEGIN
  IF _val IS NOT NULL AND split_part(_val, '#', 1) = _key THEN
    RETURN nullif(split_part(_val, '#', CASE WHEN _current THEN 3 ELSE 2 END), '')::uuid;
  END IF;
  IF _uid IS NOT NULL THEN
    SELECT m.organization_id INTO _u FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id
     WHERE m.user_id = _uid AND m.ativo AND o.status = 'ativa';
    IF _u IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND ativo IS TRUE) THEN
      _c := _u;
    END IF;
  END IF;
  PERFORM set_config('mt.ctx', _key || '#' || coalesce(_u::text, '') || '#' || coalesce(_c::text, ''), false);
  PERFORM set_config('mt.ctx_m', _key || '#', false);
  RETURN CASE WHEN _current THEN _c ELSE _u END;
END $$;

-- Equivale a "public.user_org(_x) = public.current_org_id()" da 1b: TRUE quando _x tem vínculo
-- ativo na agência (ativa) do usuário da requisição com perfil ativo; senão NULL (como antes).
CREATE FUNCTION public.mt_in_ctx_org(_x uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c uuid := public.mt_ctx_org(true); _val text; _hit boolean;
BEGIN
  IF _c IS NULL OR _x IS NULL THEN RETURN NULL; END IF;
  IF _x = auth.uid() THEN RETURN TRUE; END IF;
  _val := current_setting('mt.ctx_m', true);
  IF position(';' || _x::text || '=1' IN _val) > 0 THEN RETURN TRUE; END IF;
  IF position(';' || _x::text || '=0' IN _val) > 0 THEN RETURN NULL; END IF;
  _hit := EXISTS (SELECT 1 FROM public.organization_members m
    WHERE m.user_id = _x AND m.ativo AND m.organization_id = _c);
  PERFORM set_config('mt.ctx_m', _val || ';' || _x::text || CASE WHEN _hit THEN '=1' ELSE '=0' END, false);
  RETURN CASE WHEN _hit THEN TRUE END;
END $$;
REVOKE ALL ON FUNCTION public.mt_ctx_org(boolean), public.mt_in_ctx_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mt_ctx_org(boolean), public.mt_in_ctx_org(uuid) TO authenticated, service_role;

-- Qualquer mudança de vínculo, agência ou perfil apaga a memória do comando em curso.
CREATE FUNCTION public.mt_ctx_invalidate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  PERFORM set_config('mt.ctx', '', false);
  PERFORM set_config('mt.ctx_m', '', false);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.mt_ctx_invalidate() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mt_2g_ctx_invalidate AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.organization_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.mt_ctx_invalidate();
CREATE TRIGGER mt_2g_ctx_invalidate AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.organizations
  FOR EACH STATEMENT EXECUTE FUNCTION public.mt_ctx_invalidate();
CREATE TRIGGER mt_2g_ctx_invalidate AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.profiles
  FOR EACH STATEMENT EXECUTE FUNCTION public.mt_ctx_invalidate();

-- ---------------------------------------------------------------------------------------------
-- 2. Funções de contexto e guards (backup exato antes)
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.mt_2g_backup(kind, name, ddl, owner_name)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
  FROM pg_catalog.pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND (p.oid IN ('public.user_org(uuid)'::regprocedure, 'public.current_org_id()'::regprocedure,
                  'public.mt_1b_gate(uuid)'::regprocedure)
        OR pg_get_functiondef(p.oid) ~ 'public\.user_org\([a-z_]+\) = public\.current_org_id\(\)');

-- Mesmas regras da 1b. Para outro usuário: só se estiver na agência (ativa) do chamador, o que
-- equivale ao EXISTS original no vínculo ativo do chamador (um vínculo por usuário).
-- plpgsql (e não sql): no Postgres 17 uma função SQL não incorporável chamada dentro de outra é
-- replanejada a cada chamada; plpgsql guarda o plano na sessão. A lógica é a mesma.
-- DROP + CREATE não é possível (policies dependem delas); troca de linguagem via CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.user_org(_user uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _org uuid;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  IF _user = auth.uid() THEN RETURN public.mt_ctx_org(false); END IF;
  SELECT m.organization_id INTO _org FROM public.organization_members m
    JOIN public.organizations o ON o.id=m.organization_id
   WHERE m.user_id=_user AND m.ativo AND o.status='ativa';
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF _org = public.mt_ctx_org(false)
     OR current_setting('role',true)='service_role'
     OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')) THEN
    RETURN _org;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN public.mt_ctx_org(true);
END $$;
CREATE OR REPLACE FUNCTION public.mt_1b_gate(_target_org uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c uuid;
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR (current_setting('role', true) = 'none' AND session_user IN ('supabase_admin', 'postgres')) THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  _c := public.mt_ctx_org(true);
  RETURN _c IS NOT NULL AND (_target_org IS NULL OR _target_org = _c);
END $$;

DO $guards$
DECLARE f record; n int := 0; d text; body text;
BEGIN
  FOR f IN SELECT b.name, b.ddl, b.owner_name FROM public.mt_2g_backup b
            WHERE b.kind = 'function' AND b.ddl ~ 'public\.user_org\([a-z_]+\) = public\.current_org_id\(\)'
              AND b.name NOT IN ('public.user_org(uuid)', 'public.current_org_id()', 'public.mt_1b_gate(uuid)') LOOP
    -- (a) guard da 1b; (b) no corpo, "= public.user_org(_param)" depende só do parâmetro:
    -- vira subconsulta escalar (initPlan), calculada uma vez por chamada e não por linha.
    d := regexp_replace(
      regexp_replace(f.ddl, 'public\.user_org\(([a-z_]+)\) = public\.current_org_id\(\)',
                     'public.mt_in_ctx_org(\1)', 'g'),
      '= public\.user_org\((_[a-z_]+)\)', '= (SELECT public.user_org(\1))', 'g');
    -- (c) mesma expressão, em plpgsql: o plano fica em cache na sessão em vez de ser refeito a
    -- cada chamada (função SQL não incorporável). Resultado idêntico: RETURN (SELECT <corpo>).
    body := regexp_replace(btrim(split_part(split_part(d, 'AS $function$', 2), '$function$', 1), E' \n\r\t'),
                           ';[[:space:]]*$', '');
    IF regexp_replace(body, '^([[:space:]]*--[^\n]*\n)*[[:space:]]*', '') !~* '^select'
       OR d !~ 'LANGUAGE sql' THEN RAISE EXCEPTION 'DDL inesperado em %', f.name; END IF;
    d := replace(split_part(d, 'AS $function$', 1), 'LANGUAGE sql', 'LANGUAGE plpgsql')
      || E'AS $function$\nBEGIN\n  RETURN (' || body || E');\nEND\n$function$';
    EXECUTE d;
    IF (SELECT proowner::regrole::text FROM pg_catalog.pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono alterado em %', f.name;
    END IF;
    n := n + 1;
  END LOOP;
  IF n < 15 THEN RAISE EXCEPTION 'Guards 2g incompletos (%)', n; END IF;
END $guards$;

-- ---------------------------------------------------------------------------------------------
-- 3. Policies: helper com argumentos constantes vira initPlan
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE mt_2g_pol ON COMMIT DROP AS
SELECT n.nspname sch, c.relname tab, pl.polname pol,
       pg_get_expr(pl.polqual, pl.polrelid) q, pg_get_expr(pl.polwithcheck, pl.polrelid) w
  FROM pg_catalog.pg_policy pl JOIN pg_catalog.pg_class c ON c.oid = pl.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'storage')
   AND (coalesce(pg_get_expr(pl.polqual, pl.polrelid), '') || coalesce(pg_get_expr(pl.polwithcheck, pl.polrelid), ''))
       ~ 'public\.(is_active_user|has_role|has_any_role)\(\( SELECT auth\.uid\(\) AS uid\)';
INSERT INTO public.mt_2g_backup(kind, name, ddl)
SELECT 'policy', format('%I.%I.%I', sch, tab, pol),
       format('ALTER POLICY %I ON %I.%I', pol, sch, tab)
         || CASE WHEN q IS NOT NULL THEN format(' USING (%s)', q) ELSE '' END
         || CASE WHEN w IS NOT NULL THEN format(' WITH CHECK (%s)', w) ELSE '' END
  FROM mt_2g_pol;
DO $pol$
DECLARE p record; re text :=
  'public\.(is_active_user|has_role|has_any_role)\(\( SELECT auth\.uid\(\) AS uid\)((, ARRAY\[[^]]*\])|(, ''[a-z_]+''::public\.app_role))?\)';
  q text; w text; n int := 0;
BEGIN
  FOR p IN SELECT * FROM mt_2g_pol LOOP
    q := regexp_replace(p.q, re, '( SELECT public.\1(( SELECT auth.uid() AS uid)\2))', 'g');
    w := regexp_replace(p.w, re, '( SELECT public.\1(( SELECT auth.uid() AS uid)\2))', 'g');
    EXECUTE format('ALTER POLICY %I ON %I.%I', p.pol, p.sch, p.tab)
      || CASE WHEN q IS NOT NULL THEN format(' USING (%s)', q) ELSE '' END
      || CASE WHEN w IS NOT NULL THEN format(' WITH CHECK (%s)', w) ELSE '' END;
    n := n + 1;
  END LOOP;
  IF n < 30 THEN RAISE EXCEPTION 'Policies 2g incompletas (%)', n; END IF;
END $pol$;
COMMIT;

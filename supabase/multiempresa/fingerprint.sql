-- Impressão digital estrutural de public/storage (para comparar antes/depois do rollback).
SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con:' || c.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid)
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE k.connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'pol:' || schemaname || '.' || tablename || '.' || policyname || ':' || permissive || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname IN ('public', 'storage')
  UNION ALL SELECT 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, '')
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL SELECT 'trg:' || pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relnamespace IN ('public'::regnamespace, 'auth'::regnamespace)
  UNION ALL SELECT 'tbl:' || relname || ':' || relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
) s(x);

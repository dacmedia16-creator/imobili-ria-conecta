-- Contagens estruturais do clone para comparar com o catálogo implantado.
SELECT 'tables', count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND relkind IN ('r','p')
UNION ALL SELECT 'rls_on', count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity
UNION ALL SELECT 'columns', count(*) FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL SELECT 'constraints', count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0
UNION ALL SELECT 'policies_public', count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'policies_storage', count(*) FROM pg_policies WHERE schemaname = 'storage'
UNION ALL SELECT 'functions', count(*) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND prokind IN ('f','p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
UNION ALL SELECT 'secdef', count(*) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND prosecdef
UNION ALL SELECT 'triggers_public', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT tgisinternal AND c.relnamespace = 'public'::regnamespace
UNION ALL SELECT 'indexes_nonconstraint', count(*) FROM pg_indexes i WHERE schemaname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname = i.indexname AND k.connamespace = 'public'::regnamespace)
UNION ALL SELECT 'buckets', count(*) FROM storage.buckets;

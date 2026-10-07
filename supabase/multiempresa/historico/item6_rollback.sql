-- Reversão do item 6: apaga SÓ os 2 registros criados (não mexe no schema).
BEGIN;
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261002000002', '20261002000003')
   AND created_by = 'max-tecnologia'
   AND idempotency_key IN ('max-tecnologia-20261002000002', 'max-tecnologia-20261002000003');
-- Esperado: DELETE 2. Conferir com item6_conferir.sql (volta a total 286).
COMMIT;

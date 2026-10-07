-- Conferência antes/depois (somente leitura).
SELECT version, name, created_by, idempotency_key, length(statements[1]) AS tamanho,
       encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') AS sha256
  FROM supabase_migrations.schema_migrations
 WHERE version LIKE '20261002%' ORDER BY version;
SELECT count(*) AS total, max(version) AS topo FROM supabase_migrations.schema_migrations;
-- Antes: só 20261002120000 e total 286. Depois: + 000002 e 000003, total 288, sha256 =
--   20261002000002  41efba1b17fe4affdb22de03cf7cc4383a974e2a92a8ba65d20a6d188338adab
--   20261002000003  51b0ab8174274df914e01f2e45b42a6f5e6d639eeb43f25566afd627a96650f1

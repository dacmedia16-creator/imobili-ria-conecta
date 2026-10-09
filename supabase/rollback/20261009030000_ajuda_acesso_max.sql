-- Rollback de 20261009030000_ajuda_acesso_max.sql (rodar com psql a partir da raiz do repositório).
-- Antes: desligar o verificador (cron do MAX) e apagar o .env da credencial do perfil do MAX.
-- As mensagens já enviadas pelo MAX ficam no chamado (são histórico do usuário); nada é apagado.
-- Depois de rodar, remover a linha 20261009030000 de supabase_migrations.schema_migrations.
BEGIN;

-- Derruba sessões abertas do papel (se houver) e impede novas.
ALTER ROLE max_suporte_bot NOLOGIN;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'max_suporte_bot';

DROP FUNCTION IF EXISTS max_suporte.pendentes(timestamptz, integer);
DROP FUNCTION IF EXISTS max_suporte.chamado(uuid);
DROP FUNCTION IF EXISTS max_suporte.responder(uuid, text, text);
DROP FUNCTION IF EXISTS max_suporte.mudar_status(uuid, text);
ALTER DEFAULT PRIVILEGES IN SCHEMA max_suporte GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
DROP SCHEMA IF EXISTS max_suporte;
DROP ROLE IF EXISTS max_suporte_bot;

-- Devolve o EXECUTE para PUBLIC como era antes (o explícito de anon/authenticated/service_role já
-- existia antes da migration e fica como está).
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.archive_sale_document(uuid)',
    'public.change_sale_status(uuid,text,text)',
    'public.cliente_historico(uuid,uuid)',
    'public.criar_ocorrencia_lancamento(uuid)',
    'public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)',
    'public.list_active_corretores()',
    'public.list_active_gestores()',
    'public.list_active_team_leaders()',
    'public.list_active_users()'
  ] LOOP
    IF to_regprocedure(_f) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', _f);
    END IF;
  END LOOP;
END $$;

COMMIT;

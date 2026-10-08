-- Rollback de 20261008220000_ajuda_sugestoes.sql (rodar com psql a partir da raiz do repositório).
-- Fazer junto com o rollback do frontend (as telas chamam as RPCs support_ticket_*).
-- ATENÇÃO: apaga os chamados e as mensagens. Antes, se quiser guardar, exporte:
--   \copy (SELECT * FROM public.support_tickets) TO 'support_tickets.csv' CSV HEADER
--   \copy (SELECT * FROM public.support_ticket_messages) TO 'support_ticket_messages.csv' CSV HEADER
-- Os prints e o bucket support-attachments NÃO são apagados por SQL (o Storage protege DELETE
-- direto): ver o passo do painel no fim do arquivo.
-- Depois de rodar, remover a linha 20261008220000 de supabase_migrations.schema_migrations.
BEGIN;

DELETE FROM public.notifications WHERE support_ticket_id IS NOT NULL;
DROP INDEX IF EXISTS public.notifications_support_ticket_idx;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS support_ticket_id;

DROP FUNCTION IF EXISTS public.support_ticket_create(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.support_ticket_reply(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.support_ticket_set_status(uuid, text);
DROP FUNCTION IF EXISTS public.support_ticket_list(text);
DROP FUNCTION IF EXISTS public.support_ticket_thread(uuid);
DROP FUNCTION IF EXISTS public.support_ticket_print_path(uuid);

DROP TABLE IF EXISTS public.support_ticket_messages;
DROP TABLE IF EXISTS public.support_tickets;
-- O bucket NÃO sai por SQL (o Storage bloqueia DELETE direto). Ele fica privado e sem acesso pelo
-- navegador; para removê-lo: painel > Storage > support-attachments > Empty bucket > Delete bucket.
COMMIT;

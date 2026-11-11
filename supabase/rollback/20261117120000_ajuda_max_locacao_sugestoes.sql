-- Rollback de 20261117120000_ajuda_max_locacao_sugestoes.sql (Ajuda MAX na Locação, fatia 2/2, t_365484dc).
-- Remove as 4 RPCs e os chamados com origem 'locacao' (as mensagens e avisos do sino caem em cascata) e volta o
-- CHECK da origem. Chamados de outras origens não são tocados.
-- ANTES de rodar: apagar do bucket privado support-attachments os prints desses chamados (pela API de Storage com
-- service_role), listados por:
--   SELECT print_path FROM public.support_tickets WHERE origem = 'locacao' AND print_path IS NOT NULL;
-- Reverter junto o front (fechar/reverter o PR).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.ajuda_max_locacao_sugestao_print(uuid);
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_sugestao_status(uuid, text);
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_sugestoes();
DROP FUNCTION IF EXISTS public.ajuda_max_locacao_registrar(text, text, text, text, text, text);

DELETE FROM public.support_tickets WHERE origem = 'locacao';

ALTER TABLE public.support_tickets DROP CONSTRAINT support_tickets_origem_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_origem_check
  CHECK (origem IN ('adm', 'estudo', 'visita'));
COMMENT ON COLUMN public.support_tickets.origem IS
  'Onde o chamado foi aberto. adm e estudo vão para o MAX Tecnologia; visita vai para o MAX Visita Prova.';

COMMIT;

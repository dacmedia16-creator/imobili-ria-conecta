-- Rollback da 20261214120000_locacao_vistoria_agenda (t_c3ea1b18).
-- Apaga as funções e o gatilho novos e devolve a lista de eventos da fila. Os avisos de vistoria já gravados são
-- apagados (a lista antiga não os aceita). O agendamento gravado em locacoes.pos->'vistoria_agenda' FICA (é só um
-- campo a mais no JSON, ignorado pela tela antiga); para limpar também:
--   UPDATE public.locacoes SET pos = pos - 'vistoria_agenda' WHERE pos ? 'vistoria_agenda';
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DROP TRIGGER IF EXISTS locacao_zz_avisos_vistoria ON public.locacoes;
DROP FUNCTION IF EXISTS public.locacao_trg_avisos_vistoria();
DROP FUNCTION IF EXISTS public.locacao_vistoria_aviso_atual(uuid);
DROP FUNCTION IF EXISTS public.locacao_vistoria_lembretes_gerar(integer);
DROP FUNCTION IF EXISTS public.locacao_vistoria_agendar(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.locacao_vistoria_quando(timestamptz);
DELETE FROM public.locacao_avisos WHERE evento IN ('vistoria_vespera', 'vistoria_2h', 'vistoria_concluida');
ALTER TABLE public.locacao_avisos DROP CONSTRAINT locacao_avisos_evento_check;
ALTER TABLE public.locacao_avisos ADD CONSTRAINT locacao_avisos_evento_check
  CHECK (evento IN ('minuta_enviada', 'pendencia', 'ajuste', 'devolvida', 'andamento'));
COMMIT;

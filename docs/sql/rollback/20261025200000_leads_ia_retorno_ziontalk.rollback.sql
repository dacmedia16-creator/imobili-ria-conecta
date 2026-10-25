-- Rollback de 20261025200000_leads_ia_retorno_ziontalk (card t_6f688b4b).
-- Desliga o retorno ZionTalk -> ADM e a escolha de modelo. Perde: eventos do retorno (dedup) e o registro de uso
-- dos modelos. Antes, exporte se precisar: COPY (SELECT * FROM public.lead_ia_uso) TO STDOUT WITH CSV HEADER;
-- As conversas e mensagens da IA (20261025180000) continuam.
BEGIN;
DROP FUNCTION IF EXISTS public.lead_ia_modelo_salvar(text, text);
DROP FUNCTION IF EXISTS public.lead_ia_retorno_token(text);
DROP FUNCTION IF EXISTS public.lead_ia_canal_numero_definir(uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_retorno_receber(text, jsonb);
DROP TABLE IF EXISTS public.lead_ia_uso;
DROP TABLE IF EXISTS public.lead_ia_retorno_eventos;
DROP INDEX IF EXISTS public.lead_config_ia_retorno_hash_uniq;
ALTER TABLE public.lead_config
  DROP COLUMN IF EXISTS ia_retorno_token_hash,
  DROP COLUMN IF EXISTS ia_retorno_token_em,
  DROP COLUMN IF EXISTS ia_canal_numero,
  DROP COLUMN IF EXISTS ia_resp_max_conversa,
  DROP COLUMN IF EXISTS ia_resp_max_minuto,
  DROP COLUMN IF EXISTS ia_modelo_provedor,
  DROP COLUMN IF EXISTS ia_modelo;
COMMIT;

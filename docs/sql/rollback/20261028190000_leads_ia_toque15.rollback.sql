-- Rollback de 20261028190000_leads_ia_toque15 (t_b3f753a5).
-- Ordem segura: publique ANTES o código anterior (rota /api/leads/reengajar sem o toque de 15 min), depois rode este
-- arquivo. Apaga as 6 funções e as colunas novas. Mensagens já enviadas e eventos no histórico ficam.
BEGIN;
DROP FUNCTION IF EXISTS public.lead_ia_toque15_salvar(boolean);
DROP FUNCTION IF EXISTS public.lead_ia_toque15_gravar(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_toque15_candidatas();
DROP FUNCTION IF EXISTS public.lead_ia_toque15_elegivel(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_ia_toque15_horario(timestamptz);
DROP FUNCTION IF EXISTS public.lead_ia_toque15_hoje(uuid);
ALTER TABLE public.lead_conversas DROP COLUMN IF EXISTS toque15_em;
ALTER TABLE public.lead_config DROP COLUMN IF EXISTS ia_toque15_min, DROP COLUMN IF EXISTS ia_toque15;
COMMIT;

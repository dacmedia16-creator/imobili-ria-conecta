-- t_3ea838d7 (Denis 27/10, tópico 6238): teste do DeepSeek só na ZZ.
-- lead_ia_uso.rota = provedor que DE FATO respondeu no OpenRouter (ex.: "Relace", "DeepInfra"); null no
-- Gemini direto ou quando a chamada falhou. Só o nome do provedor, nunca conteúdo.
-- Aditiva: coluna nula, sem default, sem mudança de RLS (a tabela já tem RLS e só o servidor grava).
-- A escolha do modelo por imobiliária já existe (lead_config.ia_modelo_provedor / ia_modelo); a troca da ZZ
-- para o DeepSeek é um UPDATE à parte, fora desta migration.
BEGIN;

ALTER TABLE public.lead_ia_uso
  ADD COLUMN IF NOT EXISTS rota text
  CONSTRAINT lead_ia_uso_rota_check CHECK (rota IS NULL OR char_length(rota) BETWEEN 1 AND 40);

COMMENT ON COLUMN public.lead_ia_uso.rota IS
  'Provedor que respondeu no OpenRouter (ex.: Relace). Null no Gemini direto ou em erro. t_3ea838d7';

COMMIT;

-- ID RE/MAX do corretor (9 dígitos, ex.: 630601272). Liga os anúncios dos portais
-- (código 630601272-190) ao corretor para o Feedback ao Proprietário.
-- Não é dado sensível: é público nos anúncios. Único por imobiliária.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS remax_id text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_remax_id_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_remax_id_format
  CHECK (remax_id IS NULL OR remax_id ~ '^[0-9]{9}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_remax_id_org_uniq
  ON public.profiles (organization_id, remax_id) WHERE remax_id IS NOT NULL;

-- SELECT em profiles é concedido por coluna (ver 20260925100000); libera só esta.
GRANT SELECT (remax_id) ON public.profiles TO authenticated;

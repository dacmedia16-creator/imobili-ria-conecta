-- Rollback de 20261029180000_captacao_testemunhas_automaticas.sql (t_e8078685).
-- Antes de rodar: voltar a edge clicksign-send e a tela para a versão anterior (testemunhas digitadas
-- e corretor como parte). Envelopes já enviados não dependem destas colunas.
DROP FUNCTION IF EXISTS public.exclusive_testemunhas_fixar(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunha_gestor_escolher(uuid, uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunhas_candidatos(uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunhas(uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunhas_acesso(uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunhas_resolver(uuid);
DROP FUNCTION IF EXISTS public.exclusive_testemunha_pessoa(uuid, uuid, text);
ALTER TABLE public.exclusive_captures
  DROP COLUMN IF EXISTS testemunhas_pdf,
  DROP COLUMN IF EXISTS testemunha_gestor_id;

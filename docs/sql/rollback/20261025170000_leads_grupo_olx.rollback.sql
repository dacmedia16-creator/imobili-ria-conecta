-- Rollback da migration 20261025170000_leads_grupo_olx.sql (card t_478b211e).
-- Volta ao estado de 20261025160000: some a recepção do Grupo ZAP, o token, as colunas do anúncio
-- e o contador anti-abuso; a origem 'grupo_olx' deixa de existir.
-- Ordem segura:
--   1) No Canal Pro, cole de volta a URL anterior (ou apague a do ADM) — senão o Grupo OLX recebe 401
--      e guarda os leads por até 14 dias para reenviar.
--   2) Publique (git revert + deploy:safe) a versão do app sem a rota /api/leads/grupo-olx e sem o
--      bloco "Grupo ZAP" na configuração.
--   3) Rode este arquivo.
-- PARA SEM APAGAR NADA se já existir lead com origem 'grupo_olx' (dado real de cliente). Nesse caso,
-- decida antes (com Denis) se esses leads serão anonimizados, apagados ou mudados para origem 'outro'.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leads WHERE origem = 'grupo_olx') THEN
    RAISE EXCEPTION 'Existem leads do Grupo ZAP (origem grupo_olx). Decida o destino deles antes do rollback.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.lead_grupo_olx_token(text);
DROP FUNCTION IF EXISTS public.lead_grupo_olx_receber(text, jsonb);
DROP FUNCTION IF EXISTS public.lead_portal_captacao(uuid, text);
DROP FUNCTION IF EXISTS public.lead_portal_limpar_mensagem(text);
DROP TABLE IF EXISTS public.lead_portal_recebimentos;

-- lead_inserir: cópia literal de 20261025150000_leads_p2p3_distribuicao.sql.
CREATE OR REPLACE FUNCTION public.lead_inserir(_org uuid, _nome text, _telefone text, _email text, _origem text,
  _mensagem text, _capture_id uuid, _autor uuid, _simulado boolean, _consentimento text, _externo_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro') THEN
    RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023';
  END IF;
  IF _capture_id IS NOT NULL THEN
    SELECT c.captor_id INTO _captador FROM public.exclusive_captures c
     WHERE c.id = _capture_id AND c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  END IF;
  INSERT INTO public.leads (organization_id, nome, telefone, email, origem, mensagem, capture_id, captador_id,
                            created_by, simulado, consentimento_em, consentimento_texto, externo_id)
  VALUES (_org, btrim(_nome), _tel, nullif(lower(btrim(coalesce(_email, ''))), ''), _origem,
          nullif(btrim(coalesce(_mensagem, '')), ''), _capture_id, _captador, _autor, coalesce(_simulado, false),
          CASE WHEN nullif(btrim(coalesce(_consentimento, '')), '') IS NOT NULL THEN now() END,
          nullif(btrim(coalesce(_consentimento, '')), ''), _externo_id)
  RETURNING id INTO _id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _id, 'criado', _origem, _autor);
  IF _capture_id IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'vinculo', _captador::text, _autor);
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.lead_inserir(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;

-- lead_config: o app volta a ler a tabela inteira (como antes desta migration).
DROP INDEX IF EXISTS public.lead_config_grupo_olx_hash_uniq;
ALTER TABLE public.lead_config DROP COLUMN IF EXISTS grupo_olx_token_hash, DROP COLUMN IF EXISTS grupo_olx_token_em;
DO $$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.lead_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('REVOKE SELECT (%s) ON public.lead_config FROM authenticated', _cols);
END $$;
GRANT SELECT ON public.lead_config TO authenticated;

ALTER TABLE public.leads DROP COLUMN IF EXISTS anuncio_codigo, DROP COLUMN IF EXISTS anuncio_portal_id,
  DROP COLUMN IF EXISTS portal_tipo, DROP COLUMN IF EXISTS portal_temperatura, DROP COLUMN IF EXISTS portal_transacao;

ALTER TABLE public.leads DROP CONSTRAINT leads_origem_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_origem_check
  CHECK (origem IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro'));
COMMIT;

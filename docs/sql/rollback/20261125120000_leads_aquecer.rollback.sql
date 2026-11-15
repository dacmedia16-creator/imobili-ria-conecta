-- Rollback de 20261125120000_leads_aquecer (t_a2cae373). Apaga o aquecimento inteiro (tabelas, histórico, colunas,
-- funções) e devolve lead_ia_status_saida e lead_ia_envio_reservar iguais às versões no ar antes da migration
-- (texto conferido por md5 igual em produção e homologação em 15/11/2026). lead_ia_liberado não é alterada.
-- Conversas e mensagens dos leads ficam (as do aquecimento seguem no histórico como mensagens da IA), mas antes de
-- apagar: mensagens ainda pendentes de leads retomados pelo aquecimento viram "não enviada" e essas conversas param,
-- para nada sair depois pelo chip de atendimento.
-- Desfazer sem rollback (recomendado antes): UPDATE public.lead_config SET aquecer_ativo = false;
BEGIN;

UPDATE public.lead_mensagens m SET status = 'nao_enviada'
  FROM public.lead_aquecer a
 WHERE m.conversa_id = a.conversa_id AND m.status IN ('pendente', 'enviando') AND a.estado = 'retomado';
UPDATE public.lead_conversas cv SET estado = 'parada', passo = 'fim', encerrada_em = coalesce(cv.encerrada_em, now()),
       updated_at = now(), resumo = left(coalesce(cv.resumo || ' ', '') || 'IA pausada: aquecimento removido.', 1000)
  FROM public.lead_aquecer a
 WHERE cv.id = a.conversa_id AND a.estado = 'retomado' AND cv.estado = 'ativa';

CREATE OR REPLACE FUNCTION public.lead_ia_status_saida(_conversa uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT 'pendente' FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
     WHERE cv.id = _conversa AND cv.canal = 'ziontalk' AND c.ia_canal = 'ziontalk'
       AND l.telefone IS NOT NULL AND NOT l.simulado
       AND public.lead_ia_liberado(c, l)), 'nao_enviada')
$function$;

CREATE OR REPLACE FUNCTION public.lead_ia_envio_reservar(_lead uuid)
 RETURNS TABLE(msg_id uuid, telefone text, texto text, primeira boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _m public.lead_mensagens; _hoje integer;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead FOR UPDATE;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  IF _l.id IS NULL OR _cv.id IS NULL OR _c.organization_id IS NULL THEN RETURN; END IF;
  IF NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _cv.canal <> 'ziontalk' OR _l.simulado
     OR NOT public.lead_ia_liberado(_c, _l)
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                     AND module = 'leads' AND enabled)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _l.organization_id
                 AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))
                 AND _cv.estado <> 'optout') THEN
    RETURN;
  END IF;
  SELECT * INTO _m FROM public.lead_mensagens WHERE conversa_id = _cv.id AND status = 'pendente'
   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _m.id IS NULL THEN RETURN; END IF;
  IF _cv.primeira_enviada_em IS NULL THEN
    SELECT count(*) INTO _hoje FROM public.lead_conversas
     WHERE organization_id = _cv.organization_id AND primeira_enviada_em IS NOT NULL
       AND (primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    IF _hoje >= _c.ia_envio_limite_dia THEN RETURN; END IF;
  END IF;
  UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
  msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := _cv.primeira_enviada_em IS NULL;
  RETURN NEXT;
END $function$;

DROP FUNCTION IF EXISTS public.lead_aquecer_envio_reservar(uuid, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_falha_canal(text, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_config();
DROP FUNCTION IF EXISTS public.lead_aquecer_salvar(boolean, integer, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.lead_aquecer_pausar(boolean);
DROP FUNCTION IF EXISTS public.lead_aquecer_retorno_token(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_previa();
DROP FUNCTION IF EXISTS public.lead_aquecer_painel(integer);
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_definir(uuid, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_do_lead(uuid);
DROP FUNCTION IF EXISTS public.lead_aquecer_pendentes(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_retorno_receber(text, jsonb);
DROP FUNCTION IF EXISTS public.lead_aquecer_resultado(uuid, text, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_preparar(text, timestamptz);
DROP FUNCTION IF EXISTS public.lead_aquecer_freio(uuid, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_pausar_interno(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.lead_aquecer_nome(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_frase(public.leads);
DROP FUNCTION IF EXISTS public.lead_aquecer_texto_ok(text, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_texto(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_motivo_nao(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_resposta_tipo(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_elegivel(public.leads, integer);
DROP FUNCTION IF EXISTS public.lead_aquecer_teve_contato(public.leads);
DROP FUNCTION IF EXISTS public.lead_aquecer_ultima_interacao(public.leads);
DROP FUNCTION IF EXISTS public.lead_aquecer_enviados_hoje(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.lead_aquecer_limite_hoje(public.lead_config, timestamptz);
DROP FUNCTION IF EXISTS public.lead_aquecer_horario(boolean, timestamptz);

DROP TABLE IF EXISTS public.lead_aquecer_envios;
DROP TABLE IF EXISTS public.lead_aquecer_pausas;
DROP TABLE IF EXISTS public.lead_aquecer;

DROP INDEX IF EXISTS public.lead_config_aquecer_hash_uniq;
ALTER TABLE public.lead_config
  DROP CONSTRAINT IF EXISTS lead_config_aquecer_intervalo_check,
  DROP CONSTRAINT IF EXISTS lead_config_aquecer_chip_separado,
  DROP COLUMN IF EXISTS aquecer_ativo,
  DROP COLUMN IF EXISTS aquecer_dias,
  DROP COLUMN IF EXISTS aquecer_limite_dia,
  DROP COLUMN IF EXISTS aquecer_rampa_inicio,
  DROP COLUMN IF EXISTS aquecer_rampa_passo,
  DROP COLUMN IF EXISTS aquecer_rampa_desde,
  DROP COLUMN IF EXISTS aquecer_intervalo_min_s,
  DROP COLUMN IF EXISTS aquecer_intervalo_max_s,
  DROP COLUMN IF EXISTS aquecer_lembrete_dias,
  DROP COLUMN IF EXISTS aquecer_freio_taxa,
  DROP COLUMN IF EXISTS aquecer_freio_min,
  DROP COLUMN IF EXISTS aquecer_pausado_em,
  DROP COLUMN IF EXISTS aquecer_pausa_motivo,
  DROP COLUMN IF EXISTS aquecer_proximo_em,
  DROP COLUMN IF EXISTS aquecer_chip_numero,
  DROP COLUMN IF EXISTS aquecer_retorno_token_hash,
  DROP COLUMN IF EXISTS aquecer_retorno_token_em;

COMMIT;

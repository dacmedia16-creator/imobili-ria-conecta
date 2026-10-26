-- Rollback de 20261026170000_leads_ia_roteiro_lais (card t_fc4d9b27).
-- Volta a Nicole ao roteiro publicado em 25/10 (20261025180000 + 20261025200000): 1ª mensagem antiga,
-- lead_ia_aplicar com 7 argumentos, sem ficha, sem busca por código, sem reengajamento.
-- Perde: o texto editado da 1ª mensagem, a chave do reengajamento e as marcas de toque das conversas.
-- ANTES de rodar, publique de novo o servidor anterior (o código novo chama lead_ia_aplicar com 8 argumentos).
-- Conversas abertas em passo novo ('codigo', 'visita') ou encerradas com motivo novo ('visita', 'nao_lead')
-- são ajustadas para valores antigos ANTES de restaurar as restrições.
BEGIN;

DROP FUNCTION IF EXISTS public.lead_ia_reengajar_reservar();
DROP FUNCTION IF EXISTS public.lead_ia_roteiro_salvar(text, boolean);
DROP FUNCTION IF EXISTS public.lead_ia_imovel_por_codigo(uuid, text);

-- Dados: passos e motivos novos -> antigos.
UPDATE public.lead_conversas SET passo = 'proximo_passo' WHERE passo IN ('codigo', 'visita');
UPDATE public.lead_conversas SET motivo_fim = 'qualificado' WHERE motivo_fim = 'visita';
UPDATE public.lead_conversas SET motivo_fim = 'pediu_pessoa' WHERE motivo_fim = 'nao_lead';

ALTER TABLE public.lead_conversas DROP CONSTRAINT IF EXISTS lead_conversas_passo_check;
ALTER TABLE public.lead_conversas ADD CONSTRAINT lead_conversas_passo_check
  CHECK (passo IN ('interesse', 'finalidade', 'prazo', 'pagamento', 'faixa', 'regiao', 'proximo_passo', 'fim'));
ALTER TABLE public.lead_conversas DROP CONSTRAINT IF EXISTS lead_conversas_motivo_fim_check;
ALTER TABLE public.lead_conversas ADD CONSTRAINT lead_conversas_motivo_fim_check
  CHECK (motivo_fim IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse', 'optout', 'parada_manual', 'limite'));
DROP INDEX IF EXISTS public.lead_conversas_reengajar_idx;
ALTER TABLE public.lead_conversas DROP COLUMN IF EXISTS reengaje_1_em, DROP COLUMN IF EXISTS reengaje_2_em;

-- lead_ia_aplicar: versão de 20261025180000 (7 argumentos).
DROP FUNCTION IF EXISTS public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text, text);
CREATE OR REPLACE FUNCTION public.lead_ia_aplicar(_conversa uuid, _versao integer, _passo text, _dados jsonb,
  _resposta text, _fim text, _resumo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _ok boolean;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = (SELECT lead_id FROM public.lead_conversas WHERE id = _conversa) FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _l.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _cv.estado <> 'ativa' OR _versao IS DISTINCT FROM _cv.versao OR _cv.respondida_versao >= _versao THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'desatualizado');
  END IF;
  SELECT (m.enabled AND c.ia_ativa AND o.status = 'ativa') INTO _ok FROM public.lead_config c
    JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads'
    JOIN public.organizations o ON o.id = c.organization_id
   WHERE c.organization_id = _cv.organization_id;
  IF NOT coalesce(_ok, false) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ia_desligada'); END IF;
  IF _l.etapa IN ('ganho', 'perdido') THEN
    PERFORM public.lead_ia_passar(_cv.id, 'parada_manual', 'Lead encerrado: a IA parou.');
    RETURN jsonb_build_object('ok', false, 'motivo', 'lead_encerrado');
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _cv.organization_id
              AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    PERFORM public.lead_ia_passar(_cv.id, 'optout', 'Este contato pediu para não receber mensagens (SAIR).');
    RETURN jsonb_build_object('ok', false, 'motivo', 'optout');
  END IF;
  IF _passo IS NULL OR _passo NOT IN ('interesse', 'finalidade', 'prazo', 'pagamento', 'faixa', 'regiao', 'proximo_passo', 'fim')
     OR _dados IS NULL OR jsonb_typeof(_dados) <> 'object'
     OR (_fim IS NOT NULL AND _fim NOT IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse'))
     OR char_length(coalesce(_resposta, '')) > 2000 THEN
    RAISE EXCEPTION 'Resposta da IA invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_resposta, '')), '') IS NOT NULL THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'ia', btrim(_resposta), public.lead_ia_status_saida(_cv.id));
  END IF;
  UPDATE public.lead_conversas SET passo = _passo, dados = _dados, respondida_versao = _versao, updated_at = now()
   WHERE id = _cv.id;
  PERFORM public.lead_ia_tocar(_cv.lead_id);
  IF _fim IS NOT NULL THEN PERFORM public.lead_ia_passar(_cv.id, _fim, coalesce(_resumo, 'Conversa encerrada pela IA.')); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text) TO service_role;

-- lead_ia_passar: versão de 20261025180000.
CREATE OR REPLACE FUNCTION public.lead_ia_passar(_conversa uuid, _motivo text, _resumo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _g record; _titulo text; _msg text;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _cv.estado <> 'ativa' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  UPDATE public.lead_conversas
     SET estado = CASE _motivo WHEN 'optout' THEN 'optout' WHEN 'parada_manual' THEN 'parada' ELSE 'passada' END,
         motivo_fim = _motivo, resumo = left(public.lead_ia_mascarar(_resumo), 1000), passo = 'fim', encerrada_em = now(), updated_at = now()
   WHERE id = _cv.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_cv.organization_id, _cv.lead_id, 'ia', _motivo, auth.uid());
  _titulo := CASE _motivo
    WHEN 'qualificado' THEN 'IA qualificou um lead seu'
    WHEN 'pediu_pessoa' THEN 'Cliente pediu para falar com o corretor'
    WHEN 'sensivel' THEN 'Atenção: assunto sensível em um lead'
    WHEN 'sem_interesse' THEN 'Lead disse que não tem interesse'
    WHEN 'optout' THEN 'Lead pediu para não receber mensagens'
    WHEN 'limite' THEN 'Conversa da IA passou para você'
    ELSE 'IA parada neste lead' END;
  _msg := 'Lead "' || _l.nome || '": ' || left(public.lead_ia_mascarar(_resumo), 300) || ' Veja a conversa em Meus leads.';
  IF _l.responsavel_id IS NOT NULL THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _cv.organization_id, _titulo,
      CASE WHEN _l.aceito_em IS NOT NULL THEN _msg
           ELSE 'Lead "' || _l.nome || '": aceite o lead em Meus leads para ver o resumo e a conversa.' END);
  END IF;
  IF _l.responsavel_id IS NULL OR _motivo = 'sensivel' THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id AND r.role::text IN ('admin', 'gestor')
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $$;

-- lead_ia_registrar_cliente: versão de 20261025180000 (contexto sem as chaves novas).
CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid;
BEGIN
  IF char_length(_t) = 0 THEN RAISE EXCEPTION 'Mensagem vazia' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
  VALUES (_cv.organization_id, _cv.id, 'cliente', _t, _status);
  UPDATE public.lead_conversas SET versao = versao + 1, updated_at = now() WHERE id = _cv.id
  RETURNING * INTO _cv;
  PERFORM public.lead_ia_tocar(_l.id);
  IF public.lead_ia_e_optout(_t) THEN
    INSERT INTO public.lead_ia_optouts (organization_id, contato)
    SELECT _cv.organization_id, x FROM unnest(public.lead_ia_contatos(_l.telefone, _l.email)) x
    ON CONFLICT DO NOTHING;
    FOR _outra IN SELECT cv.id FROM public.lead_conversas cv JOIN public.leads l2 ON l2.id = cv.lead_id
                   WHERE cv.organization_id = _cv.organization_id AND cv.id <> _cv.id AND cv.estado = 'ativa'
                     AND public.lead_ia_contatos(l2.telefone, l2.email) && public.lead_ia_contatos(_l.telefone, _l.email) LOOP
      PERFORM public.lead_ia_passar(_outra, 'optout', 'Este contato pediu para não receber mais mensagens (SAIR) em outro lead.');
    END LOOP;
    IF _cv.estado = 'ativa' THEN
      INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
      VALUES (_cv.organization_id, _cv.id, 'sistema',
              'Pronto, você não vai mais receber mensagens nossas por aqui. Obrigado!',
              public.lead_ia_status_saida(_cv.id));
      PERFORM public.lead_ia_passar(_cv.id, 'optout', 'Cliente pediu para não receber mais mensagens (SAIR). Não envie mensagens automáticas.');
    END IF;
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'optout');
  END IF;
  IF _cv.estado <> 'ativa' THEN
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', _cv.estado);
  END IF;
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'cliente';
  IF _n > 30 THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'passada');
  END IF;
  RETURN jsonb_build_object(
    'conversa_id', _cv.id, 'estado', _cv.estado, 'versao', _cv.versao, 'passo', _cv.passo, 'dados', _cv.dados,
    'ia_nome', coalesce(_c.ia_nome, 'Assistente virtual'),
    'lead_nome', split_part(btrim(_l.nome), ' ', 1),
    'imovel', CASE WHEN _l.capture_id IS NOT NULL THEN public.lead_ia_imovel(_l.capture_id, _l.organization_id) END);
END $$;

-- lead_ia_primeira_msg: versão de 20261025180000.
CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l public.leads, _c public.lead_config, _org_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _imovel text; _base text;
BEGIN
  IF _l.capture_id IS NOT NULL THEN _imovel := public.lead_ia_imovel(_l.capture_id, _l.organization_id); END IF;
  _base := regexp_replace(coalesce(nullif(btrim(_c.ia_boas_vindas), ''), 'Recebi seu contato'), '[.!?\s]+$', '');
  RETURN left(format('Olá, %s! Aqui é %s, da %s. %s%s. Você ainda tem interesse? (Se não quiser receber mensagens, responda SAIR.)',
    split_part(btrim(_l.nome), ' ', 1), btrim(_c.ia_nome), coalesce(_org_nome, 'imobiliária'), _base,
    coalesce(' sobre o imóvel ' || _imovel, '')), 2000);
END $$;

DROP FUNCTION IF EXISTS public.lead_ia_ficha(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_ia_imovel_frase(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_captacao(public.leads, jsonb);
DROP FUNCTION IF EXISTS public.lead_ia_tipo(text);

REVOKE SELECT (ia_primeira_msg, ia_reengajar, ia_reengajar_h1, ia_reengajar_h2) ON public.lead_config FROM authenticated;
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_primeira_msg_sem_link;
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_reengajar_h2_check;
ALTER TABLE public.lead_config
  DROP COLUMN IF EXISTS ia_primeira_msg,
  DROP COLUMN IF EXISTS ia_reengajar,
  DROP COLUMN IF EXISTS ia_reengajar_h1,
  DROP COLUMN IF EXISTS ia_reengajar_h2,
  DROP COLUMN IF EXISTS ia_reengajar_proximo_em;

COMMIT;

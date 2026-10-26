-- Leads — IA de atendimento (Emanuella): roteiro novo a partir do estudo de 1.347 conversas da Lais.
-- Card t_fc4d9b27; "sim, ajusta a Emanuella", Denis 26/10/2026, tópico 6238. Base: 20261025180000,
-- 20261025190000 e 20261025200000.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261026140000_leads_ia_roteiro_lais.rollback.sql
--
-- O que muda:
--  1) 1ª mensagem: uma bolha, sem link. Apresenta-se como assistente virtual da imobiliária (nome da org),
--     cita tipo e bairro do imóvel da captação e termina com pergunta fechada. Texto editável na tela
--     (lead_config.ia_primeira_msg, com {nome} {assistente} {imobiliaria} {imovel}); vazio = texto padrão.
--  2) Ficha da captação para a IA (lead_ia_ficha): SÓ o que existe na captação (tipo, bairro, cidade,
--     quartos, suítes, banheiros, vagas, áreas). Condomínio, IPTU (valor), permuta, financiamento,
--     andar/posição e disponibilidade NÃO existem hoje: a IA responde "não tenho esse dado confirmado".
--  3) Imóvel pelo código do anúncio (lead_ia_imovel_por_codigo), guardado só na conversa (o lead e a
--     distribuição não mudam).
--  4) Passagem ao humano verificável: lead_ia_aplicar só grava "encaminhei para <quem>" se o registro na
--     linha do tempo E pelo menos um aviso no sino foram gravados na mesma transação; senão grava o texto
--     de falha ("registrei e estou confirmando"). Motivos novos: 'visita' (pré-agendamento) e 'nao_lead'.
--  5) Reengajamento em 2 toques (~24 h e ~72 h), DESLIGADO por padrão (ia_reengajar = false), só no canal
--     real, só para a lista de liberados, dentro do limite diário e com intervalo aleatório entre envios.
--     Esta migration NÃO agenda nada e NÃO envia nada.
BEGIN;

-- 1) Configuração ---------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_primeira_msg text
    CONSTRAINT lead_config_ia_primeira_msg_check CHECK (char_length(btrim(ia_primeira_msg)) BETWEEN 1 AND 400),
  ADD COLUMN IF NOT EXISTS ia_reengajar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_reengajar_h1 integer NOT NULL DEFAULT 24
    CONSTRAINT lead_config_ia_reengajar_h1_check CHECK (ia_reengajar_h1 BETWEEN 12 AND 72),
  ADD COLUMN IF NOT EXISTS ia_reengajar_h2 integer NOT NULL DEFAULT 72,
  -- Próximo envio de reengajamento permitido nesta imobiliária (intervalo aleatório). Só o servidor.
  ADD COLUMN IF NOT EXISTS ia_reengajar_proximo_em timestamptz;
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_reengajar_h2_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_reengajar_h2_check
  CHECK (ia_reengajar_h2 BETWEEN ia_reengajar_h1 + 24 AND 168);
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_primeira_msg_sem_link;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_primeira_msg_sem_link
  CHECK (ia_primeira_msg IS NULL OR ia_primeira_msg !~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/))');
GRANT SELECT (ia_primeira_msg, ia_reengajar, ia_reengajar_h1, ia_reengajar_h2) ON public.lead_config TO authenticated;

-- 2) Conversas: passos e motivos novos; marcas do reengajamento ---------------------------------------
ALTER TABLE public.lead_conversas
  ADD COLUMN IF NOT EXISTS reengaje_1_em timestamptz,
  ADD COLUMN IF NOT EXISTS reengaje_2_em timestamptz;
-- Passos antigos (prazo, regiao, proximo_passo) continuam válidos para as conversas já abertas.
ALTER TABLE public.lead_conversas DROP CONSTRAINT IF EXISTS lead_conversas_passo_check;
ALTER TABLE public.lead_conversas ADD CONSTRAINT lead_conversas_passo_check
  CHECK (passo IN ('interesse', 'codigo', 'finalidade', 'faixa', 'pagamento', 'visita', 'fim',
                   'prazo', 'regiao', 'proximo_passo'));
ALTER TABLE public.lead_conversas DROP CONSTRAINT IF EXISTS lead_conversas_motivo_fim_check;
ALTER TABLE public.lead_conversas ADD CONSTRAINT lead_conversas_motivo_fim_check
  CHECK (motivo_fim IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse', 'optout',
                        'parada_manual', 'limite', 'visita', 'nao_lead'));
CREATE INDEX IF NOT EXISTS lead_conversas_reengajar_idx ON public.lead_conversas (organization_id, updated_at)
  WHERE estado = 'ativa' AND canal = 'ziontalk';

-- 3) Imóvel: tipo, frase e ficha (só dados da captação) ----------------------------------------------
-- Tipo da captação (texto livre) -> palavra usada na conversa. Ambíguo/vazio = NULL ("imóvel").
CREATE OR REPLACE FUNCTION public.lead_ia_tipo(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN n ~ '\mcobertura\M' THEN 'cobertura'
    WHEN n ~ '\m(studio|estudio|kitnet|kitinete|quitinete)\M' THEN 'studio'
    WHEN n ~ '\m(apartamento|apto|ap)\M' THEN 'apartamento'
    WHEN n ~ '\m(sala|loja|escritorio|comercial|galpao|barracao)\M' THEN 'imóvel comercial'
    WHEN n ~ '\m(casa|sobrado|chacara)\M' THEN 'casa'
    WHEN n ~ '\m(terreno|lote)\M' THEN 'terreno' END
  FROM (SELECT public.lead_ia_norm(btrim(coalesce(_t, ''))) AS n) x
$$;

-- Captação usada pela conversa: a do lead ou a achada pelo código do anúncio (guardada na conversa).
-- Sempre da MESMA imobiliária e não descartada.
CREATE OR REPLACE FUNCTION public.lead_ia_captacao(_l public.leads, _dados jsonb) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.id FROM public.exclusive_captures c
   WHERE c.organization_id = _l.organization_id AND c.discarded_at IS NULL
     AND c.id = coalesce(_l.capture_id,
                         CASE WHEN coalesce(_dados->>'imovel_capture_id', '') ~ '^[0-9a-f-]{36}$'
                              THEN (_dados->>'imovel_capture_id')::uuid END)
$$;

-- Frase do imóvel. _forma: 'em' = "no apartamento do bairro X"; 'def' = "o apartamento do bairro X";
-- 'indef' = "um apartamento no bairro X". Sem tipo nem bairro = NULL. Nunca cita preço.
CREATE OR REPLACE FUNCTION public.lead_ia_imovel_frase(_capture uuid, _org uuid, _forma text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN t IS NULL AND b IS NULL THEN NULL ELSE
    CASE _forma
      WHEN 'em' THEN CASE WHEN fem THEN 'na ' ELSE 'no ' END
      WHEN 'indef' THEN CASE WHEN fem THEN 'uma ' ELSE 'um ' END
      ELSE CASE WHEN fem THEN 'a ' ELSE 'o ' END END
    || coalesce(t, 'imóvel')
    || coalesce(CASE WHEN _forma = 'indef' THEN ' no bairro ' ELSE ' do bairro ' END || b, '') END
  FROM (SELECT public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel') AS t,
               left(nullif(btrim(c.form_data->'imovel'->>'bairro'), ''), 60) AS b,
               public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel') IN ('casa', 'cobertura') AS fem
          FROM public.exclusive_captures c WHERE c.id = _capture AND c.organization_id = _org) x
$$;

-- Ficha para a IA responder dúvidas. SÓ campos que existem na captação e estão preenchidos.
-- Números vêm como texto curto, só com dígitos, ponto e vírgula (nada de texto livre ao cliente).
CREATE OR REPLACE FUNCTION public.lead_ia_ficha(_capture uuid, _org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'tipo', public.lead_ia_tipo(i->>'tipo_imovel'),
    'bairro', left(nullif(btrim(i->>'bairro'), ''), 60),
    'cidade', left(nullif(btrim(i->>'municipio'), ''), 60),
    'quartos', substring(btrim(f->>'quartos') from '^[0-9]{1,2}$'),
    'suites', substring(btrim(f->>'suites') from '^[0-9]{1,2}$'),
    'banheiros', substring(btrim(f->>'banheiros') from '^[0-9]{1,2}$'),
    'vagas', substring(btrim(f->>'vagas') from '^[0-9]{1,2}$'),
    'area_util_m2', substring(btrim(f->>'area_util_m2') from '^[0-9]{1,7}([.,][0-9]{1,2})?$'),
    'area_construida_m2', substring(btrim(f->>'area_construida_m2') from '^[0-9]{1,7}([.,][0-9]{1,2})?$'),
    'area_terreno_m2', substring(btrim(f->>'area_terreno_m2') from '^[0-9]{1,7}([.,][0-9]{1,2})?$')))
  FROM (SELECT c.form_data->'imovel' AS i,
               CASE WHEN jsonb_typeof(c.form_data->'ficha') = 'object' THEN c.form_data->'ficha' ELSE '{}'::jsonb END AS f
          FROM public.exclusive_captures c
         WHERE c.id = _capture AND c.organization_id = _org AND c.discarded_at IS NULL) x
$$;

-- 4) 1ª mensagem (mesma assinatura: o gatilho lead_ia_iniciar continua igual) ----------------------
CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l public.leads, _c public.lead_config, _org_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t text; _nome text; _imovel text;
BEGIN
  _t := coalesce(nullif(btrim(_c.ia_primeira_msg), ''),
    'Oi, {nome}! Aqui é a {assistente}, assistente virtual da {imobiliaria}. Vi seu interesse {imovel}. Quer saber valores e condições, ou já prefere agendar uma visita?');
  -- Lead sem nome (ex.: "Lead Grupo ZAP"): "Oi!" em vez de "Oi, !".
  _nome := CASE WHEN btrim(_l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE split_part(btrim(_l.nome), ' ', 1) END;
  IF _nome = '' THEN _t := regexp_replace(_t, ',?\s*\{nome\}', '', 'g'); END IF;
  IF _l.capture_id IS NOT NULL THEN _imovel := public.lead_ia_imovel_frase(_l.capture_id, _l.organization_id, 'em'); END IF;
  _t := replace(_t, '{nome}', _nome);
  _t := replace(_t, '{assistente}', btrim(_c.ia_nome));
  _t := replace(_t, '{imobiliaria}', coalesce(_org_nome, 'imobiliária'));
  _t := replace(_t, '{imovel}', coalesce(_imovel, 'no imóvel que você viu'));
  RETURN left(btrim(regexp_replace(_t, '\s+', ' ', 'g')), 2000);
END $$;

-- 5) Contexto para a IA (mesma assinatura; chaves novas no jsonb) ------------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid; _cap uuid; _org text;
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
  _cap := public.lead_ia_captacao(_l, _cv.dados);
  SELECT nome INTO _org FROM public.organizations WHERE id = _cv.organization_id;
  RETURN jsonb_build_object(
    'conversa_id', _cv.id, 'estado', _cv.estado, 'versao', _cv.versao, 'passo', _cv.passo, 'dados', _cv.dados,
    'ia_nome', coalesce(_c.ia_nome, 'Assistente virtual'),
    'lead_nome', split_part(btrim(_l.nome), ' ', 1),
    'imovel', CASE WHEN _l.capture_id IS NOT NULL THEN public.lead_ia_imovel(_l.capture_id, _l.organization_id) END,
    -- Roteiro novo (t_fc4d9b27). Sem telefone/e-mail do lead.
    'org_nome', _org,
    'transacao', _l.portal_transacao,
    'anuncio_codigo', _l.anuncio_codigo,
    'tem_captacao', _cap IS NOT NULL,
    'imovel_frase', CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _l.organization_id, 'def') END,
    'ficha', CASE WHEN _cap IS NOT NULL THEN public.lead_ia_ficha(_cap, _l.organization_id) END);
END $$;

-- 6) Imóvel pelo código do anúncio (só o servidor) ---------------------------------------------------
-- Mesma regra do Grupo ZAP (lead_portal_captacao): anúncio ligado à captação ou código curto da captação.
-- Devolve {capture_id, frase, ficha} ou NULL. Não altera o lead nem a distribuição.
CREATE OR REPLACE FUNCTION public.lead_ia_imovel_por_codigo(_conversa uuid, _codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _cap uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.lead_conversas WHERE id = _conversa;
  IF _org IS NULL OR char_length(btrim(coalesce(_codigo, ''))) NOT BETWEEN 4 AND 60 THEN RETURN NULL; END IF;
  _cap := public.lead_portal_captacao(_org, _codigo);
  IF _cap IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('capture_id', _cap, 'frase', public.lead_ia_imovel_frase(_cap, _org, 'def'),
                            'ficha', public.lead_ia_ficha(_cap, _org));
END $$;

-- 7) Passagem ao humano (mesma assinatura; títulos novos) --------------------------------------------
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
    WHEN 'visita' THEN 'Pré-agendamento de visita: confirme com o cliente'
    WHEN 'pediu_pessoa' THEN 'Cliente pediu para falar com o corretor'
    WHEN 'sensivel' THEN 'Atenção: assunto sensível em um lead'
    WHEN 'nao_lead' THEN 'Contato que não é comprador nem locatário'
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
  -- Sem responsável, assunto sensível ou contato que não é lead (proprietário, parceiro, fornecedor,
  -- pessoal): gestores e administradores da imobiliária também recebem.
  IF _l.responsavel_id IS NULL OR _motivo IN ('sensivel', 'nao_lead') THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id AND r.role::text IN ('admin', 'gestor')
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $$;

-- 8) Resposta da IA com passagem verificável ----------------------------------------------------------
-- Assinatura nova (+ _resposta_falha com DEFAULT): o servidor publicado hoje (7 argumentos) continua
-- funcionando. Na passagem ao humano, {corretor} vira quem retorna SÓ se o registro (linha do tempo) e
-- pelo menos um aviso no sino foram gravados; senão vai o texto de falha.
DROP FUNCTION IF EXISTS public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text);
CREATE OR REPLACE FUNCTION public.lead_ia_aplicar(_conversa uuid, _versao integer, _passo text, _dados jsonb,
  _resposta text, _fim text, _resumo text, _resposta_falha text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _ok boolean; _texto text := btrim(coalesce(_resposta, ''));
  _antes integer; _depois integer; _resp_avisado boolean; _registrado boolean; _quem text; _encaminhado boolean;
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
  IF _passo IS NULL OR _passo NOT IN ('interesse', 'codigo', 'finalidade', 'faixa', 'pagamento', 'visita', 'fim',
                                      'prazo', 'regiao', 'proximo_passo')
     OR _dados IS NULL OR jsonb_typeof(_dados) <> 'object'
     OR (_fim IS NOT NULL AND _fim NOT IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse', 'visita', 'nao_lead'))
     OR char_length(coalesce(_resposta, '')) > 2000 OR char_length(coalesce(_resposta_falha, '')) > 2000 THEN
    RAISE EXCEPTION 'Resposta da IA invalida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.lead_conversas SET passo = _passo, dados = _dados, respondida_versao = _versao, updated_at = now()
   WHERE id = _cv.id;
  PERFORM public.lead_ia_tocar(_cv.lead_id);

  IF _fim IS NOT NULL THEN
    -- Mesma transação: notifications.created_at = now() marca o que esta passagem gravou.
    SELECT count(*) INTO _antes FROM public.notifications
     WHERE organization_id = _cv.organization_id AND tipo = 'lead' AND created_at = now();
    PERFORM public.lead_ia_passar(_cv.id, _fim, coalesce(_resumo, 'Conversa encerrada pela IA.'));
    SELECT count(*) INTO _depois FROM public.notifications
     WHERE organization_id = _cv.organization_id AND tipo = 'lead' AND created_at = now();
    _registrado := EXISTS (SELECT 1 FROM public.lead_eventos WHERE lead_id = _cv.lead_id AND tipo = 'ia'
                            AND para = _fim AND created_at = now());
    _resp_avisado := _l.responsavel_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.notifications WHERE user_id = _l.responsavel_id AND organization_id = _cv.organization_id
         AND tipo = 'lead' AND created_at = now());
    _encaminhado := _registrado AND _depois > _antes;
    IF _encaminhado THEN
      -- Nome só quando o lead já foi aceito: antes disso o rodízio pode trocar o corretor.
      _quem := CASE
        WHEN _fim = 'nao_lead' THEN 'a nossa equipe'
        WHEN _resp_avisado AND _l.aceito_em IS NOT NULL THEN
          coalesce(nullif(split_part(btrim((SELECT p.nome FROM public.profiles p WHERE p.id = _l.responsavel_id)), ' ', 1), '')
                   || ', do nosso time de corretores', 'o nosso time de corretores')
        ELSE 'o nosso time de corretores' END;
      _texto := replace(_texto, '{corretor}', _quem);
    ELSE
      _texto := coalesce(nullif(btrim(coalesce(_resposta_falha, '')), ''),
                         replace(_texto, '{corretor}', 'o nosso time de corretores'));
    END IF;
  END IF;
  IF _texto <> '' THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'ia', left(_texto, 2000), public.lead_ia_status_saida(_cv.id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'encaminhado', _encaminhado);
END $$;

-- 9) Configuração do roteiro (só administrador, como a config da IA) ---------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_roteiro_salvar(_primeira_msg text, _reengajar boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _t text := nullif(btrim(coalesce(_primeira_msg, '')), '');
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _reengajar IS NULL OR char_length(coalesce(_t, '')) > 400 THEN
    RAISE EXCEPTION 'Configuracao da IA invalida' USING ERRCODE = '22023';
  END IF;
  IF _t ~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/))' THEN
    RAISE EXCEPTION 'A 1a mensagem nao pode ter link' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET ia_primeira_msg = _t, ia_reengajar = _reengajar, updated_at = now()
   WHERE organization_id = _org;
END $$;

-- 10) Reengajamento (só o servidor; nada agendado aqui) ---------------------------------------------
-- Reserva NO MÁXIMO 1 toque por chamada, em toda a plataforma, e grava a mensagem como 'pendente'
-- (o envio é do servidor, pela ZionTalk, com as mesmas travas de lead_ia_envio_reservar).
-- Regras: imobiliária com ia_reengajar, IA ligada, módulo e org ativos, canal real; conversa ativa no
-- canal real; contato na lista de liberados e fora do opt-out; lead não simulado e aberto; 1ª mensagem
-- já enviada; nada pendente na conversa; a última mensagem é da IA (o cliente não respondeu).
-- Toque 1: h1 horas sem resposta. Toque 2: (h2 - h1) horas depois do toque 1, sem resposta depois dele,
-- e só se houver 1 alternativa compatível (mesmo tipo, mesma cidade, captação aprovada e vigente).
-- Horário comercial (seg-sáb, 9h-19h de Brasília). Limite diário (1ª mensagem + toques) e intervalo
-- aleatório entre toques (ia_envio_intervalo_min_s..max_s) por imobiliária.
CREATE OR REPLACE FUNCTION public.lead_ia_reengajar_reservar()
RETURNS TABLE (lead_id uuid, toque integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _r record; _hoje integer; _sp timestamp := now() AT TIME ZONE 'America/Sao_Paulo'; _alt uuid; _txt text;
  _frase text; _alt_frase text; _nome text; _cap uuid;
BEGIN
  IF extract(isodow FROM _sp) = 7 OR extract(hour FROM _sp) < 9 OR extract(hour FROM _sp) >= 19 THEN RETURN; END IF;
  FOR _r IN
    SELECT cv.id AS conversa_id, cv.organization_id, cv.lead_id, cv.reengaje_1_em, cv.dados, c.ia_envio_limite_dia,
           c.ia_envio_intervalo_min_s AS imin, c.ia_envio_intervalo_max_s AS imax,
           CASE WHEN cv.reengaje_1_em IS NULL THEN 1 ELSE 2 END AS t
      FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
      JOIN public.organizations o ON o.id = cv.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = cv.organization_id AND m.module = 'leads' AND m.enabled
      LEFT JOIN LATERAL (SELECT max(x.created_at) AS em, (array_agg(x.autor ORDER BY x.created_at DESC))[1] AS autor
                           FROM public.lead_mensagens x WHERE x.conversa_id = cv.id) u ON true
     WHERE c.ia_reengajar AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND (c.ia_reengajar_proximo_em IS NULL OR c.ia_reengajar_proximo_em <= now())
       AND cv.estado = 'ativa' AND cv.canal = 'ziontalk' AND cv.primeira_enviada_em IS NOT NULL
       AND cv.reengaje_2_em IS NULL
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
       AND public.lead_ia_contatos(l.telefone, NULL) && c.ia_envio_allowlist
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = cv.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
       AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id
                        AND p.status IN ('pendente', 'enviando'))
       AND u.autor IN ('ia', 'sistema')
       AND ((cv.reengaje_1_em IS NULL
             AND greatest(u.em, cv.primeira_enviada_em) <= now() - make_interval(hours => c.ia_reengajar_h1))
         OR (cv.reengaje_1_em IS NOT NULL
             AND cv.reengaje_1_em <= now() - make_interval(hours => c.ia_reengajar_h2 - c.ia_reengajar_h1)
             AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens k WHERE k.conversa_id = cv.id AND k.autor = 'cliente'
                              AND k.created_at > cv.reengaje_1_em)))
     ORDER BY u.em
     LIMIT 50
     FOR UPDATE OF cv, c SKIP LOCKED
  LOOP
    -- Limite diário da imobiliária: 1ª mensagem + toques de reengajamento.
    SELECT count(*) FILTER (WHERE (x.primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_1_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_2_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
      INTO _hoje FROM public.lead_conversas x WHERE x.organization_id = _r.organization_id;
    CONTINUE WHEN _hoje >= _r.ia_envio_limite_dia;

    SELECT * INTO _nome FROM split_part(btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)), ' ', 1);
    IF btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)) ~* '^lead( grupo zap)?$' THEN _nome := ''; END IF;
    _cap := public.lead_ia_captacao((SELECT l FROM public.leads l WHERE l.id = _r.lead_id), _r.dados);
    _frase := CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _r.organization_id, 'def') END;
    IF _r.t = 1 THEN
      _txt := format('Oi%s! Ainda faz sentido para você ver %s? Posso separar 2 horários de visita. (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
    ELSE
      _alt := NULL;
      IF _cap IS NOT NULL THEN
        SELECT a.id INTO _alt FROM public.exclusive_captures o2, public.exclusive_captures a
         WHERE o2.id = _cap AND a.organization_id = _r.organization_id AND a.id <> _cap
           AND a.status = 'aprovada' AND a.discarded_at IS NULL AND a.archived_at IS NULL
           AND public.lead_ia_tipo(a.form_data->'imovel'->>'tipo_imovel') IS NOT NULL
           AND public.lead_ia_tipo(a.form_data->'imovel'->>'tipo_imovel') = public.lead_ia_tipo(o2.form_data->'imovel'->>'tipo_imovel')
           AND public.lead_ia_norm(btrim(a.form_data->'imovel'->>'municipio')) = public.lead_ia_norm(btrim(o2.form_data->'imovel'->>'municipio'))
         ORDER BY (public.lead_ia_norm(btrim(a.form_data->'imovel'->>'bairro')) = public.lead_ia_norm(btrim(o2.form_data->'imovel'->>'bairro'))) DESC,
                  a.created_at DESC
         LIMIT 1;
      END IF;
      _alt_frase := CASE WHEN _alt IS NOT NULL THEN public.lead_ia_imovel_frase(_alt, _r.organization_id, 'indef') END;
      CONTINUE WHEN _alt_frase IS NULL; -- sem alternativa compatível: não manda o 2º toque
      _txt := format('Oi%s! Caso %s não seja o ideal, temos também %s. Quer que eu peça ao corretor os detalhes? (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'), _alt_frase);
    END IF;
    CONTINUE WHEN public.lead_ia_status_saida(_r.conversa_id) <> 'pendente';
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_r.organization_id, _r.conversa_id, 'ia', left(_txt, 2000), 'pendente');
    UPDATE public.lead_conversas
       SET reengaje_1_em = CASE WHEN _r.t = 1 THEN now() ELSE reengaje_1_em END,
           reengaje_2_em = CASE WHEN _r.t = 2 THEN now() ELSE reengaje_2_em END,
           dados = CASE WHEN _r.t = 2 THEN dados || jsonb_build_object('alternativa', _alt_frase, 'alternativa_id', _alt) ELSE dados END,
           updated_at = now()
     WHERE id = _r.conversa_id;
    UPDATE public.lead_config
       SET ia_reengajar_proximo_em = now() + make_interval(secs => _r.imin + floor(random() * (_r.imax - _r.imin + 1)))
     WHERE organization_id = _r.organization_id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_r.organization_id, _r.lead_id, 'ia', 'reengaje_' || _r.t, 'IA preparou o toque ' || _r.t || ' de reengajamento.');
    lead_id := _r.lead_id; toque := _r.t;
    RETURN NEXT;
    RETURN;
  END LOOP;
END $$;

-- 11) Permissões --------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.lead_ia_tipo(text), public.lead_ia_captacao(public.leads, jsonb),
  public.lead_ia_imovel_frase(uuid, uuid, text), public.lead_ia_ficha(uuid, uuid),
  public.lead_ia_imovel_por_codigo(uuid, text),
  public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text, text),
  public.lead_ia_reengajar_reservar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_imovel_por_codigo(uuid, text),
  public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text, text),
  public.lead_ia_reengajar_reservar() TO service_role;
-- As funções já existentes mantêm as permissões (CREATE OR REPLACE não as altera).
REVOKE ALL ON FUNCTION public.lead_ia_roteiro_salvar(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_ia_roteiro_salvar(text, boolean) TO authenticated, service_role;

COMMIT;

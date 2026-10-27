-- t_82c89141 (Denis 27/10/2026, tópico 6238): 6 correções de qualidade da Nicole + item 7 (juntar avisos da OLX).
-- Só banco; o texto das respostas fica no código (src/lib/leads-ia*.ts). DeepSeek segue só na ZZ; allowlist,
-- limite "é robô?", envio de WhatsApp a corretores, fila e canal NÃO mudam.
--  1) Parecidos: compara pelo tipo NORMALIZADO (casa = casa/casa de condomínio); o mesmo tipo do XML vem primeiro.
--  6b) Resposta de espera: cliente escreveu depois do repasse e ninguém da equipe respondeu em
--      lead_config.ia_espera_min (padrão 10; 0 = desligado) -> 1 resposta curta + sininho de novo,
--      no máximo 1 a cada 2 h por conversa (lead_conversas.espera_em). Função lead_ia_espera_preparar
--      (só service_role), chamada pela tarefa do servidor a cada 5 min e enviada pelo mesmo caminho das respostas.
--  7) Grupo OLX: aviso do MESMO telefone, MESMA imobiliária, lead aberto criado há até
--      lead_config.leads_juntar_horas (padrão 24; 0 = desligado) NÃO cria lead: vira "aviso juntado"
--      (lead_portal_avisos + evento no histórico), sem 1ª mensagem e sem fila. Dedup por originLeadId mantida.
--      Leads duplicados que já existem não são juntados nem apagados.
-- Rollback: docs/sql/rollback/20261027200000_leads_ia_6_correcoes.rollback.sql
BEGIN;

-- 1) Configuração por imobiliária -----------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_espera_min integer NOT NULL DEFAULT 10
    CONSTRAINT lead_config_ia_espera_min_check CHECK (ia_espera_min BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS leads_juntar_horas integer NOT NULL DEFAULT 24
    CONSTRAINT lead_config_leads_juntar_horas_check CHECK (leads_juntar_horas BETWEEN 0 AND 168);
GRANT SELECT (ia_espera_min, leads_juntar_horas) ON public.lead_config TO authenticated;

-- 2) Marcas da conversa (só o servidor grava) ------------------------------------------------------------------
ALTER TABLE public.lead_conversas
  ADD COLUMN IF NOT EXISTS espera_em timestamptz,  -- última resposta de espera depois do repasse
  ADD COLUMN IF NOT EXISTS equipe_em timestamptz;  -- última mensagem da equipe pelo número da imobiliária

-- 3) Avisos juntados (item 7). Sem telefone, e-mail ou mensagem: só o que identifica o evento e o anúncio.
CREATE TABLE IF NOT EXISTS public.lead_portal_avisos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  externo_id text NOT NULL CHECK (char_length(externo_id) BETWEEN 1 AND 200),
  anuncio_codigo text CHECK (char_length(anuncio_codigo) <= 60),
  anuncio_portal_id text CHECK (char_length(anuncio_portal_id) <= 60),
  portal_tipo text CHECK (portal_tipo ~ '^[A-Z_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_portal_avisos_externo_uniq UNIQUE (organization_id, externo_id),
  CONSTRAINT lead_portal_avisos_lead_org_fk FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.leads(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lead_portal_avisos_lead_idx ON public.lead_portal_avisos (lead_id, created_at);
ALTER TABLE public.lead_portal_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_portal_avisos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_portal_avisos TO service_role;

-- 4) Novo resultado do contador do Grupo OLX ------------------------------------------------------------------
ALTER TABLE public.lead_portal_recebimentos DROP CONSTRAINT IF EXISTS lead_portal_recebimentos_resultado_check;
ALTER TABLE public.lead_portal_recebimentos ADD CONSTRAINT lead_portal_recebimentos_resultado_check
  CHECK (resultado IN ('ok', 'duplicado', 'sem_contato', 'invalido', 'limite', 'modulo', 'juntado'));

-- 5) Parecidos (item 1) ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_imoveis_parecidos(_conversa uuid, _excluir text[] DEFAULT '{}',
  _preco_min numeric DEFAULT NULL, _preco_max numeric DEFAULT NULL, _bairro text DEFAULT NULL,
  _negocio text DEFAULT 'venda', _limite integer DEFAULT 1, _mais_barato boolean DEFAULT false, _codigo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _run uuid; _ref public.remax_xml_listings; _cap uuid;
  _tipo_raw text; _tipo text; _bairro_ref text; _cidade text; _preco numeric; _min numeric; _max numeric;
  _alvo numeric; _b text := nullif(left(public.lead_ia_norm(btrim(coalesce(_bairro, ''))), 60), '');
  _ex text[]; _itens jsonb; _refj jsonb;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _l.id IS NULL THEN RETURN NULL; END IF;
  IF _negocio IS NULL OR _negocio NOT IN ('venda', 'locacao') THEN RAISE EXCEPTION 'Negocio invalido' USING ERRCODE = '22023'; END IF;
  IF (_preco_min IS NOT NULL AND (_preco_min < 0 OR _preco_min > 1e11))
     OR (_preco_max IS NOT NULL AND (_preco_max <= 0 OR _preco_max > 1e11)) THEN
    RAISE EXCEPTION 'Faixa invalida' USING ERRCODE = '22023';
  END IF;
  _run := (public.remax_xml_last_ok(_cv.organization_id)).id;

  -- Referência: XML da PRÓPRIA imobiliária (mesmo que já tenha saído). Ordem: código do portal, código
  -- informado neste turno (_codigo, ainda não gravado na conversa), código guardado na conversa.
  IF char_length(btrim(coalesce(_codigo, ''))) > 60 THEN RAISE EXCEPTION 'Codigo invalido' USING ERRCODE = '22023'; END IF;
  SELECT x.* INTO _ref FROM public.remax_xml_listings x
    JOIN (VALUES (1, nullif(btrim(_l.anuncio_codigo), '')), (2, nullif(btrim(_codigo), '')),
                 (3, nullif(btrim(_cv.dados->>'imovel_xml_codigo'), ''))) AS k(ord, cod)
      ON x.code_key = public.portal_code_key(k.cod)
   WHERE x.organization_id = _cv.organization_id AND k.cod IS NOT NULL
   ORDER BY k.ord, (x.last_run = _run) DESC
   LIMIT 1;
  IF _ref.code IS NOT NULL THEN
    _tipo_raw := _ref.tipo; _tipo := public.lead_ia_tipo(_ref.tipo);
    _bairro_ref := nullif(btrim(_ref.bairro), ''); _cidade := nullif(btrim(_ref.cidade), '');
    -- Locação compara aluguel com aluguel (t_25fe1197); pedido de venda não serve de referência de aluguel.
    _preco := CASE WHEN _negocio = 'locacao' THEN _ref.preco_aluguel
                   WHEN _ref.negocio = 'locacao' THEN NULL ELSE _ref.preco END;
  ELSE
    _cap := public.lead_ia_captacao(_l, _cv.dados);
    IF _cap IS NOT NULL THEN
      SELECT public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel'), nullif(btrim(c.form_data->'imovel'->>'bairro'), ''),
             nullif(btrim(c.form_data->'imovel'->>'municipio'), '')
        INTO _tipo, _bairro_ref, _cidade
        FROM public.exclusive_captures c WHERE c.id = _cap AND c.organization_id = _cv.organization_id;
    END IF;
  END IF;
  _refj := jsonb_strip_nulls(jsonb_build_object(
    'codigo', _ref.code, 'no_xml', _ref.code IS NOT NULL AND _ref.last_run = _run,
    'saiu', _ref.code IS NOT NULL AND _ref.last_run IS DISTINCT FROM _run,
    'tipo', _tipo, 'bairro', left(_bairro_ref, 60), 'cidade', left(_cidade, 60),
    'preco', CASE WHEN _preco > 0 THEN _preco END));

  -- Faixa: a do cliente; sem ela, ±15% do preço do pedido. Sem nenhuma das duas, não há parecido.
  _min := _preco_min; _max := _preco_max;
  IF _min IS NULL AND _max IS NULL AND _preco > 0 THEN _min := round(_preco * 0.85); _max := round(_preco * 1.15); END IF;
  -- "Mais barato": só abaixo do preço do pedido (continua dentro da faixa/±15%).
  IF coalesce(_mais_barato, false) AND _preco > 0 THEN _max := least(coalesce(_max, _preco), _preco - 1); END IF;
  _alvo := CASE WHEN _min IS NOT NULL AND _max IS NOT NULL AND _min > _max THEN NULL
                WHEN _preco > 0 AND _preco BETWEEN coalesce(_min, 0) AND coalesce(_max, 1e12) THEN _preco
                WHEN _max IS NOT NULL AND _min IS NOT NULL THEN (_min + _max) / 2
                ELSE coalesce(_max, _min) END;
  -- Locação sem aluguel de referência e sem faixa do cliente (ex.: o pedido era de venda): oferece a locação do
  -- mesmo tipo e cidade, preferindo bairro e quartos, sem filtro de valor (o aluguel é dito na oferta).
  IF _negocio = 'locacao' AND _alvo IS NULL AND _min IS NULL AND _max IS NULL THEN _alvo := 0; END IF;
  _ex := ARRAY(SELECT public.portal_code_key(btrim(e)) FROM unnest(coalesce(_excluir, '{}')) e
                WHERE char_length(btrim(coalesce(e, ''))) BETWEEN 1 AND 60 LIMIT 20);

  -- Locação (t_25fe1197): o XML genérico guarda locação (20261027080000); locação só oferece locação,
  -- comparando o aluguel. Sem locação no XML, nada é achado e a Nicole passa ao corretor.
  IF _run IS NULL OR _tipo IS NULL OR _cidade IS NULL OR _alvo IS NULL THEN
    RETURN jsonb_build_object('referencia', _refj, 'itens', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(i.j ORDER BY i.ord), '[]'::jsonb) INTO _itens FROM (
    SELECT row_number() OVER (ORDER BY
             -- coalesce: em DESC o NULL viria primeiro e passaria na frente do mesmo condomínio/bairro.
             coalesce(_ref.rua IS NOT NULL AND _ref.numero IS NOT NULL AND x.rua = _ref.rua AND x.numero = _ref.numero, false) DESC,
             coalesce(public.lead_ia_norm(btrim(x.bairro)) = public.lead_ia_norm(_bairro_ref), false) DESC,
             coalesce(x.tipo = _tipo_raw, false) DESC, -- mesmo tipo do XML primeiro (só ordem)
             -- Só ordem (não filtro): quartos mais perto do pedido; sem dado, depois dos que têm.
             coalesce(abs(x.quartos - _ref.quartos), 99),
             abs(x.pv - _alvo), x.code) AS ord,
           jsonb_strip_nulls(jsonb_build_object(
             'codigo', x.code,
             'tipo', public.lead_ia_tipo(x.tipo),
             'bairro', left(nullif(btrim(x.bairro), ''), 60),
             'cidade', left(nullif(btrim(x.cidade), ''), 60),
             'quartos', x.quartos::text,
             'suites', x.suites::text,
             'vagas', x.vagas::text,
             'area_util_m2', public.lead_ia_num(x.area_util),
             'area_terreno_m2', public.lead_ia_num(x.area_terreno),
             'preco', CASE WHEN _negocio = 'venda' THEN public.lead_ia_reais_curto(x.pv) END,
             'aluguel', CASE WHEN _negocio = 'locacao' THEN public.lead_ia_reais_curto(x.pv) END,
             'url', CASE WHEN public.xml_url_anuncio_ok(x.url) THEN x.url END,
             'mesmo_condominio', CASE WHEN coalesce(_ref.rua IS NOT NULL AND _ref.numero IS NOT NULL
                                       AND x.rua = _ref.rua AND x.numero = _ref.numero, false) THEN true END,
             'mesmo_bairro', CASE WHEN coalesce(public.lead_ia_norm(btrim(x.bairro)) = public.lead_ia_norm(_bairro_ref), false) THEN true END)) AS j
      FROM (SELECT y.*, CASE WHEN _negocio = 'locacao' THEN y.preco_aluguel ELSE y.preco END AS pv
              FROM public.remax_xml_listings y
             WHERE y.organization_id = _cv.organization_id AND y.last_run = _run
               AND CASE WHEN _negocio = 'locacao' THEN y.negocio IN ('locacao', 'venda_locacao')
                        ELSE y.negocio IN ('venda', 'venda_locacao') END) x
     WHERE x.pv > 0
       AND x.pv BETWEEN coalesce(_min, 0) AND coalesce(_max, 1e12)
       AND public.lead_ia_norm(btrim(x.cidade)) = public.lead_ia_norm(_cidade)
       -- t_82c89141: tipo NORMALIZADO (casa = casa/casa de condomínio). Antes era o tipo cru do XML e a casa 3975
       -- ("casa") não achava as 14 "casa-de-condominio" da mesma faixa em Sorocaba.
       AND public.lead_ia_tipo(x.tipo) = _tipo
       AND (_b IS NULL OR public.lead_ia_norm(x.bairro) LIKE '%' || _b || '%')
       AND (_ref.code_key IS NULL OR x.code_key <> _ref.code_key)
       AND NOT (x.code_key = ANY (_ex))
     ORDER BY 1
     LIMIT least(greatest(coalesce(_limite, 1), 1), 3)
  ) i;
  RETURN jsonb_build_object('referencia', _refj, 'itens', _itens);
END $$;

-- 6) Contexto da Nicole com os outros anúncios do mesmo cliente (item 7) -----------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid; _cap uuid; _org text; _fx jsonb;
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
  -- Prioridade (t_76243950): XML pelo código do anúncio do portal (ou o informado pelo cliente na conversa);
  -- se o imóvel não está no XML atual, a captação.
  _fx := public.lead_ia_ficha_xml(_cv.organization_id,
           coalesce(nullif(btrim(_l.anuncio_codigo), ''), nullif(btrim(_cv.dados->>'imovel_xml_codigo'), '')));
  IF _fx = '{}'::jsonb THEN _fx := NULL; END IF;
  _cap := public.lead_ia_captacao(_l, _cv.dados);
  SELECT nome INTO _org FROM public.organizations WHERE id = _cv.organization_id;
  RETURN jsonb_build_object(
    'conversa_id', _cv.id, 'estado', _cv.estado, 'versao', _cv.versao, 'passo', _cv.passo, 'dados', _cv.dados,
    'ia_nome', coalesce(_c.ia_nome, 'Assistente virtual'),
    'lead_nome', split_part(btrim(_l.nome), ' ', 1),
    'imovel', CASE WHEN _l.capture_id IS NOT NULL THEN public.lead_ia_imovel(_l.capture_id, _l.organization_id) END,
    'org_nome', _org,
    'transacao', _l.portal_transacao,
    'anuncio_codigo', _l.anuncio_codigo,
    'tem_captacao', _cap IS NOT NULL,
    'imovel_fonte', CASE WHEN _fx IS NOT NULL THEN 'xml' WHEN _cap IS NOT NULL THEN 'captacao' END,
    'imovel_frase', CASE WHEN _fx IS NOT NULL THEN public.lead_ia_frase(_fx->>'tipo', _fx->>'bairro', 'def')
                         WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _l.organization_id, 'def') END,
    'ficha', CASE WHEN _fx IS NOT NULL THEN _fx
                  WHEN _cap IS NOT NULL THEN public.lead_ia_ficha(_cap, _l.organization_id) END,
    -- t_82c89141 item 7: outros anúncios que o MESMO cliente viu (avisos do portal juntados a este lead).
    'outros_anuncios', (SELECT jsonb_agg(jsonb_build_object('codigo', a.cod,
                          'ficha', nullif(public.lead_ia_ficha_xml(_cv.organization_id, a.cod), '{}'::jsonb)) ORDER BY a.em)
                          FROM (SELECT DISTINCT ON (public.portal_code_key(p.anuncio_codigo)) p.anuncio_codigo AS cod, p.created_at AS em
                                  FROM public.lead_portal_avisos p
                                 WHERE p.lead_id = _l.id AND p.organization_id = _l.organization_id
                                   AND p.anuncio_codigo IS NOT NULL
                                   AND public.portal_code_key(p.anuncio_codigo)
                                       IS DISTINCT FROM public.portal_code_key(coalesce(_l.anuncio_codigo, ''))
                                 ORDER BY public.portal_code_key(p.anuncio_codigo), p.created_at
                                 LIMIT 3) a));
END $$;

-- 7) Grupo OLX: junta avisos do mesmo cliente (item 7) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_grupo_olx_receber(_token text, _lead jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _ok boolean; _ext text; _id uuid; _cap uuid; _x jsonb; _horas integer; _ja uuid;
  _cli text; _por text; _tel text; _mail text; _nome text; _temp text; _tran text; _tipo text;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT c.organization_id,
         (o.status = 'ativa' AND coalesce((SELECT m.enabled FROM public.organization_modules m
            WHERE m.organization_id = c.organization_id AND m.module = 'leads'), false))
    INTO _org, _ok
    FROM public.lead_config c JOIN public.organizations o ON o.id = c.organization_id
   WHERE c.grupo_olx_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _org IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  IF NOT _ok THEN RETURN jsonb_build_object('r', 'modulo'); END IF;

  -- Um recebimento por vez por imobiliária: limite e duplicado não são furados por envios simultâneos.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_grupo_olx:' || _org::text, 0));
  IF (SELECT count(*) FROM public.lead_portal_recebimentos WHERE organization_id = _org
        AND created_at > now() - interval '1 hour') >= 600 THEN
    RETURN jsonb_build_object('r', 'limite');
  END IF;
  DELETE FROM public.lead_portal_recebimentos WHERE organization_id = _org AND created_at < now() - interval '2 days';

  _ext := CASE WHEN jsonb_typeof(_lead) = 'object' AND jsonb_typeof(_lead->'originLeadId') IN ('string', 'number')
               THEN btrim(_lead->>'originLeadId') END;
  IF _ext IS NULL OR char_length(_ext) NOT BETWEEN 1 AND 200 THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'invalido');
    RETURN jsonb_build_object('r', 'invalido');
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = _org AND origem = 'grupo_olx' AND externo_id = _ext)
     OR EXISTS (SELECT 1 FROM public.lead_portal_avisos WHERE organization_id = _org AND externo_id = _ext) THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'duplicado');
    RETURN jsonb_build_object('r', 'duplicado');
  END IF;

  _x := CASE WHEN jsonb_typeof(_lead->'extraData') = 'object' THEN _lead->'extraData' ELSE '{}'::jsonb END;
  _cli := left(nullif(btrim(coalesce(_lead->>'clientListingId', '')), ''), 60);
  _por := left(nullif(btrim(coalesce(_lead->>'originListingId', '')), ''), 60);
  _nome := left(coalesce(nullif(btrim(regexp_replace(coalesce(_lead->>'name', ''), '\s+', ' ', 'g')), ''),
                         'Lead Grupo ZAP'), 120);
  _tel := regexp_replace(coalesce(_lead->>'ddd', '') || coalesce(_lead->>'phone', ''), '[^0-9]', '', 'g');
  IF _tel !~ '^[0-9]{10,11}$' THEN _tel := regexp_replace(coalesce(_lead->>'phoneNumber', ''), '[^0-9]', '', 'g'); END IF;
  IF _tel !~ '^[0-9]{8,15}$' THEN _tel := NULL; END IF;
  _mail := lower(btrim(coalesce(_lead->>'email', '')));
  IF char_length(_mail) > 160 OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN _mail := NULL; END IF;
  IF _tel IS NULL AND _mail IS NULL THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'sem_contato');
    RETURN jsonb_build_object('r', 'sem_contato');
  END IF;
  _temp := CASE lower(btrim(coalesce(_lead->>'temperature', '')))
             WHEN 'baixa' THEN 'baixa' WHEN 'média' THEN 'media' WHEN 'media' THEN 'media' WHEN 'alta' THEN 'alta' END;
  _tran := CASE upper(btrim(coalesce(_lead->>'transactionType', ''))) WHEN 'SELL' THEN 'venda' WHEN 'RENT' THEN 'aluguel' END;
  _tipo := CASE WHEN _lead->>'leadOrigin' = 'MCMV_OLX' THEN 'MCMV'
                WHEN upper(btrim(coalesce(_x->>'leadType', ''))) ~ '^[A-Z_]{1,40}$' THEN upper(btrim(_x->>'leadType')) END;
  _cap := coalesce(public.lead_portal_captacao(_org, _cli), public.lead_portal_captacao(_org, _por));

  -- t_82c89141 item 7: a OLX manda 1 evento por ação (CONTACT_FORM, PHONE_VIEW...). Mesmo telefone, MESMA
  -- imobiliária, lead ainda aberto e criado dentro da janela (lead_config.leads_juntar_horas, 0 = desligado):
  -- junta ao lead existente. Sem lead novo, sem 1ª mensagem nova, sem fila de corretores.
  SELECT coalesce(leads_juntar_horas, 24) INTO _horas FROM public.lead_config WHERE organization_id = _org;
  IF _tel IS NOT NULL AND _horas > 0 THEN
    SELECT l.id INTO _ja FROM public.leads l
     WHERE l.organization_id = _org AND l.etapa NOT IN ('ganho', 'perdido') AND NOT l.simulado
       AND l.created_at > now() - make_interval(hours => _horas)
       AND public.lead_ia_contatos(l.telefone, NULL) && public.lead_ia_contatos(_tel, NULL)
     ORDER BY l.created_at DESC LIMIT 1;
    IF _ja IS NOT NULL THEN
      INSERT INTO public.lead_portal_avisos (organization_id, lead_id, externo_id, anuncio_codigo, anuncio_portal_id, portal_tipo)
      VALUES (_org, _ja, _ext, _cli, _por, _tipo);
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (_org, _ja, 'nota', 'aviso juntado',
              left('Novo aviso do portal' || coalesce(' (' || _tipo || ')', '')
                   || coalesce(' no anúncio ' || coalesce(_cli, _por), '') || ' juntado a este lead.'
                   || CASE WHEN coalesce(public.portal_code_key(coalesce(_cli, _por)), '') <> ''
                            AND public.portal_code_key(coalesce(_cli, _por))
                                IS DISTINCT FROM public.portal_code_key(coalesce((SELECT anuncio_codigo FROM public.leads WHERE id = _ja), ''))
                           THEN ' O cliente também viu este outro imóvel.' ELSE '' END, 2000));
      INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'juntado');
      RETURN jsonb_build_object('r', 'juntado');
    END IF;
  END IF;

  BEGIN
    _id := public.lead_inserir(_org, _nome, _tel, _mail, 'grupo_olx',
             left(public.lead_portal_limpar_mensagem(_lead->>'message'), 4000), _cap, NULL, false, NULL, _ext);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'duplicado');
    RETURN jsonb_build_object('r', 'duplicado');
  END;
  UPDATE public.leads SET anuncio_codigo = _cli, anuncio_portal_id = _por, portal_tipo = _tipo,
         portal_temperatura = _temp, portal_transacao = _tran
   WHERE id = _id;
  PERFORM public.lead_distribuir(_id, NULL, 'grupo zap', NULL);
  INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'ok');
  RETURN jsonb_build_object('r', 'ok');
END $$;

-- 8) Retorno ZionTalk: a equipe respondeu pelo número da imobiliária (item 6b) --------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer;
BEGIN
  -- Token primeiro: nada é gravado antes disso.
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _c FROM public.lead_config
   WHERE ia_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
     FOR UPDATE; -- serializa a imobiliária: o limite por minuto vale também em rajada
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (m.enabled AND o.status = 'ativa') INTO _ok FROM public.organization_modules m
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.organization_id = _c.organization_id AND m.module = 'leads';
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _c.ia_canal_numero IS NULL THEN
    RETURN jsonb_build_object('r', 'desligada');
  END IF;
  IF _msg IS NULL OR jsonb_typeof(_msg) <> 'object' THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  -- t_82c89141 item 6b: mensagem PRÓPRIA (alguém da equipe escreveu pelo número da imobiliária) que não é o
  -- eco de uma mensagem da Nicole/sistema dos últimos 15 min = a equipe respondeu. Só marca a hora; nada é gravado.
  IF coalesce(_msg->>'proprio', '') = 'true' AND coalesce(_msg->>'grupo', '') <> 'true'
     AND coalesce(_msg->>'status', '') <> 'true' THEN
    _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
    _texto := btrim(coalesce(_msg->>'texto', ''));
    IF _chave ~ '^[0-9]{10,11}$' AND _chave IS DISTINCT FROM _c.ia_canal_numero THEN
      SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
       WHERE cv.organization_id = _c.organization_id AND NOT l.simulado
         AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
       ORDER BY cv.created_at DESC, cv.id DESC LIMIT 1;
      IF _cv.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = _cv.id
                AND m.autor IN ('ia', 'sistema') AND m.created_at > now() - interval '15 minutes'
                AND btrim(m.texto) = _texto) THEN
        UPDATE public.lead_conversas SET equipe_em = now() WHERE id = _cv.id;
      END IF;
    END IF;
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  IF coalesce(_msg->>'grupo', '') = 'true' OR coalesce(_msg->>'status', '') = 'true'
     OR coalesce(_msg->>'proprio', '') = 'true' THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _id := btrim(coalesce(_msg->>'id', ''));
  IF char_length(_id) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
  IF _chave IS NULL OR _chave !~ '^[0-9]{10,11}$' OR _chave = _c.ia_canal_numero THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;

  DELETE FROM public.lead_ia_retorno_eventos
   WHERE organization_id = _c.organization_id AND created_at < now() - interval '30 days';
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':' || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;

  IF NOT (_chave = ANY (_c.ia_envio_allowlist)) THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'fora_lista' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'fora_lista');
  END IF;

  -- t_a9f1b447: a conversa do lead MAIS RECENTE desse telefone (a que a Nicole abriu por último), esteja ela
  -- ativa ou não. Nunca pula para uma conversa antiga só porque ela ficou \"ativa\".
  SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
   WHERE cv.organization_id = _c.organization_id AND l.organization_id = _c.organization_id AND NOT l.simulado
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
   ORDER BY cv.created_at DESC, cv.id DESC LIMIT 1;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;

  PERFORM 1 FROM public.leads WHERE id = _cv.lead_id FOR UPDATE;
  UPDATE public.lead_conversas SET canal = 'ziontalk', updated_at = now() WHERE id = _cv.id AND canal <> 'ziontalk';
  _ctx := public.lead_ia_registrar_cliente(_cv.id,
            CASE WHEN _tipo = 'midia' AND _texto = '' THEN '[áudio ou arquivo recebido]' ELSE _texto END, 'recebida');
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;

  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    IF _ctx->>'estado' = 'optout' THEN
      UPDATE public.lead_mensagens SET status = 'nao_enviada'
       WHERE conversa_id = _cv.id AND autor = 'ia' AND status = 'pendente';
    END IF;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'ia';
  IF _n >= _c.ia_resp_max_conversa THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  -- t_a9f1b447: nenhuma mensagem do cliente fica sem resposta. Saiu o limite \"2 respostas por minuto na
  -- conversa\": em rajada do cliente, lead_ia_aplicar (controle de versão) já grava só a resposta da mensagem
  -- mais nova. O limite por minuto da imobiliária continua.
  IF (SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = _c.organization_id
        AND resultado = 'responder' AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id, 'limite', true);
  END IF;
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'responder' WHERE id = _ev;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _cv.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $$;

-- 9) Resposta de espera depois do repasse (item 6b) -----------------------------------------------------------
-- Escolhe conversas passadas ao corretor em que a ÚLTIMA mensagem é do cliente, já esperou ia_espera_min,
-- ninguém da equipe respondeu depois (evento com autor no lead ou mensagem pelo número da imobiliária) e a
-- última espera foi há mais de 2 h. Grava 1 resposta curta (pendente, mesmo caminho/allowlist das respostas)
-- e avisa de novo pelo sininho. Não mexe na fila, no responsável nem no WhatsApp dos corretores.
CREATE OR REPLACE FUNCTION public.lead_ia_espera_preparar()
RETURNS TABLE (lead_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _r record; _g record; _msg text;
  _txt constant text := 'Recebi sua mensagem! Já avisei o corretor e ele continua o seu atendimento por aqui assim que possível.';
BEGIN
  FOR _r IN
    SELECT cv.id AS conversa_id, cv.organization_id, cv.lead_id, l.nome, l.responsavel_id, l.aceito_em
      FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
      JOIN public.organizations o ON o.id = cv.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = cv.organization_id AND m.module = 'leads' AND m.enabled
      JOIN LATERAL (SELECT x.created_at AS em, x.autor FROM public.lead_mensagens x WHERE x.conversa_id = cv.id
                     ORDER BY x.created_at DESC, x.id DESC LIMIT 1) u ON true
     WHERE c.ia_ativa AND c.ia_canal = 'ziontalk' AND c.ia_espera_min > 0
       AND cv.estado = 'passada' AND cv.canal = 'ziontalk' AND cv.encerrada_em IS NOT NULL
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
       AND u.autor = 'cliente' AND u.em > cv.encerrada_em
       AND u.em <= now() - make_interval(mins => c.ia_espera_min)
       AND u.em > now() - interval '24 hours'
       AND (cv.espera_em IS NULL OR cv.espera_em <= now() - interval '2 hours')
       AND (cv.equipe_em IS NULL OR cv.equipe_em < u.em)
       AND NOT EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = cv.lead_id
                        AND e.autor_id IS NOT NULL AND e.created_at > u.em)
       AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id
                        AND p.status IN ('pendente', 'enviando'))
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = cv.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
     ORDER BY u.em
     LIMIT 20
     FOR UPDATE OF cv SKIP LOCKED
  LOOP
    -- Só sai pelo canal real se o contato está na lista de liberados (mesma regra das respostas).
    CONTINUE WHEN public.lead_ia_status_saida(_r.conversa_id) <> 'pendente';
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_r.organization_id, _r.conversa_id, 'sistema', _txt, 'pendente');
    UPDATE public.lead_conversas SET espera_em = now(), updated_at = now() WHERE id = _r.conversa_id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_r.organization_id, _r.lead_id, 'ia', 'espera', 'Cliente escreveu depois do repasse e ainda não teve resposta da equipe. A IA mandou uma resposta de espera.');
    _msg := 'Lead "' || _r.nome || '" escreveu de novo e está esperando resposta. Veja a conversa em Meus leads.';
    IF _r.responsavel_id IS NOT NULL THEN
      PERFORM public.lead_notificar(_r.responsavel_id, _r.organization_id, 'Cliente esperando sua resposta',
        CASE WHEN _r.aceito_em IS NOT NULL THEN _msg
             ELSE 'Lead "' || _r.nome || '": aceite o lead em Meus leads para ver a conversa.' END);
    ELSE
      FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
                 WHERE r.organization_id = _r.organization_id AND r.role::text IN ('admin', 'gestor') LOOP
        PERFORM public.lead_notificar(_g.user_id, _r.organization_id, 'Cliente esperando resposta', _msg);
      END LOOP;
    END IF;
    lead_id := _r.lead_id;
    RETURN NEXT;
  END LOOP;
END $$;


-- 10) Permissões ------------------------------------------------------------------------------------------------
-- As funções já existentes mantêm as permissões (CREATE OR REPLACE não as altera).
REVOKE ALL ON FUNCTION public.lead_ia_espera_preparar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_espera_preparar() TO service_role;

COMMIT;

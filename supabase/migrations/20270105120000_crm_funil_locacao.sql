-- CRM: Funil de LOCAÇÃO (t_d4c8b724, Denis 24/11: "preciso de um funil apenas de locação e os leads de
-- locação têm que ir para lá automaticamente"; etapas "1 ok sem contrato").
--   * leads.funil ganha 'locacao'. Etapas (reaproveitadas, nada novo no banco): novo → em_atendimento (Em contato)
--     → visita_agendada (Visita) → proposta (Ficha/Análise de crédito) → ganho (Fechado) | perdido. Sem 'avaliacao'.
--   * Entrada automática: C2S negotiation_name "Aluguel" → locacao (e grava portal_transacao='aluguel';
--     "Compra" → 'venda'; "Indefinido" → NULL, funil venda). Grupo OLX/ZAP direto: transactionType RENT → locacao.
--   * CRM individual igual (mesma RLS e RPCs crm_*). Locação não vira venda nem proposta de compra
--     (crm_converter_venda e proposta_lead_para_proposta já exigem funil='venda').
--   * NÃO move leads existentes (a movimentação dos 6 leads de aluguel da Única é um passo separado, autorizado à parte).
-- Assinatura do C2S, perfis e Nicole: sem mudança. Rollback: docs/sql/rollback/20270105120000_crm_funil_locacao.rollback.sql
BEGIN;

ALTER TABLE public.leads DROP CONSTRAINT leads_funil_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_funil_check CHECK (funil IN ('venda', 'captacao', 'locacao'));
ALTER TABLE public.leads DROP CONSTRAINT leads_etapa_do_funil;
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_do_funil
  CHECK ((funil = 'venda' AND etapa <> 'avaliacao') OR (funil = 'captacao' AND etapa <> 'visita_agendada')
         OR (funil = 'locacao' AND etapa <> 'avaliacao'));

-- Tipo de negócio do C2S (attributes.product.real_estate_detail.negotiation_name) → portal_transacao.
-- "Aluguel"/"Locação" = aluguel; "Compra"/"Venda" = venda; "Indefinido", vazio ou outro = NULL.
CREATE OR REPLACE FUNCTION public.lead_transacao_c2s(_neg text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN lower(btrim(coalesce(_neg, ''))) IN ('aluguel', 'locacao', 'locação') THEN 'aluguel'
    WHEN lower(btrim(coalesce(_neg, ''))) IN ('compra', 'venda') THEN 'venda'
  END
$$;

-- Funil de entrada do lead pela transação: aluguel → locacao; venda, NULL ou outro → venda.
CREATE OR REPLACE FUNCTION public.lead_funil_da_transacao(_tran text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _tran = 'aluguel' THEN 'locacao' ELSE 'venda' END
$$;
REVOKE ALL ON FUNCTION public.lead_transacao_c2s(text), public.lead_funil_da_transacao(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_transacao_c2s(text), public.lead_funil_da_transacao(text) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_c2s_receber(_token text, _lead jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _x jsonb; _a jsonb; _ext text; _criado timestamptz; _id uuid;
  _nome text; _tel text; _mail text; _ref text; _imovel text; _hist text; _origem_c2s text; _p jsonb;
  _s jsonb; _resp uuid; _casou text; _msgs jsonb; _tran text;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT c.* INTO _c FROM public.lead_config c
   WHERE c.c2s_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (o.status = 'ativa' AND coalesce((SELECT m.enabled FROM public.organization_modules m
            WHERE m.organization_id = o.id AND m.module = 'leads'), false))
    INTO _ok FROM public.organizations o WHERE o.id = _c.organization_id;
  IF NOT coalesce(_ok, false) OR _c.c2s_desde IS NULL THEN RETURN jsonb_build_object('r', 'modulo'); END IF;

  -- Um recebimento por vez por imobiliária (o C2S pode mandar on_create e reenvios ao mesmo tempo).
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_c2s:' || _c.organization_id::text, 0));

  -- Lead buscado pelo servidor no C2S (marca posta pelo servidor depois do GET): só na imobiliária dona da conta.
  IF coalesce(_lead->>'_via_api', '') = 'true' AND NOT _c.c2s_busca_api THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  _x := CASE WHEN jsonb_typeof(_lead->'data') = 'object' THEN _lead->'data' ELSE _lead END;
  _a := CASE WHEN jsonb_typeof(_x->'attributes') = 'object' THEN _x->'attributes' END;
  _ext := CASE WHEN jsonb_typeof(_x->'id') IN ('string', 'number') THEN btrim(_x->>'id') END;
  IF _a IS NULL OR _ext IS NULL OR char_length(_ext) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('r', 'invalido');
  END IF;
  _criado := public.lead_c2s_ts(_a->>'created_at');
  IF _criado IS NULL THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  -- Só leads novos (Denis 24/11: sem estoque antigo).
  IF _criado < _c.c2s_desde THEN RETURN jsonb_build_object('r', 'antigo'); END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = _c.organization_id AND origem = 'c2s' AND externo_id = _ext) THEN
    RETURN jsonb_build_object('r', 'duplicado');
  END IF;

  -- Cliente
  _nome := left(coalesce(nullif(btrim(regexp_replace(coalesce(_a->'customer'->>'name', ''), '\s+', ' ', 'g')), ''), 'Lead C2S'), 120);
  _tel := regexp_replace(coalesce(_a->'customer'->>'phone', ''), '[^0-9]', '', 'g');
  IF _tel !~ '^[0-9]{10,13}$' THEN _tel := regexp_replace(coalesce(_a->'customer'->>'phone2', ''), '[^0-9]', '', 'g'); END IF;
  IF _tel ~ '^55[1-9][0-9]{9,10}$' THEN _tel := substr(_tel, 3); END IF;
  IF _tel !~ '^[0-9]{8,15}$' THEN _tel := NULL; END IF;
  _mail := lower(btrim(coalesce(_a->'customer'->>'email', '')));
  IF char_length(_mail) > 160 OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN _mail := NULL; END IF;
  IF _tel IS NULL AND _mail IS NULL THEN RETURN jsonb_build_object('r', 'sem_contato'); END IF;

  -- Imóvel de interesse
  _p := CASE WHEN jsonb_typeof(_a->'product') = 'object' THEN _a->'product' ELSE '{}'::jsonb END;
  _ref := left(nullif(btrim(coalesce(_p->>'prop_ref', '')), ''), 60);
  _imovel := left(nullif(concat_ws(' · ',
               nullif(btrim(regexp_replace(coalesce(_p->>'description', _a->>'description', ''), '^\[[^]]*\]\s*', '')), ''),
               nullif(concat_ws('/', nullif(btrim(_p->>'neighbourhood'), ''), nullif(btrim(_p->>'city'), '')), ''),
               CASE WHEN nullif(btrim(_p->>'price'), '') IS NOT NULL THEN 'R$ ' || btrim(_p->>'price') END,
               nullif(btrim(_p->'real_estate_detail'->>'negotiation_name'), ''),
               CASE WHEN btrim(coalesce(_a->>'url', '')) ~ '^https?://' THEN btrim(_a->>'url') END), ''), 300);

  -- Tipo de negócio do C2S (t_d4c8b724, Denis 24/11): "Aluguel" vai para o Funil de Locação;
  -- "Compra" e "Indefinido" (ou vazio) ficam no Funil de Venda.
  _tran := public.lead_transacao_c2s(_p->'real_estate_detail'->>'negotiation_name');

  -- Histórico: mensagens do C2S (cliente e corretor), mais antigas cortadas acima do limite.
  _msgs := CASE WHEN jsonb_typeof(_x->'messages') = 'array' AND jsonb_array_length(_x->'messages') > 0 THEN _x->'messages'
                WHEN jsonb_typeof(_a->'messages') = 'array' THEN _a->'messages' ELSE '[]'::jsonb END;
  SELECT string_agg(linha, E'\n' ORDER BY quando NULLS FIRST, ord) INTO _hist FROM (
    SELECT m.ord, public.lead_c2s_ts(m.v->>'created_at') AS quando,
           coalesce(to_char(public.lead_c2s_ts(m.v->>'created_at') AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' ', '')
           || CASE WHEN m.v->>'sender_type' = 'Customer' THEN 'Cliente' ELSE 'Corretor/C2S' END || ': '
           || left(btrim(regexp_replace(coalesce(m.v->>'body', ''), '[[:space:]]+', ' ', 'g')), 400) AS linha
      FROM jsonb_array_elements(_msgs) WITH ORDINALITY m(v, ord)
     WHERE jsonb_typeof(m.v) = 'object' AND btrim(coalesce(m.v->>'body', '')) <> ''
     ORDER BY m.ord DESC LIMIT 15) h;
  _origem_c2s := left(nullif(btrim(coalesce(_a->'lead_source'->>'name', '')), ''), 60);
  _hist := concat_ws(E'\n', CASE WHEN _origem_c2s IS NOT NULL THEN 'Origem no C2S: ' || _origem_c2s END, right(_hist, 3000));

  -- Responsável = o MESMO corretor do C2S; sem correspondência = responsável padrão (ia_corretor_passagem_id).
  _s := CASE WHEN jsonb_typeof(_a->'seller') = 'object' THEN _a->'seller' ELSE '{}'::jsonb END;
  SELECT r.responsavel, r.casou INTO _resp, _casou FROM public.lead_c2s_responsavel(_c.organization_id, _s->>'email', _s->>'name') r;
  IF _resp IS NULL AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _c.organization_id) THEN
    _resp := _c.ia_corretor_passagem_id;
  END IF;

  BEGIN
    _id := public.lead_inserir(_c.organization_id, _nome, _tel, _mail, 'c2s',
             left(concat_ws(E'\n', 'Imóvel: ' || coalesce(nullif(concat_ws(' · ', 'ref. ' || _ref, _imovel), ''), 'não informado no C2S'),
                            nullif(_hist, '')), 4000),
             NULL, NULL, false, NULL, _ext);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('r', 'duplicado');
  END;
  -- Sem rodízio nem captador: só o corretor do C2S. Já aceito (sem prazo de aceite) e sem prazo por tempo.
  -- Sem ninguém (nem o padrão pode receber): segue a regra normal da imobiliária (sem_prazo=false) e fica registrado.
  UPDATE public.leads SET anuncio_codigo = _ref, imovel_interesse = _imovel, sem_prazo = _resp IS NOT NULL,
         portal_transacao = _tran, funil = public.lead_funil_da_transacao(_tran),
         responsavel_id = _resp, atribuido_em = CASE WHEN _resp IS NOT NULL THEN now() END,
         aceito_em = CASE WHEN _resp IS NOT NULL THEN now() END,
         tentativas_aceite = CASE WHEN _resp IS NOT NULL THEN 1 ELSE 0 END, updated_at = now()
   WHERE id = _id;
  IF _resp IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_c.organization_id, _id, 'atribuido', _resp::text,
            left(CASE _casou WHEN 'email' THEN 'C2S: mesmo corretor do C2S (e-mail)'
                             WHEN 'nome' THEN 'C2S: mesmo corretor do C2S (nome)'
                             ELSE 'C2S: corretor do C2S sem correspondência no ADM ('
                                  || coalesce(left(nullif(btrim(_s->>'name'), ''), 60), 'sem nome') || '); ficou com o responsável padrão' END
                 || '; sem prazo de aceite', 2000));
    PERFORM public.lead_notificar(_resp, _c.organization_id, 'Novo lead do C2S para você',
      'Lead "' || _nome || '": já está em Meus leads, sem prazo de aceite.');
    IF _c.c2s_aviso_whats THEN
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
      VALUES (_c.organization_id, _id, _resp, 'c2s', 'Novo lead do C2S (texto montado no envio).')
      ON CONFLICT (lead_id, evento) DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_c.organization_id, _id, 'nota', 'c2s sem responsavel',
            left('C2S: corretor do C2S sem correspondência no ADM ('
                 || coalesce(left(nullif(btrim(_s->>'name'), ''), 60), 'sem nome')
                 || ') e o responsável padrão não pode receber; segue a distribuição da imobiliária.', 2000));
  END IF;
  RETURN jsonb_build_object('r', 'ok', 'casou', coalesce(_casou, CASE WHEN _resp IS NOT NULL THEN 'padrao' ELSE 'sem_responsavel' END));
END $function$;

CREATE OR REPLACE FUNCTION public.lead_grupo_olx_receber(_token text, _lead jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         portal_temperatura = _temp, portal_transacao = _tran, funil = public.lead_funil_da_transacao(_tran)
   WHERE id = _id;
  PERFORM public.lead_distribuir(_id, NULL, 'grupo zap', NULL);
  INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'ok');
  RETURN jsonb_build_object('r', 'ok');
END $function$;

CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text, _motivo_perda_id uuid DEFAULT NULL::uuid, _obs text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _conta boolean;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _etapa IS NULL OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'ganho', 'perdido')
     OR (_l.funil IN ('venda', 'locacao') AND _etapa = 'avaliacao') OR (_l.funil = 'captacao' AND _etapa = 'visita_agendada') THEN
    RAISE EXCEPTION 'Etapa invalida' USING ERRCODE = '22023';
  END IF;
  IF _etapa = _l.etapa THEN RETURN _etapa; END IF;
  IF _l.etapa IN ('ganho', 'perdido') AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead encerrado: so gestor ou administrador reabre' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  IF _etapa NOT IN ('ganho', 'perdido') AND public.crm_enabled()
     AND current_setting('app.crm_mover', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Informe a data e o motivo do proximo contato' USING ERRCODE = '22023';
  END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Reabrir (sair de ganho/perdido) recomeça o relógio, para o lead não voltar ao banco na hora.
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END,
         proximo_contato_em = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_em END,
         proximo_contato_motivo = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_motivo END,
         ultima_interacao_em = CASE WHEN _conta OR (_l.etapa IN ('ganho', 'perdido') AND aceito_em IS NOT NULL)
                                    THEN now() ELSE ultima_interacao_em END,
         atribuido_em = CASE WHEN _l.etapa IN ('ganho', 'perdido') AND aceito_em IS NULL AND responsavel_id IS NOT NULL
                             THEN now() ELSE atribuido_em END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $function$;

CREATE OR REPLACE FUNCTION public.crm_definir_funil(_lead uuid, _funil text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  IF _funil IS NULL OR _funil NOT IN ('venda', 'captacao', 'locacao') THEN
    RAISE EXCEPTION 'Funil invalido' USING ERRCODE = '22023';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF _l.funil = _funil THEN RETURN _funil; END IF;
  IF _l.etapa NOT IN ('novo', 'em_atendimento') THEN
    RAISE EXCEPTION 'So troca o funil em Novo ou Em contato' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lead_checar_atendimento(_l, _me);
  UPDATE public.leads SET funil = _funil, updated_at = now() WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
  VALUES (_org, _l.id, 'funil', _l.funil, _funil, _me);
  RETURN _funil;
END $function$;

COMMIT;

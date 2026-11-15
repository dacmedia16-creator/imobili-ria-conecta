-- Suíte do aquecimento de leads parados (t_a2cae373). Roda na HOMOLOGAÇÃO com a migration 20261125120000 aplicada.
-- Tudo dentro de UMA transação desfeita no fim (ROLLBACK): nada fica gravado. Dados 100% fictícios nas orgs de teste
-- "Agência A (fictícia)" e "Agência B (fictícia)". Nenhuma mensagem sai: o canal é o modo teste do banco.
-- Uso: PSQL="bash hq.sh -" bash supabase/tests/run-leads-aquecer.sh
BEGIN;
CREATE TEMP TABLE _t (n serial, nome text, ok boolean, info text) ON COMMIT DROP;
GRANT ALL ON _t TO PUBLIC;
GRANT ALL ON SEQUENCE _t_n_seq TO PUBLIC;

DO $$
DECLARE
  A uuid := '00000000-0000-4000-8000-000000000001';
  B uuid := '2a000000-0000-4000-8000-0000000000b0';
  ADM_A uuid := '7dd997f7-2021-43ea-af9c-e758b826fcfd';
  SEG timestamptz := '2026-11-16 13:00:00+00'; -- segunda 10h de Brasília
  DOM timestamptz := '2026-11-15 13:00:00+00'; -- domingo 10h
  NOITE timestamptz := '2026-11-16 23:30:00+00'; -- segunda 20h30
  TER timestamptz := '2026-11-17 13:00:00+00'; -- terça 10h (seção 12: dia sem envios anteriores)
  LS uuid[] := ARRAY[]::uuid[]; LB uuid; r record; _n integer; _x text; _j jsonb; _env uuid; _lead uuid;
  _a public.lead_aquecer; _cv public.lead_conversas; _tok text := 'tokAquecerTesteFicticio_0123456789abcdefghijklmn';
  _ids uuid[] := ARRAY[]::uuid[]; _txts text[]; _ok boolean; _err text;
BEGIN
  -- Leads fictícios criados ANTES de ligar o módulo (o gatilho da Nicole não roda). Telefones 1599990xxxx (fictícios).
  -- 1 parado 40 dias, aceito (teve contato)        -> elegível
  -- 2 parado 40 dias, nunca teve contato           -> não
  -- 3 interação há 5 dias                          -> não
  -- 4 opt-out                                      -> não
  -- 5 ganho                                        -> não
  -- 6 telefone inválido (8 dígitos)                -> não
  -- 7 simulado                                     -> não
  -- 8, 9 parados 40 dias, aceitos                  -> elegíveis
  -- 10 parado 29 dias (borda)                      -> não
  -- 11 parado 31 dias                              -> elegível
  -- 12 parado 60 dias, contato registrado por nota da equipe -> elegível
  FOR i IN 1..12 LOOP
    INSERT INTO public.leads (organization_id, nome, telefone, origem, etapa, simulado, created_at, aceito_em, ultima_interacao_em)
    VALUES (A, 'Teste Aquecer ' || i,
            CASE i WHEN 6 THEN '12345678' ELSE '+55159999' || lpad(i::text, 5, '0') END,
            'manual', CASE i WHEN 5 THEN 'ganho' ELSE 'em_atendimento' END, i = 7,
            now() - make_interval(days => CASE i WHEN 10 THEN 29 WHEN 11 THEN 31 WHEN 12 THEN 60 ELSE 40 END),
            CASE WHEN i IN (2, 12) THEN NULL
                 ELSE now() - make_interval(days => CASE i WHEN 10 THEN 29 WHEN 11 THEN 31 ELSE 40 END) END,
            CASE i WHEN 3 THEN now() - interval '5 days' END)
    RETURNING id INTO _lead;
    LS := LS || _lead;
  END LOOP;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id, created_at)
  VALUES (A, LS[12], 'nota', 'Liguei, não atendeu (fictício).', ADM_A, now() - interval '50 days');
  INSERT INTO public.lead_ia_optouts (organization_id, contato) VALUES (A, '15999900004');
  INSERT INTO public.leads (organization_id, nome, telefone, origem, etapa, created_at, aceito_em)
  VALUES (B, 'Teste Aquecer B1', '+5515999800001', 'manual', 'em_atendimento', now() - interval '40 days', now() - interval '40 days')
  RETURNING id INTO LB;

  -- Liga o módulo de leads só nesta transação e cria a configuração da A (B nasce sem aquecimento).
  INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (A, 'leads', true), (B, 'leads', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
  INSERT INTO public.lead_config (organization_id) VALUES (A), (B) ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO _t (nome, ok, info) SELECT 'nasce desligado (A e B)', bool_and(NOT aquecer_ativo), string_agg(aquecer_ativo::text, ',')
    FROM public.lead_config WHERE organization_id IN (A, B);
  UPDATE public.lead_config SET ia_ativa = true, ia_canal = 'teste', ia_domingo = false, aquecer_ativo = true,
         aquecer_rampa_inicio = 2, aquecer_rampa_passo = 2, aquecer_limite_dia = 15,
         aquecer_rampa_desde = (SEG AT TIME ZONE 'America/Sao_Paulo')::date, aquecer_proximo_em = NULL,
         aquecer_pausado_em = NULL, ia_canal_numero = '15911110000',
         aquecer_freio_taxa = 0.50, -- na A o roteiro gera 1 SAIR em 5 envios; o freio por taxa é provado na B (20%)
         aquecer_retorno_token_hash = encode(extensions.digest(_tok, 'sha256'), 'hex'),
         -- Seções 1-11 testam as outras regras: modo 'todos' com início no futuro (lead_ia_liberado segue falso
         -- para todos). A lista de liberados é testada na seção 12.
         ia_envio_modo = 'todos', ia_envio_desde = '2099-01-01'
   WHERE organization_id = A;
  UPDATE public.lead_config SET ia_ativa = true, ia_canal = 'teste', ia_envio_modo = 'todos', ia_envio_desde = '2099-01-01'
   WHERE organization_id = B;

  -- 1) Seleção dos 30 dias -----------------------------------------------------------------------------------------
  SELECT string_agg(i::text || '=' || public.lead_aquecer_elegivel(l, 30)::text, ' ' ORDER BY i) INTO _x
    FROM generate_series(1, 12) i JOIN public.leads l ON l.id = LS[i];
  INSERT INTO _t (nome, ok, info) VALUES ('selecao 30 dias: so 1,8,9,11,12',
    _x = '1=true 2=false 3=false 4=false 5=false 6=false 7=false 8=true 9=true 10=false 11=true 12=true', _x);
  INSERT INTO _t (nome, ok, info) SELECT 'dias configuravel (45: so o 12)',
    string_agg(i::text, ',' ORDER BY i) = '12', string_agg(i::text, ',' ORDER BY i)
    FROM generate_series(1, 12) i JOIN public.leads l ON l.id = LS[i] WHERE public.lead_aquecer_elegivel(l, 45);

  -- 2) Horário e domingo ---------------------------------------------------------------------------------------------
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, DOM);
  INSERT INTO _t (nome, ok, info) VALUES ('domingo sem ia_domingo: nada', _n = 0, _n::text);
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, NOITE);
  INSERT INTO _t (nome, ok, info) VALUES ('fora do horario: nada', _n = 0, _n::text);

  -- 3) 1º envio (modo teste), só da A (B desligada) -------------------------------------------------------------------
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('1o envio: lead elegivel da A, modo teste',
    r.lead_id = ANY (ARRAY[LS[1], LS[8], LS[9], LS[11], LS[12]]) AND NOT r.modo_real, coalesce(r.modo_real::text, 'nada'));
  INSERT INTO _t (nome, ok, info) VALUES ('texto termina em pergunta, sem link/preco/numero',
    public.lead_aquecer_texto_ok(r.texto, public.lead_ia_org_nome(A)) AND r.texto LIKE '%?%', left(r.texto, 160));
  _j := public.lead_aquecer_resultado(r.envio_id, 'teste');
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = r.lead_id;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = r.lead_id;
  INSERT INTO _t (nome, ok, info) VALUES ('resultado teste: mensagem na conversa do lead como nao_enviada',
    _a.estado = 'enviado' AND _a.conversa_id = _cv.id AND _cv.estado = 'parada' AND _cv.canal = 'teste'
    AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = _cv.id AND m.autor = 'ia' AND m.status = 'nao_enviada'),
    _a.estado || '/' || _cv.estado || '/' || _cv.canal);
  _ids := _ids || r.lead_id;
  UPDATE public.lead_aquecer_envios SET created_at = SEG WHERE organization_id = A;
  INSERT INTO _t (nome, ok, info) SELECT 'intervalo variado: proximo envio entre 5 e 15 min',
    aquecer_proximo_em BETWEEN now() + interval '299 seconds' AND now() + interval '901 seconds', aquecer_proximo_em::text
    FROM public.lead_config WHERE organization_id = A;
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('intervalo: nada antes do proximo horario', _n = 0, _n::text);

  -- 4) Limite diário com rampa (inicio 2) ---------------------------------------------------------------------------
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  _j := public.lead_aquecer_resultado(r.envio_id, 'teste'); _ids := _ids || r.lead_id;
  UPDATE public.lead_aquecer_envios SET created_at = SEG WHERE organization_id = A;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('limite do dia (rampa=2): 3o envio barrado', _n = 0, _n::text);
  UPDATE public.lead_config SET aquecer_rampa_desde = (SEG AT TIME ZONE 'America/Sao_Paulo')::date - 3 WHERE organization_id = A;
  INSERT INTO _t (nome, ok, info) SELECT 'rampa: 3 dias depois = 2+2*3 = 8', public.lead_aquecer_limite_hoje(c, SEG) = 8,
    public.lead_aquecer_limite_hoje(c, SEG)::text FROM public.lead_config c WHERE organization_id = A;
  UPDATE public.lead_config SET aquecer_rampa_desde = (SEG AT TIME ZONE 'America/Sao_Paulo')::date - 30 WHERE organization_id = A;
  INSERT INTO _t (nome, ok, info) SELECT 'rampa nunca passa do limite (15)', public.lead_aquecer_limite_hoje(c, SEG) = 15,
    public.lead_aquecer_limite_hoje(c, SEG)::text FROM public.lead_config c WHERE organization_id = A;

  -- 5) Respostas pelo chip do aquecimento ---------------------------------------------------------------------------
  SELECT public.lead_aquecer_retorno_receber('tokErradoTokErradoTokErradoTokErrado0123456789',
    jsonb_build_object('id', 'x1', 'telefone', '5515999900001', 'texto', 'sim')) INTO _j;
  INSERT INTO _t (nome, ok, info) VALUES ('retorno: token errado recusado', _j->>'r' = 'token', _j::text);
  -- 5a) "sim" -> a Nicole retoma
  SELECT telefone INTO _x FROM public.leads WHERE id = _ids[1];
  _j := public.lead_aquecer_retorno_receber(_tok, jsonb_build_object('id', 'm-sim-1', 'telefone', _x, 'texto', 'Sim, ainda estou procurando!'));
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = _ids[1];
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _ids[1];
  INSERT INTO _t (nome, ok, info) VALUES ('sim: retomado, Nicole responde na MESMA conversa',
    _j->>'r' = 'ok' AND (_j->>'responder')::boolean AND _a.estado = 'retomado' AND _cv.estado = 'ativa' AND _cv.canal = 'teste'
    AND (_j->'ctx'->>'conversa_id')::uuid = _cv.id
    AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = _cv.id AND m.autor = 'cliente' AND m.status = 'recebida'),
    _j->>'r' || '/' || coalesce(_j->>'responder', '-') || '/' || _a.estado || '/' || _cv.estado);
  INSERT INTO _t (nome, ok, info) VALUES ('modo teste: resposta da Nicole fica nao_enviada (canal teste)',
    public.lead_ia_status_saida(_cv.id) = 'nao_enviada' AND public.lead_aquecer_chip_do_lead(_ids[1]) = 'aquecer_teste',
    public.lead_ia_status_saida(_cv.id) || '/' || public.lead_aquecer_chip_do_lead(_ids[1]));
  _j := public.lead_aquecer_retorno_receber(_tok, jsonb_build_object('id', 'm-sim-1', 'telefone', _x, 'texto', 'Sim, ainda estou procurando!'));
  INSERT INTO _t (nome, ok, info) VALUES ('retorno duplicado ignorado', _j->>'r' = 'duplicado', _j::text);
  -- 5b) "não" -> registra motivo e encerra
  SELECT telefone INTO _x FROM public.leads WHERE id = _ids[2];
  _j := public.lead_aquecer_retorno_receber(_tok, jsonb_build_object('id', 'm-nao-1', 'telefone', _x, 'texto', 'Já comprei, obrigado'));
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = _ids[2];
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _ids[2];
  INSERT INTO _t (nome, ok, info) VALUES ('nao: motivo registrado e encerrado',
    _j->>'r' = 'ok' AND NOT (_j->>'responder')::boolean AND _a.estado = 'nao' AND _a.motivo = 'ja_comprou' AND _cv.estado <> 'ativa'
    AND EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _ids[2] AND e.para = 'aquecer_nao'),
    _a.estado || '/' || coalesce(_a.motivo, '-') || '/' || _cv.estado);
  -- 5c) SAIR -> opt-out
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  _j := public.lead_aquecer_resultado(r.envio_id, 'teste'); _ids := _ids || r.lead_id;
  SELECT telefone INTO _x FROM public.leads WHERE id = r.lead_id;
  _j := public.lead_aquecer_retorno_receber(_tok, jsonb_build_object('id', 'm-sair-1', 'telefone', _x, 'texto', 'SAIR'));
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = r.lead_id;
  INSERT INTO _t (nome, ok, info) SELECT 'SAIR: opt-out gravado e nunca mais elegivel',
    _a.estado = 'optout' AND EXISTS (SELECT 1 FROM public.lead_ia_optouts o WHERE o.organization_id = A AND o.contato = ANY (public.lead_ia_contatos(l.telefone, NULL)))
    AND NOT public.lead_aquecer_elegivel(l, 30), _a.estado
    FROM public.leads l WHERE l.id = r.lead_id;
  -- 6) Sem resposta -> 1 lembrete -> frio -------------------------------------------------------------------------
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  _j := public.lead_aquecer_resultado(r.envio_id, 'teste'); _lead := r.lead_id;
  UPDATE public.lead_aquecer SET enviado_em = now() - interval '4 days' WHERE lead_id = _lead;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) SELECT 'sem resposta: 1 lembrete', r.lead_id = _lead AND e.tipo = 'lembrete', e.tipo
    FROM public.lead_aquecer_envios e WHERE e.id = r.envio_id;
  _j := public.lead_aquecer_resultado(r.envio_id, 'teste');
  UPDATE public.lead_aquecer SET lembrete_em = now() - interval '4 days' WHERE lead_id = _lead;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  _n := 0;
  FOR r IN SELECT * FROM public.lead_aquecer_preparar(NULL, SEG) LOOP
    IF r.lead_id = _lead THEN _n := _n + 1; END IF;
    PERFORM public.lead_aquecer_resultado(r.envio_id, 'teste'); -- o preparo pode ter pego outro lead elegível
  END LOOP;
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = _lead;
  INSERT INTO _t (nome, ok, info) VALUES ('depois do lembrete: frio, sem 2o lembrete', _a.estado = 'frio' AND _n = 0
    AND (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.aquecer_id = _a.id AND e.tipo = 'lembrete') = 1, _a.estado);

  -- 7) Variação de texto ---------------------------------------------------------------------------------------------
  SELECT array_agg(DISTINCT public.lead_aquecer_texto('primeira', 'Ana', 'o apartamento do bairro Centro', 'Nicole', 'Imob X', g::text))
    INTO _txts FROM generate_series(1, 30) g;
  INSERT INTO _t (nome, ok, info) VALUES ('textos variam entre leads (>= 6 diferentes em 30)', cardinality(_txts) >= 6, cardinality(_txts)::text);
  SELECT bool_and(public.lead_aquecer_texto_ok(t, 'Imob X')) INTO _ok FROM unnest(_txts) t;
  INSERT INTO _t (nome, ok, info) VALUES ('todas as variacoes passam na trava', _ok, '');
  INSERT INTO _t (nome, ok, info) VALUES ('trava recusa preco e link',
    NOT public.lead_aquecer_texto_ok('Oi! O apartamento baixou para R$ 300 mil. Ainda está procurando imóvel?', 'X')
    AND NOT public.lead_aquecer_texto_ok('Oi! Veja www.imob.com.br agora mesmo. Ainda está procurando imóvel?', 'X'), '');
  INSERT INTO _t (nome, ok, info) VALUES ('classifica respostas',
    public.lead_aquecer_resposta_tipo('sim') = 'sim' AND public.lead_aquecer_resposta_tipo('ainda procuro sim') = 'sim'
    AND public.lead_aquecer_resposta_tipo('não, obrigado') = 'nao' AND public.lead_aquecer_resposta_tipo('desisti') = 'nao'
    AND public.lead_aquecer_resposta_tipo('parar') = 'optout' AND public.lead_aquecer_resposta_tipo('quanto custa?') = 'outro',
    public.lead_aquecer_resposta_tipo('não, obrigado'));

  -- 8) Isolamento entre imobiliárias + freio por taxa de falha (na B) -------------------------------------------------
  INSERT INTO _t (nome, ok, info) SELECT 'B desligada: nenhum envio da B', count(*) = 0, count(*)::text
    FROM public.lead_aquecer WHERE organization_id = B;
  UPDATE public.lead_config SET aquecer_ativo = true, aquecer_rampa_desde = (SEG AT TIME ZONE 'America/Sao_Paulo')::date,
         aquecer_freio_min = 5, aquecer_freio_taxa = 0.20 WHERE organization_id = B;
  UPDATE public.lead_config SET aquecer_proximo_em = now() + interval '1 hour' WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('B ligada: envia o lead da B, nao o da A', r.lead_id = LB, coalesce(r.lead_id::text, 'nada'));
  INSERT INTO _t (nome, ok, info) SELECT 'limite da B conta separado da A',
    public.lead_aquecer_enviados_hoje(B, NULL, now()) = 1, public.lead_aquecer_enviados_hoje(B, NULL, now())::text;
  _env := r.envio_id;
  SELECT id INTO _a.id FROM public.lead_aquecer WHERE lead_id = LB;
  INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, status, resultado_em)
  SELECT B, _a.id, 'primeira', 'Envio fictício anterior. Ainda está procurando?', false, 'teste', now() FROM generate_series(1, 4);
  _j := public.lead_aquecer_resultado(_env, 'falhou', 'http_500');
  INSERT INTO _t (nome, ok, info) SELECT 'freio automatico: 1 falha em 5 (20%) pausa a B',
    c.aquecer_pausado_em IS NOT NULL AND c.aquecer_pausa_motivo LIKE '%taxa de falha%' AND _j->>'freio' = 'taxa_falha'
    AND EXISTS (SELECT 1 FROM public.lead_aquecer_pausas p WHERE p.organization_id = B), coalesce(c.aquecer_pausa_motivo, '-')
    FROM public.lead_config c WHERE c.organization_id = B;
  INSERT INTO _t (nome, ok, info) SELECT 'freio da B nao pausa a A', c.aquecer_pausado_em IS NULL, coalesce(c.aquecer_pausa_motivo, 'ok')
    FROM public.lead_config c WHERE c.organization_id = A;
  -- Freio por opt-out: com a taxa da A em 20%, 1 SAIR em 5 envios pausa a A (e só a A).
  UPDATE public.lead_config SET aquecer_freio_taxa = 0.20 WHERE organization_id = A;
  _x := public.lead_aquecer_freio(A, NULL);
  INSERT INTO _t (nome, ok, info) SELECT 'freio por opt-out: 1 SAIR em 5 envios (20%) pausa a A',
    _x = 'optouts' AND c.aquecer_pausa_motivo = 'muitos pedidos para sair', coalesce(_x, '-') || '/' || coalesce(c.aquecer_pausa_motivo, '-')
    FROM public.lead_config c WHERE c.organization_id = A;
  UPDATE public.lead_config SET aquecer_freio_taxa = 0.50, aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL WHERE organization_id = A;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = B;
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, SEG) p WHERE p.lead_id = LB OR p.lead_id IN (SELECT id FROM public.leads WHERE organization_id = B);
  INSERT INTO _t (nome, ok, info) VALUES ('B pausada: nada sai da B', _n = 0, _n::text);

  -- 9) Freio por erro de canal (na A): 403 pausa na hora -------------------------------------------------------------
  -- Mais 3 leads fictícios parados (os 5 elegíveis do começo já foram usados).
  FOR i IN 13..15 LOOP
    INSERT INTO public.leads (organization_id, nome, telefone, origem, etapa, created_at, aceito_em)
    VALUES (A, 'Teste Aquecer ' || i, '+55159999' || lpad(i::text, 5, '0'), 'manual', 'em_atendimento',
            now() - interval '45 days', now() - interval '45 days') RETURNING id INTO _lead;
    -- O módulo já está ligado: o gatilho da Nicole abriu a conversa com a 1ª mensagem agora. Leva para 45 dias atrás
    -- (conversa antiga ATIVA: o aquecimento precisa pausá-la sem disparar os lembretes da Nicole).
    UPDATE public.lead_mensagens SET created_at = now() - interval '45 days'
     WHERE conversa_id IN (SELECT id FROM public.lead_conversas WHERE lead_id = _lead);
  END LOOP;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('modo teste nunca mexe em conversa ATIVA da Nicole (leads 13-15 pulados)', _n = 0, _n::text);
  -- Envio real (chip da A configurado no servidor e na imobiliária): pausa a conversa ativa antiga.
  UPDATE public.lead_config SET aquecer_proximo_em = NULL, aquecer_chip_numero = '15999990001' WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar('15999990001', SEG);
  IF r.envio_id IS NULL THEN
    INSERT INTO _t (nome, ok, info) VALUES ('freio erro de canal: havia lead para enviar', false, 'nenhum envio preparado');
  ELSE
    INSERT INTO _t (nome, ok, info) SELECT 'conversa ativa antiga da Nicole fica parada durante o aquecimento',
      cv.estado = 'parada' AND a.conversa_id = cv.id, cv.estado
      FROM public.lead_conversas cv JOIN public.lead_aquecer a ON a.lead_id = cv.lead_id WHERE cv.lead_id = r.lead_id;
    _j := public.lead_aquecer_resultado(r.envio_id, 'falhou', 'http_403');
    INSERT INTO _t (nome, ok, info) SELECT 'freio automatico: erro de canal (403) pausa a A na hora',
      c.aquecer_pausado_em IS NOT NULL AND c.aquecer_pausa_motivo LIKE '%http_403%' AND _j->>'freio' = 'erro_canal'
      AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.organization_id = A AND n.titulo = 'Aquecimento de leads pausado'),
      coalesce(c.aquecer_pausa_motivo, '-') FROM public.lead_config c WHERE c.organization_id = A;
  END IF;

  -- 10) Sem fallback de canal (parte do banco) -------------------------------------------------------------------------
  BEGIN
    UPDATE public.lead_config SET aquecer_chip_numero = '15911110000' WHERE organization_id = A;
    INSERT INTO _t (nome, ok, info) VALUES ('chip do aquecimento nao pode ser o chip de atendimento', false, 'aceitou');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t (nome, ok, info) VALUES ('chip do aquecimento nao pode ser o chip de atendimento', true, 'recusado');
  END;
  UPDATE public.lead_config SET aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL, aquecer_proximo_em = NULL,
         aquecer_chip_numero = '15999990001' WHERE organization_id = A;
  UPDATE public.lead_aquecer_envios SET created_at = now() - interval '2 days' WHERE organization_id = A; -- limpa a janela
  SELECT * INTO r FROM public.lead_aquecer_preparar('15999990009', SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('servidor com OUTRO chip: A fica em modo teste', r.envio_id IS NULL OR NOT r.modo_real,
    coalesce(r.modo_real::text, 'nada'));
  IF r.envio_id IS NOT NULL THEN PERFORM public.lead_aquecer_resultado(r.envio_id, 'teste'); END IF;
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar('15999990001', SEG);
  INSERT INTO _t (nome, ok, info) VALUES ('servidor com o chip da A: envio real marcado no chip certo',
    r.envio_id IS NOT NULL AND r.modo_real AND (SELECT chip_numero FROM public.lead_aquecer_envios WHERE id = r.envio_id) = '15999990001',
    coalesce(r.modo_real::text, 'nada'));
  IF r.envio_id IS NOT NULL THEN
    UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
    SELECT count(*) INTO _n FROM public.lead_aquecer_preparar('15999990001', SEG) p WHERE p.modo_real;
    INSERT INTO _t (nome, ok, info) VALUES ('intervalo do chip real: 2o envio real barrado', _n = 0, _n::text);
    PERFORM public.lead_aquecer_resultado(r.envio_id, 'teste');
  END IF;
  BEGIN
    PERFORM * FROM public.lead_aquecer_preparar('nao-e-numero', SEG);
    INSERT INTO _t (nome, ok, info) VALUES ('chip invalido recusado', false, 'aceitou');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _t (nome, ok, info) VALUES ('chip invalido recusado', true, 'recusado');
  END;
  INSERT INTO _t (nome, ok, info) VALUES ('lead_ia_liberado: retomado em modo teste nao libera envio',
    NOT public.lead_ia_liberado((SELECT c FROM public.lead_config c WHERE organization_id = A), (SELECT l FROM public.leads l WHERE id = _ids[1])), '');

  -- 10b) Revisão: lead retomado pelo aquecimento REAL nunca sai pelo chip de atendimento (nem pelo botão "Enviar") -----
  -- Cenário mais perigoso: o lead está na lista de liberados do atendimento e o atendimento está em ziontalk.
  UPDATE public.lead_config SET ia_canal = 'ziontalk', aquecer_pausado_em = NULL, aquecer_ativo = true,
         ia_envio_allowlist = ARRAY[(public.lead_ia_contatos((SELECT telefone FROM public.leads WHERE id = _ids[1]), NULL))[1]]
   WHERE organization_id = A;
  UPDATE public.lead_aquecer SET estado = 'retomado', modo_real = true, chip_numero = '15999990001', retomado_em = now()
   WHERE id = (SELECT id FROM public.lead_aquecer WHERE lead_id = _ids[1] ORDER BY created_at DESC LIMIT 1);
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _ids[1];
  UPDATE public.lead_conversas SET canal = 'ziontalk', estado = 'ativa' WHERE id = _cv.id;
  UPDATE public.lead_mensagens SET status = 'nao_enviada' WHERE conversa_id = _cv.id AND status IN ('pendente', 'enviando');
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
  VALUES (A, _cv.id, 'ia', 'Que bom! Vou te mandar opções parecidas.', public.lead_ia_status_saida(_cv.id));
  INSERT INTO _t (nome, ok, info) SELECT 'resposta a lead retomado real fica pendente (para o chip do aquecimento)',
    status = 'pendente' AND public.lead_aquecer_chip_do_lead(_ids[1]) = 'aquecer',
    status || '/' || public.lead_aquecer_chip_do_lead(_ids[1]) || '/' ||
    (SELECT c.aquecer_ativo::text || ',' || coalesce(c.aquecer_chip_numero, '-') || ',' || (c.aquecer_pausado_em IS NULL)::text
       FROM public.lead_config c WHERE c.organization_id = A) || '/' ||
    (SELECT canal || ',' || estado FROM public.lead_conversas WHERE id = _cv.id) || '/saida=' || public.lead_ia_status_saida(_cv.id)
    || '/tel=' || coalesce((SELECT (telefone IS NOT NULL)::text || ',' || simulado::text FROM public.leads WHERE id = _ids[1]), '-')
    FROM public.lead_mensagens WHERE conversa_id = _cv.id AND texto = 'Que bom! Vou te mandar opções parecidas.';
  SELECT count(*) INTO _n FROM public.lead_ia_envio_reservar(_ids[1]);
  INSERT INTO _t (nome, ok, info) VALUES ('chip de ATENDIMENTO recusa lead do aquecimento (mesmo na lista de liberados)', _n = 0, _n::text);
  SELECT count(*) INTO _n FROM public.lead_aquecer_envio_reservar(_ids[1], '15999990009');
  INSERT INTO _t (nome, ok, info) VALUES ('chip do aquecimento ERRADO nao envia', _n = 0, _n::text);
  UPDATE public.lead_config SET aquecer_pausado_em = now(), aquecer_pausa_motivo = 'teste' WHERE organization_id = A;
  SELECT count(*) INTO _n FROM public.lead_aquecer_envio_reservar(_ids[1], '15999990001');
  INSERT INTO _t (nome, ok, info) VALUES ('aquecimento pausado: nem as respostas saem pelo chip', _n = 0, _n::text);
  UPDATE public.lead_config SET aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL WHERE organization_id = A;
  SELECT count(*) INTO _n FROM public.lead_aquecer_envio_reservar(_ids[1], '15999990001');
  INSERT INTO _t (nome, ok, info) VALUES ('chip do aquecimento certo reserva a resposta pendente', _n = 1, _n::text);
  PERFORM public.lead_aquecer_falha_canal('15999990001', 'http_401');
  INSERT INTO _t (nome, ok, info) SELECT 'erro de canal numa RESPOSTA pausa o chip (freio)',
    aquecer_pausado_em IS NOT NULL AND aquecer_pausa_motivo LIKE '%http_401%', coalesce(aquecer_pausa_motivo, '-')
    FROM public.lead_config WHERE organization_id = A;
  UPDATE public.lead_aquecer SET retomado_em = now() - interval '31 days'
   WHERE id = (SELECT id FROM public.lead_aquecer WHERE lead_id = _ids[1] ORDER BY created_at DESC LIMIT 1);
  INSERT INTO _t (nome, ok, info) VALUES ('retomado ha mais de 30 dias volta ao fluxo normal (atendimento)',
    public.lead_aquecer_chip_do_lead(_ids[1]) = 'atendimento', public.lead_aquecer_chip_do_lead(_ids[1]));
  UPDATE public.lead_config SET ia_canal = 'teste', ia_envio_allowlist = '{}', aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL
   WHERE organization_id = A;

  -- 11) Permissões e tela ---------------------------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM * FROM public.lead_aquecer_preparar(NULL, SEG);
    _err := 'executou';
  EXCEPTION WHEN insufficient_privilege THEN _err := '42501';
  END;
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) VALUES ('navegador nao chama o preparo/envio', _err = '42501', _err);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.lead_aquecer_painel(30);
    _err := 'executou';
  EXCEPTION WHEN insufficient_privilege THEN _err := '42501';
  END;
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) VALUES ('anon nao le o painel', _err = '42501', _err);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM count(*) FROM public.lead_aquecer;
    _err := 'leu';
  EXCEPTION WHEN insufficient_privilege THEN _err := '42501';
  END;
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) VALUES ('tabela lead_aquecer fechada ao navegador', _err = '42501', _err);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ADM_A, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _j := public.lead_aquecer_painel(30) || jsonb_build_object('cfg', public.lead_aquecer_config());
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) VALUES ('painel da A (admin A): conta so a A',
    (_j->>'enviados')::int >= 4 AND (_j->>'voltaram')::int = 1 AND (_j->>'nao')::int = 1 AND (_j->>'optouts')::int = 1
    AND (_j->>'frios')::int = 1 AND (_j->>'pausas')::int >= 1 AND (_j->'cfg'->>'ativo')::boolean
    AND _j->'cfg'->>'chip' = '(15) ****-0001', _j::text);
  SELECT count(*) INTO _n FROM public.lead_aquecer WHERE organization_id = B;
  INSERT INTO _t (nome, ok, info) VALUES ('dados da B existem mas nao aparecem no painel da A', _n >= 1, _n::text);
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', 'cab7391a-463f-4d97-b99b-ced6e4696796', 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.lead_aquecer_salvar(false, 30, 15, 5, 2, 3);
    _err := 'salvou';
  EXCEPTION WHEN insufficient_privilege THEN _err := '42501';
  END;
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) VALUES ('gestor nao liga/desliga (so administrador)', _err = '42501', _err);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ADM_A, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.lead_aquecer_pausar(true);
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) SELECT 'admin pausa a mao', aquecer_pausado_em IS NOT NULL AND aquecer_pausa_motivo = 'pausa manual', aquecer_pausa_motivo
    FROM public.lead_config WHERE organization_id = A;
  SET LOCAL ROLE authenticated;
  PERFORM public.lead_aquecer_pausar(false);
  _j := public.lead_aquecer_previa();
  RESET ROLE;
  INSERT INTO _t (nome, ok, info) SELECT 'admin retoma (rampa recomeça) e ve a previa',
    aquecer_pausado_em IS NULL AND aquecer_rampa_desde = (now() AT TIME ZONE 'America/Sao_Paulo')::date AND jsonb_array_length(_j) = 4,
    _j->>0 FROM public.lead_config WHERE organization_id = A;

  -- 12) Lista de liberados da Nicole (ia_envio_modo = 'lista'): o aquecimento só escolhe número da lista -------------
  -- Lead 16 (na lista) e 17 (fora), parados 40 dias e aceitos. Conversa da Nicole levada para 40 dias atrás e parada.
  _ids := ARRAY[]::uuid[];
  FOR i IN 16..17 LOOP
    INSERT INTO public.leads (organization_id, nome, telefone, origem, etapa, created_at, aceito_em)
    VALUES (A, 'Teste Aquecer ' || i, '+55159999' || lpad(i::text, 5, '0'), 'manual', 'em_atendimento',
            now() - interval '40 days', now() - interval '40 days') RETURNING id INTO _lead;
    UPDATE public.lead_mensagens SET created_at = now() - interval '40 days'
     WHERE conversa_id IN (SELECT id FROM public.lead_conversas WHERE lead_id = _lead);
    UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now() - interval '40 days'
     WHERE lead_id = _lead;
    _ids := _ids || _lead;
  END LOOP;
  UPDATE public.lead_config SET ia_envio_modo = 'lista', ia_envio_desde = NULL, ia_envio_allowlist = ARRAY['15999900016'],
         aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL, aquecer_limite_dia = 50,
         aquecer_rampa_desde = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60
   WHERE organization_id = A;
  INSERT INTO _t (nome, ok, info) VALUES ('lista: 16 e 17 passam na regra dos 30 dias (so a lista separa)',
    public.lead_aquecer_elegivel((SELECT l FROM public.leads l WHERE id = _ids[1]), 30)
    AND public.lead_aquecer_elegivel((SELECT l FROM public.leads l WHERE id = _ids[2]), 30), '');
  -- Esvazia a fila: chama o preparo até não sair mais nada; tudo que sair tem de ser da lista.
  SELECT count(*) INTO _n
    FROM public.lead_aquecer_envios e JOIN public.lead_aquecer aq ON aq.id = e.aquecer_id JOIN public.leads l ON l.id = aq.lead_id
   WHERE e.organization_id = A AND NOT (public.lead_ia_contatos(l.telefone, NULL) && ARRAY['15999900016']);
  _txts := ARRAY[]::text[]; _ok := true;
  FOR k IN 1..20 LOOP
    UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
    SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, TER) p
     WHERE p.lead_id IN (SELECT id FROM public.leads WHERE organization_id = A);
    EXIT WHEN r.envio_id IS NULL;
    _txts := _txts || r.lead_id::text;
    _ok := _ok AND public.lead_ia_contatos(r.telefone, NULL) && ARRAY['15999900016'];
    PERFORM public.lead_aquecer_resultado(r.envio_id, 'teste');
    r := NULL;
  END LOOP;
  INSERT INTO _t (nome, ok, info) VALUES ('lista: 1o envio so para numero da lista (16 sim)',
    _ok AND _ids[1]::text = ANY (_txts), coalesce(array_length(_txts, 1), 0)::text || ' envio(s)');
  INSERT INTO _t (nome, ok, info) VALUES ('lista: numero fora da lista (17) nunca e escolhido', NOT (_ids[2]::text = ANY (_txts)),
    coalesce(array_length(_txts, 1), 0)::text);
  INSERT INTO _t (nome, ok, info) SELECT 'lista: nenhum envio novo de numero fora da lista na A',
    count(*) = _n, (count(*) - _n)::text
    FROM public.lead_aquecer_envios e JOIN public.lead_aquecer aq ON aq.id = e.aquecer_id JOIN public.leads l ON l.id = aq.lead_id
   WHERE e.organization_id = A AND NOT (public.lead_ia_contatos(l.telefone, NULL) && ARRAY['15999900016']);
  -- Lembrete: 17 (fora) tem envio MAIS ANTIGO que o 16 (seria o 1º da fila), mas só o 16 (na lista) recebe.
  UPDATE public.lead_aquecer SET estado = 'enviado', enviado_em = now() - interval '5 days'
   WHERE lead_id = _ids[2] AND estado IN ('enviando', 'enviado', 'lembrete');
  IF NOT FOUND THEN
    INSERT INTO public.lead_aquecer (organization_id, lead_id, estado, modo_real, enviado_em)
    VALUES (A, _ids[2], 'enviado', false, now() - interval '5 days');
  END IF;
  UPDATE public.lead_aquecer SET enviado_em = now() - interval '4 days' WHERE lead_id = _ids[1] AND estado = 'enviado';
  UPDATE public.lead_aquecer SET estado = 'frio', finalizado_em = now()
   WHERE organization_id = A AND estado IN ('enviado', 'lembrete') AND lead_id <> ALL (_ids);
  UPDATE public.lead_config SET aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, TER) p WHERE p.lead_id IN (SELECT id FROM public.leads WHERE organization_id = A);
  INSERT INTO _t (nome, ok, info) VALUES ('lista: lembrete so para numero da lista (16, nao o 17 mais antigo)',
    r.lead_id = _ids[1], coalesce(CASE r.lead_id WHEN _ids[1] THEN '16' WHEN _ids[2] THEN '17' ELSE r.lead_id::text END, 'nada'));
  INSERT INTO _t (nome, ok, info) SELECT 'lista: lembrete do 17 (fora da lista) nao sai', estado = 'enviado', estado
    FROM public.lead_aquecer WHERE lead_id = _ids[2];
  -- Lista vazia: nada sai.
  UPDATE public.lead_config SET ia_envio_allowlist = '{}', aquecer_proximo_em = NULL WHERE organization_id = A;
  UPDATE public.lead_aquecer SET estado = 'frio', finalizado_em = now() WHERE organization_id = A AND lead_id = _ids[1];
  SELECT count(*) INTO _n FROM public.lead_aquecer_preparar(NULL, TER) p WHERE p.lead_id IN (SELECT id FROM public.leads WHERE organization_id = A);
  INSERT INTO _t (nome, ok, info) VALUES ('lista vazia: nada sai (nem o lembrete do 17)', _n = 0, _n::text);
  -- Modo 'todos' segue funcionando: o lembrete do 17 sai.
  UPDATE public.lead_config SET ia_envio_modo = 'todos', ia_envio_desde = '2099-01-01', aquecer_proximo_em = NULL WHERE organization_id = A;
  SELECT * INTO r FROM public.lead_aquecer_preparar(NULL, TER) p WHERE p.lead_id IN (SELECT id FROM public.leads WHERE organization_id = A);
  INSERT INTO _t (nome, ok, info) VALUES ('modo todos: sem restricao de lista (lembrete do 17 sai)',
    r.lead_id = _ids[2], coalesce(r.lead_id::text, 'nada'));
END $$;

SELECT CASE WHEN ok THEN 'OK   ' ELSE 'FAIL ' END || nome || CASE WHEN ok THEN '' ELSE '  [' || coalesce(info, '') || ']' END FROM _t ORDER BY n;
SELECT 'RESULTADO ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM _t;
ROLLBACK;

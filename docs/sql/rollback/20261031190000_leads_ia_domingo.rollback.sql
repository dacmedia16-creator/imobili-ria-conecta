-- Rollback de 20261031190000_leads_ia_domingo (t_99359490): volta as 2 funções à versão anterior e desliga a chave.

BEGIN;

UPDATE public.lead_config SET ia_domingo = false;

CREATE OR REPLACE FUNCTION public.lead_ia_reengajar_reservar()
 RETURNS TABLE(lead_id uuid, toque integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _r record; _hoje integer; _sp timestamp := now() AT TIME ZONE 'America/Sao_Paulo'; _alt uuid; _txt text;
  _frase text; _alt_frase text; _nome text; _cap uuid;
BEGIN
  IF extract(isodow FROM _sp) = 7 OR extract(hour FROM _sp) < 9 OR extract(hour FROM _sp) >= 19 THEN RETURN; END IF;
  FOR _r IN
    SELECT cv.id AS conversa_id, cv.organization_id, cv.lead_id, cv.reengaje_1_em, cv.dados, c.ia_envio_limite_dia,
           c.ia_reengajar_h0 AS h0, q.cli, c.ia_envio_intervalo_min_s AS imin, c.ia_envio_intervalo_max_s AS imax,
           CASE WHEN cv.reengaje_1_em IS NOT NULL THEN 2
                WHEN c.ia_reengajar_h0 IS NOT NULL AND cv.reengaje_0_em IS NULL AND NOT q.cli
                     AND cv.primeira_enviada_em > now() - make_interval(hours => c.ia_reengajar_h1 - c.ia_reengajar_h0) THEN 0
                ELSE 1 END AS t
      FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
      JOIN public.organizations o ON o.id = cv.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = cv.organization_id AND m.module = 'leads' AND m.enabled
      LEFT JOIN LATERAL (SELECT max(x.created_at) AS em, (array_agg(x.autor ORDER BY x.created_at DESC))[1] AS autor
                           FROM public.lead_mensagens x WHERE x.conversa_id = cv.id) u ON true
      LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.lead_mensagens y WHERE y.conversa_id = cv.id
                                          AND y.autor = 'cliente') AS cli) q ON true
     WHERE c.ia_reengajar AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND (c.ia_reengajar_proximo_em IS NULL OR c.ia_reengajar_proximo_em <= now())
       AND cv.estado = 'ativa' AND cv.canal = 'ziontalk' AND cv.primeira_enviada_em IS NOT NULL
       AND cv.reengaje_2_em IS NULL
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
       AND public.lead_ia_liberado(c, l)
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = cv.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
       AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id
                        AND p.status IN ('pendente', 'enviando'))
       AND u.autor IN ('ia', 'sistema')
       -- t_ccaa41c0: com ia_reengajar_h0 (ex.: 3 h), quem NUNCA respondeu recebe 3 lembretes contados da 1ª mensagem:
       -- h0, h1 e h2 (ex.: 3 h, 24 h, 48 h). Fora da janela espera a abertura; o de h0 não sai se já faltar menos de h0
       -- para o de h1, e entre dois lembretes há pelo menos h0 horas (nunca 2 juntos). Quem já respondeu: regra antiga.
       AND ((c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli AND cv.reengaje_0_em IS NULL AND cv.reengaje_1_em IS NULL
             AND cv.primeira_enviada_em <= now() - make_interval(hours => c.ia_reengajar_h0)
             AND cv.primeira_enviada_em > now() - make_interval(hours => c.ia_reengajar_h1 - c.ia_reengajar_h0))
         OR (cv.reengaje_1_em IS NULL AND (c.ia_reengajar_h0 IS NULL OR q.cli)
             AND greatest(u.em, cv.primeira_enviada_em) <= now() - make_interval(hours => c.ia_reengajar_h1))
         OR (cv.reengaje_1_em IS NULL AND c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli
             AND cv.primeira_enviada_em <= now() - make_interval(hours => c.ia_reengajar_h1)
             AND (cv.reengaje_0_em IS NULL OR cv.reengaje_0_em <= now() - make_interval(hours => c.ia_reengajar_h0)))
         OR (cv.reengaje_1_em IS NOT NULL AND (c.ia_reengajar_h0 IS NULL OR q.cli)
             AND cv.reengaje_1_em <= now() - make_interval(hours => c.ia_reengajar_h2 - c.ia_reengajar_h1)
             AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens k WHERE k.conversa_id = cv.id AND k.autor = 'cliente'
                              AND k.created_at > cv.reengaje_1_em))
         OR (cv.reengaje_1_em IS NOT NULL AND c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli
             AND cv.primeira_enviada_em <= now() - make_interval(hours => coalesce(c.ia_reengajar_h2_sem_resposta, c.ia_reengajar_h2))
             AND cv.reengaje_1_em <= now() - make_interval(hours => c.ia_reengajar_h0)))
     ORDER BY u.em
     LIMIT 50
     FOR UPDATE OF cv, c SKIP LOCKED
  LOOP
    -- Limite diário da imobiliária: 1ª mensagem + toques de reengajamento.
    SELECT count(*) FILTER (WHERE (x.primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_1_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_2_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_0_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
      INTO _hoje FROM public.lead_conversas x WHERE x.organization_id = _r.organization_id;
    CONTINUE WHEN _hoje >= _r.ia_envio_limite_dia;

    SELECT * INTO _nome FROM split_part(btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)), ' ', 1);
    IF btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)) ~* '^lead( grupo zap)?$' THEN _nome := ''; END IF;
    _cap := public.lead_ia_captacao((SELECT l FROM public.leads l WHERE l.id = _r.lead_id), _r.dados);
    _frase := CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _r.organization_id, 'def') END;
    IF _r.t = 0 THEN
      _txt := format('Oi%s! Conseguiu ver minha mensagem sobre %s? Se quiser, te conto mais detalhes por aqui. (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
    ELSIF _r.t = 1 THEN
      _txt := format('Oi%s! Ainda faz sentido para você ver %s? Posso separar 2 horários de visita. (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
    ELSE
      _alt := NULL; _txt := NULL;
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
      IF _alt_frase IS NULL AND _r.h0 IS NOT NULL AND NOT _r.cli THEN
        -- t_ccaa41c0: no modo de 3 lembretes, sem alternativa compatível o último lembrete é curto (sem outro imóvel).
        _txt := format('Oi%s! Vou deixar seu atendimento aberto por aqui. Se ainda tiver interesse em %s, é só me responder. (Se não quiser mais mensagens, responda SAIR.)',
                       CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
      END IF;
      CONTINUE WHEN _alt_frase IS NULL AND _txt IS NULL; -- sem alternativa compatível: não manda o 2º toque
      IF _alt_frase IS NOT NULL THEN
      _txt := format('Oi%s! Caso %s não seja o ideal, temos também %s. Quer que eu peça ao corretor os detalhes? (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'), _alt_frase);
      END IF;
    END IF;
    CONTINUE WHEN public.lead_ia_status_saida(_r.conversa_id) <> 'pendente';
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_r.organization_id, _r.conversa_id, 'ia', left(_txt, 2000), 'pendente');
    UPDATE public.lead_conversas
       SET reengaje_0_em = CASE WHEN _r.t = 0 THEN now() ELSE reengaje_0_em END,
           reengaje_1_em = CASE WHEN _r.t = 1 THEN now() ELSE reengaje_1_em END,
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
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_toque15_elegivel(_conversa uuid, _ultima uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _c public.lead_config; _l public.leads; _u record; _cli timestamptz;
BEGIN
  IF NOT public.lead_ia_toque15_horario(now()) THEN RETURN false; END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _c.organization_id IS NULL OR _l.id IS NULL THEN RETURN false; END IF;
  IF NOT (_c.ia_toque15 AND _c.ia_ativa AND _c.ia_canal = 'ziontalk') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _cv.organization_id AND o.status = 'ativa')
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules m WHERE m.organization_id = _cv.organization_id
                     AND m.module = 'leads' AND m.enabled) THEN
    RETURN false;
  END IF;
  -- Conversa ainda com a Nicole, no canal real, 1ª mensagem enviada, sem toque e sem lembrete de 24 h.
  IF _cv.estado <> 'ativa' OR _cv.canal <> 'ziontalk' OR _cv.primeira_enviada_em IS NULL
     OR _cv.toque15_em IS NOT NULL OR _cv.reengaje_1_em IS NOT NULL OR _cv.equipe_em IS NOT NULL THEN
    RETURN false;
  END IF;
  -- Lead aberto, real, sem corretor assumindo.
  IF _l.simulado OR _l.etapa IN ('ganho', 'perdido') OR _l.aceito_em IS NOT NULL THEN RETURN false; END IF;
  -- Lista de liberados e opt-out (mesma regra das respostas e do reengajamento).
  IF NOT public.lead_ia_liberado(_c, _l)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = _cv.organization_id
                 AND op.contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    RETURN false;
  END IF;
  -- O cliente já respondeu ao menos 1 vez (quem nunca respondeu fica com os lembretes de 24/72 h).
  SELECT min(x.created_at) INTO _cli FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id AND x.autor = 'cliente';
  IF _cli IS NULL THEN RETURN false; END IF;
  -- Alguém da equipe registrou algo no lead depois da 1ª mensagem: o corretor assumiu.
  IF EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _cv.lead_id AND e.autor_id IS NOT NULL
              AND e.created_at >= _cv.primeira_enviada_em) THEN
    RETURN false;
  END IF;
  -- Nada pendente na conversa.
  IF EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = _cv.id AND p.status IN ('pendente', 'enviando')) THEN
    RETURN false;
  END IF;
  -- A última mensagem é da Nicole, saiu de verdade, há ia_toque15_min minutos ou mais e antes da janela de 24 h.
  SELECT x.id, x.autor, x.status, x.created_at INTO _u FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id
   ORDER BY x.created_at DESC, x.id DESC LIMIT 1;
  IF _u.id IS NULL OR _u.autor <> 'ia' OR _u.status <> 'enviada' OR _u.created_at <= _cli THEN RETURN false; END IF;
  IF _ultima IS NOT NULL AND _u.id <> _ultima THEN RETURN false; END IF;
  IF _u.created_at > now() - make_interval(mins => _c.ia_toque15_min) THEN RETURN false; END IF;
  IF _u.created_at <= now() - make_interval(hours => _c.ia_reengajar_h1) THEN RETURN false; END IF;
  RETURN true;
END $function$;

COMMIT;

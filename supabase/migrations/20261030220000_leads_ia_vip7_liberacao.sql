-- t_ccaa41c0 (Denis, 30/10/2026, tópico 6238): liberar a Nicole para leads reais, por imobiliária.
-- Tudo nasce DESLIGADO (mesmo comportamento de antes) e é ligado por imobiliária na lead_config:
--   ia_envio_modo 'lista' (padrão: só a lista de liberados) | 'todos' (todo lead com telefone criado a partir de ia_envio_desde)
--   ia_envio_desde        leads criados antes disso nunca recebem nada (nem 1ª mensagem, nem lembrete, nem resposta)
--   ia_primeira_auto      a 1ª mensagem sai sozinha, na hora em que o lead chega e a qualquer hora (webhook do portal;
--                         o pg_cron leads-reengajar repesca pendentes), em vez do botão do gestor
--   ia_org_nome           nome com que a IA se apresenta (vazio = nome da imobiliária)
--   ia_corretor_passagem_id  corretor que recebe o lead quando a IA passa o cliente; com ele preenchido o lead NÃO vai a
--                         ninguém ao chegar (fica com a IA, sem responsável) e o rodízio não é usado
--   ia_aviso_corretor_whats  aviso por WhatsApp (mesmo número da IA) ao corretor na passagem; 1 por lead
--   ia_reengajar_h0       lembrete extra para quem nunca respondeu (ex.: 3 h); com ele, 24 h/48 h contam da 1ª mensagem
-- Voltar ao modo anterior = 1 UPDATE na lead_config (ver supabase/rollback/20261030220000_leads_ia_vip7_liberacao.sql).

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_envio_modo text NOT NULL DEFAULT 'lista',
  ADD COLUMN IF NOT EXISTS ia_envio_desde timestamptz,
  ADD COLUMN IF NOT EXISTS ia_primeira_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_org_nome text,
  ADD COLUMN IF NOT EXISTS ia_corretor_passagem_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ia_aviso_corretor_whats boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_reengajar_h0 integer,
  ADD COLUMN IF NOT EXISTS ia_reengajar_h2_sem_resposta integer;

ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_envio_modo_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_envio_modo_check
  CHECK (ia_envio_modo IN ('lista', 'todos') AND (ia_envio_modo = 'lista' OR ia_envio_desde IS NOT NULL));
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_org_nome_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_org_nome_check
  CHECK (ia_org_nome IS NULL OR (char_length(btrim(ia_org_nome)) BETWEEN 1 AND 60
         AND ia_org_nome !~* '(h[t]tps?:|www\.|[a-z0-9-]\.[a-z]{2,}|@)'));
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_reengajar_h0_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_reengajar_h0_check
  CHECK (ia_reengajar_h0 IS NULL OR (ia_reengajar_h0 BETWEEN 1 AND 12 AND ia_reengajar_h0 * 2 < ia_reengajar_h1));
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_reengajar_h2_sem_resposta_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_reengajar_h2_sem_resposta_check
  CHECK (ia_reengajar_h2_sem_resposta IS NULL
         OR (ia_reengajar_h2_sem_resposta > ia_reengajar_h1 + coalesce(ia_reengajar_h0, 1) AND ia_reengajar_h2_sem_resposta <= 168));

ALTER TABLE public.lead_conversas ADD COLUMN IF NOT EXISTS reengaje_0_em timestamptz;

-- Avisos por WhatsApp ao corretor (só o servidor lê/grava; sem telefone/e-mail do cliente no texto).
CREATE TABLE IF NOT EXISTS public.lead_avisos_corretor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('passagem')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviando', 'enviada', 'falhou', 'sem_telefone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  UNIQUE (lead_id, evento)
);
CREATE INDEX IF NOT EXISTS lead_avisos_corretor_org_status_idx ON public.lead_avisos_corretor (organization_id, status, created_at);
ALTER TABLE public.lead_avisos_corretor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_avisos_corretor FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_avisos_corretor TO service_role;

-- Nome de apresentação da IA (vazio = nome da imobiliária).
CREATE OR REPLACE FUNCTION public.lead_ia_org_nome(_org uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(nullif(btrim((SELECT c.ia_org_nome FROM public.lead_config c WHERE c.organization_id = _org)), ''),
                  (SELECT o.nome FROM public.organizations o WHERE o.id = _org))
$function$;

-- Trava única de quem pode receber mensagem real: lista de liberados OU (modo 'todos' e lead criado a partir de ia_envio_desde).
CREATE OR REPLACE FUNCTION public.lead_ia_liberado(_c public.lead_config, _l public.leads)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT _l.telefone IS NOT NULL AND (
    public.lead_ia_contatos(_l.telefone, NULL) && coalesce(_c.ia_envio_allowlist, '{}'::text[])
    OR (_c.ia_envio_modo = 'todos' AND _c.ia_envio_desde IS NOT NULL AND _l.created_at >= _c.ia_envio_desde))
$function$;

REVOKE ALL ON FUNCTION public.lead_ia_org_nome(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_ia_liberado(public.lead_config, public.leads) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_org_nome(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_ia_liberado(public.lead_config, public.leads) TO service_role;

CREATE OR REPLACE FUNCTION public.lead_ia_iniciar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _org text; _conv uuid;
BEGIN
  BEGIN
    IF NEW.etapa IN ('ganho', 'perdido') THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organization_modules
                    WHERE organization_id = NEW.organization_id AND module = 'leads' AND enabled) THEN RETURN NULL; END IF;
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = NEW.organization_id;
    IF _c.organization_id IS NULL OR NOT _c.ia_ativa THEN RETURN NULL; END IF;
    SELECT public.lead_ia_org_nome(o.id) INTO _org FROM public.organizations o WHERE o.id = NEW.organization_id AND o.status = 'ativa';
    IF _org IS NULL THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = NEW.organization_id
                AND contato = ANY (public.lead_ia_contatos(NEW.telefone, NEW.email))) THEN
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (NEW.organization_id, NEW.id, 'ia', 'optout', 'IA não iniciada: este contato pediu para não receber mensagens.');
      RETURN NULL;
    END IF;
    INSERT INTO public.lead_conversas (organization_id, lead_id, canal)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN NOT NEW.simulado AND _c.ia_canal = 'ziontalk'
                      AND public.lead_ia_liberado(_c, NEW) THEN 'ziontalk'
                 ELSE 'teste' END)
    ON CONFLICT (lead_id) DO NOTHING RETURNING id INTO _conv;
    IF _conv IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (NEW.organization_id, _conv, 'ia', public.lead_ia_primeira_msg(NEW, _c, _org),
            public.lead_ia_status_saida(_conv));
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (NEW.organization_id, NEW.id, 'ia', 'iniciada',
            CASE WHEN (SELECT canal FROM public.lead_conversas WHERE id = _conv) = 'teste' THEN 'IA preparou a 1ª mensagem (modo teste: não enviada).'
                 ELSE 'IA preparou a 1ª mensagem.' END);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_ia_iniciar: lead % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

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

CREATE OR REPLACE FUNCTION public.lead_ia_toque15_hoje(_org uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT (count(*) FILTER (WHERE (x.primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.reengaje_1_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.reengaje_2_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.toque15_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.reengaje_0_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date))::integer
    FROM public.lead_conversas x WHERE x.organization_id = _org
$function$;

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

CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer; _vis boolean; _aviso text;
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

  -- t_ccaa41c0: no modo 'todos' a conferência é feita abaixo, pelo lead da conversa (só leads de ia_envio_desde em diante).
  IF NOT (_chave = ANY (_c.ia_envio_allowlist)) AND _c.ia_envio_modo <> 'todos' THEN
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

  IF NOT (_chave = ANY (_c.ia_envio_allowlist))
     AND NOT public.lead_ia_liberado(_c, (SELECT l FROM public.leads l WHERE l.id = _cv.lead_id)) THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'fora_lista' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'fora_lista');
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
  -- t_228659f0 item 4 (7ebaa6bb): no limite, o cliente recebia NADA. Agora:
  --  (b) visita sendo combinada (passo visita, dia sem período ou fala de dia/período/visita depois do convite):
  --      até +4 respostas para terminar; passado isso, passa como 'visita' (não 'limite');
  --  (a) ao passar, 1 aviso curto ao cliente (mesmo caminho/allowlist das respostas). encerrada_em é marcado por
  --      lead_ia_passar: a próxima mensagem do cliente sem resposta da equipe recebe o aviso de espera (10 min).
  _vis := _cv.passo = 'visita' OR coalesce(_cv.dados->>'visita_dia_pendente', '') <> ''
          OR (coalesce(_cv.dados->>'convite_visita', '') = 'true'
              AND public.lead_ia_norm(_texto) ~ '(visit|agend|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde|noite|horario)');
  IF _n >= _c.ia_resp_max_conversa AND NOT (_vis AND _n < _c.ia_resp_max_conversa + 4) THEN
    IF _vis THEN
      PERFORM public.lead_ia_passar(_cv.id, 'visita',
        'Conversa longa, cliente combinando a visita: "' || left(_texto, 120) || '". Confirme o dia e o horário com ele.');
      _aviso := 'Anotei! Um corretor da nossa equipe continua seu atendimento por aqui para combinar a visita.';
    ELSE
      PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
      _aviso := 'Obrigada pela conversa! Um corretor da nossa equipe continua seu atendimento por aqui.';
    END IF;
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'sistema', _aviso, public.lead_ia_status_saida(_cv.id));
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
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_primeira_atualizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _c public.lead_config; _org text; _m public.lead_mensagens; _novo text;
BEGIN
  BEGIN
    SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = NEW.id FOR UPDATE;
    IF _cv.id IS NULL OR _cv.primeira_enviada_em IS NOT NULL OR _cv.estado <> 'ativa' THEN RETURN NULL; END IF;
    -- Só a mensagem de abertura, sozinha e ainda não enviada (nem em envio).
    IF (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = _cv.id) <> 1 THEN RETURN NULL; END IF;
    SELECT * INTO _m FROM public.lead_mensagens
     WHERE conversa_id = _cv.id AND autor = 'ia' AND status IN ('nao_enviada', 'pendente') FOR UPDATE;
    IF _m.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = NEW.organization_id;
    IF _c.organization_id IS NULL THEN RETURN NULL; END IF;
    _org := public.lead_ia_org_nome(NEW.organization_id);
    _novo := public.lead_ia_primeira_msg(NEW, _c, _org);
    IF _novo IS NOT NULL AND _novo IS DISTINCT FROM _m.texto THEN
      UPDATE public.lead_mensagens SET texto = _novo WHERE id = _m.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_ia_primeira_atualizar: lead % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  _org := public.lead_ia_org_nome(_cv.organization_id);
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
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_toque15_candidatas()
 RETURNS TABLE(conversa_id uuid, lead_id uuid, organization_id uuid, ultima_id uuid, cliente text, ia_nome text, org_nome text, redige boolean, provedor text, modelo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT z.conversa_id, z.lead_id, z.organization_id, z.ultima_id, z.cliente, z.ia_nome, z.org_nome, z.redige, z.provedor, z.modelo
  FROM (
  SELECT DISTINCT ON (cv.organization_id) cv.id AS conversa_id, cv.lead_id, cv.organization_id, u.id AS ultima_id,
         CASE WHEN btrim(l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE left(split_part(btrim(coalesce(l.nome, '')), ' ', 1), 40) END AS cliente,
         btrim(c.ia_nome) AS ia_nome, left(coalesce(public.lead_ia_org_nome(o.id), 'imobiliária'), 80) AS org_nome, coalesce(c.ia_redige, false) AS redige,
         c.ia_modelo_provedor AS provedor, c.ia_modelo AS modelo, u.created_at AS em
    FROM public.lead_conversas cv
    JOIN public.lead_config c ON c.organization_id = cv.organization_id
    JOIN public.leads l ON l.id = cv.lead_id
    JOIN public.organizations o ON o.id = cv.organization_id
    JOIN LATERAL (SELECT x.id, x.created_at FROM public.lead_mensagens x WHERE x.conversa_id = cv.id
                   ORDER BY x.created_at DESC, x.id DESC LIMIT 1) u ON true
   WHERE c.ia_toque15 AND cv.estado = 'ativa' AND cv.canal = 'ziontalk' AND cv.toque15_em IS NULL
     AND cv.reengaje_1_em IS NULL
     AND (c.ia_reengajar_proximo_em IS NULL OR c.ia_reengajar_proximo_em <= now())
     AND public.lead_ia_toque15_hoje(cv.organization_id) < c.ia_envio_limite_dia
     AND public.lead_ia_toque15_elegivel(cv.id, u.id)
   ORDER BY cv.organization_id, u.created_at
  ) z
  ORDER BY z.em
  LIMIT 3;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_distribuir(_lead uuid, _excluir uuid, _motivo text, _autor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads; _c public.lead_config; _alvo uuid; _rodizio boolean := false; _ja uuid[];
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  IF _l.id IS NULL OR _l.etapa IN ('ganho', 'perdido') THEN RETURN _l.responsavel_id; END IF;
  -- t_ccaa41c0: modo "a IA passa" (lead_config.ia_corretor_passagem_id). O lead fica com a IA, sem corretor, até
  -- ela passar o cliente (lead_ia_passar atribui ao corretor da passagem). Sem rodízio. Antes da passagem, nada muda.
  IF _l.responsavel_id IS NULL
     AND EXISTS (SELECT 1 FROM public.lead_config c0 WHERE c0.organization_id = _l.organization_id
              AND c0.ia_corretor_passagem_id IS NOT NULL AND c0.ia_ativa)
     AND NOT EXISTS (SELECT 1 FROM public.lead_conversas cv WHERE cv.lead_id = _l.id AND cv.estado = 'passada') THEN
    RETURN _l.responsavel_id;
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_l.organization_id) ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id FOR UPDATE;
  -- Cada corretor recebe o lead no máximo 1 vez por ciclo; todos recusaram = banco (sem loop infinito).
  _ja := array_remove(public.lead_ja_recebeu(_l.id) || _excluir, NULL);
  -- Já passado e o corretor não aceitou no prazo (ou saiu): vai para o banco, o gestor decide. Sem rodízio.
  IF _c.ia_corretor_passagem_id IS NOT NULL AND _c.ia_ativa THEN
    _alvo := NULL;
  ELSIF _c.distribuicao <> 'manual' THEN
    IF _c.distribuicao = 'captador_depois_rodizio' AND _l.tentativas_aceite = 0 AND _l.captador_id IS NOT NULL
       AND NOT (_l.captador_id = ANY (_ja))
       AND public.lead_pode_ser_responsavel(_l.captador_id, _l.organization_id) THEN
      _alvo := _l.captador_id;
    ELSE
      _alvo := public.lead_rodizio_proximo(_l.organization_id, _c.rodizio_ultimo_id, _ja);
      _rodizio := _alvo IS NOT NULL;
    END IF;
  END IF;

  IF _alvo IS NULL THEN
    IF _l.no_banco_desde IS NULL THEN
      PERFORM public.lead_mandar_banco(_l.id, coalesce(_motivo || '; ', '') || 'ninguem disponivel para receber', _autor);
    END IF;
    RETURN NULL;
  END IF;

  IF _rodizio THEN
    UPDATE public.lead_config SET rodizio_ultimo_id = _alvo, updated_at = now() WHERE organization_id = _l.organization_id;
  END IF;
  UPDATE public.leads SET responsavel_id = _alvo, atribuido_em = now(), aceito_em = NULL,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = _l.tentativas_aceite + 1,
         updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_l.organization_id, _l.id,
          CASE WHEN _l.responsavel_id IS NULL AND _l.no_banco_desde IS NULL THEN 'atribuido' ELSE 'redistribuido' END,
          coalesce(_l.responsavel_id::text, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END), _alvo::text,
          left(concat_ws('; ', _motivo, CASE WHEN _rodizio THEN 'rodizio' ELSE 'captador do imovel' END), 2000), _autor);
  PERFORM public.lead_notificar(_alvo, _l.organization_id, 'Novo lead para você',
    'Lead "' || _l.nome || '": aceite em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ' em Meus leads.');
  IF _l.responsavel_id IS NOT NULL AND _l.responsavel_id <> _alvo THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _l.organization_id, 'Lead passado para outro corretor',
      'O lead "' || _l.nome || '" foi para o próximo da vez: ' || coalesce(_motivo, 'redistribuído') || '.');
  END IF;
  RETURN _alvo;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_passar(_conversa uuid, _motivo text, _resumo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _l public.leads; _g record; _titulo text; _msg text;
  _c public.lead_config; _de text; _cli text;
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
  -- t_ccaa41c0: modo "Nicole passa". Cliente que fala com corretor (qualificado, visita, pediu pessoa, sensível,
  -- conversa longa) vai AGORA para o corretor da passagem; o prazo de aceite conta daqui. Um só sino (abaixo) e,
  -- com ia_aviso_corretor_whats, 1 WhatsApp por lead (lead_avisos_corretor, único por lead+evento).
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  IF _c.ia_corretor_passagem_id IS NOT NULL AND _c.ia_ativa AND _l.responsavel_id IS NULL
     AND _l.etapa NOT IN ('ganho', 'perdido')
     AND _motivo IN ('qualificado', 'visita', 'pediu_pessoa', 'sensivel', 'limite')
     AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _cv.organization_id) THEN
    _de := CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END;
    UPDATE public.leads SET responsavel_id = _c.ia_corretor_passagem_id, atribuido_em = now(), aceito_em = NULL,
           ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = tentativas_aceite + 1, updated_at = now()
     WHERE id = _l.id RETURNING * INTO _l;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota)
    VALUES (_cv.organization_id, _l.id, 'atribuido', _de, _c.ia_corretor_passagem_id::text,
            left('passagem da ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ': ' || _motivo, 2000));
    IF _c.ia_aviso_corretor_whats AND NOT _l.simulado THEN
      _cli := split_part(btrim(coalesce(_l.nome, '')), ' ', 1);
      IF btrim(coalesce(_l.nome, '')) ~* '^lead( grupo zap)?$' OR _cli = '' OR _cli ~ '[0-9@/:]' OR char_length(_cli) > 30 THEN
        _cli := 'um cliente';
      ELSE
        _cli := 'o cliente ' || _cli;
      END IF;
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
      VALUES (_cv.organization_id, _l.id, _c.ia_corretor_passagem_id, 'passagem',
              left(coalesce(public.lead_ia_org_nome(_cv.organization_id) || ': ', '')
                   || 'a ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ' passou ' || _cli || ' para você. '
                   || 'Veja o resumo no ADM, em Meus leads (aceite em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ').', 500))
      ON CONFLICT (lead_id, evento) DO NOTHING;
    END IF;
  END IF;
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
  -- pessoal): gestores e administradores da imobiliária também recebem. No assunto sensível, o
  -- Administrador principal (super_admin da própria imobiliária) também. DISTINCT: 1 aviso por pessoa.
  IF _l.responsavel_id IS NULL OR _motivo IN ('sensivel', 'nao_lead') THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id
                 AND (r.role::text IN ('admin', 'gestor')
                      OR (_motivo = 'sensivel' AND r.role::text = 'super_admin'))
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $function$;

-- 1ª mensagem automática (ia_primeira_auto), A QUALQUER HORA (Denis 30/10): o webhook do portal dispara na hora em que
-- o lead chega; a rota do pg_cron (leads-reengajar) repesca o que ficou pendente. 1 lead por chamada, pelo caminho de
-- sempre (lead_ia_envio_reservar: lista/modo, opt-out e limite do dia).
-- shortcut: só leads criados nos últimos 3 dias (depois disso a 1ª mensagem fica para o botão do gestor).
CREATE OR REPLACE FUNCTION public.lead_ia_primeira_auto_proximo()
 RETURNS TABLE(lead_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT cv.lead_id
    FROM public.lead_conversas cv
    JOIN public.lead_config c ON c.organization_id = cv.organization_id
    JOIN public.leads l ON l.id = cv.lead_id AND l.organization_id = cv.organization_id
    JOIN public.organizations o ON o.id = cv.organization_id AND o.status = 'ativa'
    JOIN public.organization_modules m ON m.organization_id = cv.organization_id AND m.module = 'leads' AND m.enabled
   WHERE c.ia_primeira_auto AND c.ia_ativa AND c.ia_canal = 'ziontalk'
     AND cv.canal = 'ziontalk' AND cv.estado = 'ativa' AND cv.primeira_enviada_em IS NULL
     AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
     AND l.created_at > now() - interval '3 days'
     AND public.lead_ia_liberado(c, l)
     AND EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id AND p.status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id AND p.status = 'enviando')
   ORDER BY l.created_at
   LIMIT 1
$function$;

-- Aviso por WhatsApp ao corretor: reserva (marca "enviando") e devolve telefone + texto. Corretor sem telefone
-- válido = 'sem_telefone' (fica só o sino). Nunca repete: falhou fica falhou.
CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_reservar(_lead uuid)
 RETURNS TABLE(aviso_id uuid, telefone text, texto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _a record; _tel text;
BEGIN
  FOR _a IN
    SELECT a.id, a.texto, p.telefone AS fone
      FROM public.lead_avisos_corretor a
      JOIN public.lead_config c ON c.organization_id = a.organization_id
      JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
      JOIN public.profiles p ON p.id = a.user_id
     WHERE a.status = 'pendente' AND (_lead IS NULL OR a.lead_id = _lead)
       AND a.created_at > now() - interval '1 day'
       AND c.ia_aviso_corretor_whats AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND l.responsavel_id = a.user_id
     ORDER BY a.created_at
     LIMIT 3
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    _tel := regexp_replace(coalesce(_a.fone, ''), '[^0-9]', '', 'g');
    IF _tel !~ '^(55)?[1-9][0-9][0-9]{8,9}$' THEN
      UPDATE public.lead_avisos_corretor SET status = 'sem_telefone' WHERE id = _a.id;
      CONTINUE;
    END IF;
    UPDATE public.lead_avisos_corretor SET status = 'enviando' WHERE id = _a.id;
    aviso_id := _a.id; telefone := _tel; texto := _a.texto;
    RETURN NEXT;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_resultado(_aviso uuid, _ok boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE public.lead_avisos_corretor
     SET status = CASE WHEN _ok THEN 'enviada' ELSE 'falhou' END, enviado_em = CASE WHEN _ok THEN now() END
   WHERE id = _aviso AND status = 'enviando'
$function$;

REVOKE ALL ON FUNCTION public.lead_ia_primeira_auto_proximo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_avisos_corretor_reservar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_avisos_corretor_resultado(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_primeira_auto_proximo() TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_avisos_corretor_reservar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_avisos_corretor_resultado(uuid, boolean) TO service_role;

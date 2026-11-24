-- Rollback de 20270102120000_leads_c2s (t_32f5458d). Corpos das 4 funções copiados de PRODUÇÃO em 24/11/2026

-- (pg_get_functiondef), antes da migration. Rodar numa transação. Apaga os leads de origem 'c2s' e os avisos novos.

BEGIN;

UPDATE public.lead_config SET c2s_token_hash = NULL, c2s_desde = NULL, c2s_aviso_whats = false WHERE c2s_token_hash IS NOT NULL OR c2s_aviso_whats;

-- lead_inserir(uuid,text,text,text,text,text,uuid,uuid,boolean,text,text)
CREATE OR REPLACE FUNCTION public.lead_inserir(_org uuid, _nome text, _telefone text, _email text, _origem text, _mensagem text, _capture_id uuid, _autor uuid, _simulado boolean, _consentimento text, _externo_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx') THEN
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
END $function$;

-- lead_atribuir(uuid,uuid)
CREATE OR REPLACE FUNCTION public.lead_atribuir(_lead uuid, _responsavel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _prazo integer;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador atribui lead' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NOT DISTINCT FROM _responsavel_id THEN RETURN _responsavel_id; END IF;
  UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(), aceito_em = NULL,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = 1, updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'redistribuido' ELSE 'atribuido' END,
          coalesce(_l.responsavel_id::text, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END),
          _responsavel_id::text, 'pelo gestor', _me);
  SELECT coalesce((SELECT prazo_aceite_min FROM public.lead_config WHERE organization_id = _org), 30) INTO _prazo;
  PERFORM public.lead_notificar(_responsavel_id, _org, 'Novo lead para você',
    'Lead "' || _l.nome || '": aceite em até ' || public.lead_prazo_txt(_prazo) || ' em Meus leads.');
  RETURN _responsavel_id;
END $function$;

-- leads_processar_prazos()
CREATE OR REPLACE FUNCTION public.leads_processar_prazos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _r record; _sem_dono integer := 0; _papel integer := 0; _aceite integer := 0;
  _primeira integer := 0; _parado integer := 0; _falhas integer := 0;
BEGIN
  FOR _r IN
    SELECT l.id, l.responsavel_id, l.aceito_em, l.ultima_interacao_em, l.atribuido_em, l.organization_id,
           c.prazo_aceite_min, c.prazo_primeira_interacao_dias AS d1, c.prazo_sem_interacao_dias AS d30
      FROM public.leads l
      JOIN public.organizations o ON o.id = l.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = l.organization_id AND m.module = 'leads' AND m.enabled
      JOIN public.lead_config c ON c.organization_id = l.organization_id
     WHERE l.etapa NOT IN ('ganho', 'perdido') AND l.no_banco_desde IS NULL
       AND (l.responsavel_id IS NULL
         OR NOT public.lead_pode_ser_responsavel(l.responsavel_id, l.organization_id)
         OR (l.aceito_em IS NULL AND coalesce(l.atribuido_em, l.created_at) + make_interval(mins => c.prazo_aceite_min) <= now())
         OR (l.aceito_em IS NOT NULL AND l.ultima_interacao_em IS NULL
             AND l.aceito_em + make_interval(days => c.prazo_primeira_interacao_dias) <= now())
         OR (l.ultima_interacao_em IS NOT NULL
             AND l.ultima_interacao_em + make_interval(days => c.prazo_sem_interacao_dias) <= now()))
     ORDER BY l.created_at
     LIMIT 500
     FOR UPDATE OF l SKIP LOCKED
  LOOP
   -- Um lead com problema não trava a rodada: desfaz só ele, avisa no log e segue.
   BEGIN
    IF _r.responsavel_id IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, NULL, 'sem responsavel', NULL); _sem_dono := _sem_dono + 1;
    ELSIF NOT public.lead_pode_ser_responsavel(_r.responsavel_id, _r.organization_id) THEN
      IF _r.aceito_em IS NULL THEN
        PERFORM public.lead_distribuir(_r.id, _r.responsavel_id, 'responsavel sem papel de atendimento', NULL);
      ELSE
        PERFORM public.lead_mandar_banco(_r.id, 'responsavel sem papel de atendimento', NULL);
      END IF;
      _papel := _papel + 1;
    ELSIF _r.aceito_em IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, _r.responsavel_id,
        'nao aceito em ' || public.lead_prazo_txt(_r.prazo_aceite_min), NULL);
      _aceite := _aceite + 1;
    ELSIF _r.ultima_interacao_em IS NULL THEN
      PERFORM public.lead_mandar_banco(_r.id, 'sem 1a interacao em ' || _r.d1 || ' dias', NULL);
      _primeira := _primeira + 1;
    ELSE
      PERFORM public.lead_mandar_banco(_r.id, _r.d30 || ' dias sem interacao', NULL);
      _parado := _parado + 1;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    _falhas := _falhas + 1;
    RAISE WARNING 'leads_processar_prazos: lead % falhou: %', _r.id, SQLERRM;
   END;
  END LOOP;
  DELETE FROM public.lead_form_tentativas WHERE created_at < now() - interval '1 day';
  RETURN jsonb_build_object('sem_responsavel', _sem_dono, 'papel', _papel, 'aceite_vencido', _aceite,
                            'sem_primeira_interacao', _primeira, 'sem_interacao', _parado, 'falhas', _falhas);
END $function$;

-- lead_avisos_corretor_reservar(uuid)
CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_reservar(_lead uuid)
 RETURNS TABLE(aviso_id uuid, telefone text, texto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _a record; _tel text; _txt text; _hist text; _hid uuid; _cod integer; _l public.leads; _desde timestamptz;
BEGIN
  FOR _a IN
    SELECT a.id, a.texto, a.evento, a.lead_id, a.organization_id, a.user_id, p.telefone AS fone, c.ia_aceite_whats AS aceite
      FROM public.lead_avisos_corretor a
      JOIN public.lead_config c ON c.organization_id = a.organization_id
      JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
      JOIN public.profiles p ON p.id = a.user_id
     WHERE a.status = 'pendente' AND a.evento IN ('passagem', 'reenvio', 'pronto') AND (_lead IS NULL OR a.lead_id = _lead)
       AND a.created_at > now() - interval '1 day'
       AND c.ia_aviso_corretor_whats AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND l.responsavel_id = a.user_id
       -- o "pronto" só sai depois do 1º aviso (que já leva o resumo e a conversa inteira)
       AND (a.evento <> 'pronto' OR NOT EXISTS (SELECT 1 FROM public.lead_avisos_corretor b WHERE b.lead_id = a.lead_id
                                                  AND b.evento IN ('passagem', 'reenvio') AND b.status IN ('pendente', 'enviando')
                                                  AND b.created_at > now() - interval '1 day'))
     ORDER BY a.created_at
     LIMIT 3
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    _tel := regexp_replace(coalesce(_a.fone, ''), '[^0-9]', '', 'g');
    IF _tel !~ '^(55)?[1-9][0-9][0-9]{8,9}$' THEN
      UPDATE public.lead_avisos_corretor SET status = 'sem_telefone' WHERE id = _a.id;
      CONTINUE;
    END IF;
    _cod := NULL;
    IF _a.aceite THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      IF public.lead_aceite_pendente(_l, _a.user_id) THEN
        _cod := public.lead_aceite_codigo(_a.lead_id, _a.user_id, _a.organization_id);
      END IF;
    END IF;
    IF _a.evento = 'pronto' THEN
      _txt := coalesce(public.lead_aviso_pronto_texto(_a.lead_id, _cod), _a.texto);
    ELSE
      _txt := coalesce(public.lead_aviso_corretor_texto(_a.lead_id, _a.evento = 'reenvio', _cod), _a.texto);
    END IF;
    UPDATE public.lead_avisos_corretor SET status = 'enviando', texto = _txt WHERE id = _a.id;
    aviso_id := _a.id; telefone := _tel; texto := _txt;
    RETURN NEXT;
    -- histórico: 1 por lead, logo depois do aviso; no "pronto", só as mensagens novas desde o 1º aviso
    IF _a.evento = 'pronto' THEN
      SELECT max(coalesce(b.enviado_em, b.created_at)) INTO _desde FROM public.lead_avisos_corretor b
       WHERE b.lead_id = _a.lead_id AND b.evento IN ('passagem', 'reenvio', 'historico');
      _hist := public.lead_aviso_corretor_historico(_a.lead_id, coalesce(_desde, '-infinity'::timestamptz));
    ELSE
      _hist := public.lead_aviso_corretor_historico(_a.lead_id);
    END IF;
    IF _hist IS NOT NULL THEN
      _hid := NULL;
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto, status)
      VALUES (_a.organization_id, _a.lead_id, _a.user_id,
              CASE WHEN _a.evento = 'pronto' THEN 'historico_pronto' ELSE 'historico' END, _hist, 'enviando')
      ON CONFLICT (lead_id, evento) DO NOTHING
      RETURNING id INTO _hid;
      IF _hid IS NOT NULL THEN
        aviso_id := _hid; telefone := _tel; texto := _hist;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END $function$;

DELETE FROM public.lead_avisos_corretor WHERE evento IN ('c2s', 'transferencia');

DELETE FROM public.leads WHERE origem = 'c2s';

DROP FUNCTION IF EXISTS public.lead_c2s_receber(text, jsonb);

DROP FUNCTION IF EXISTS public.lead_c2s_token_gerar(uuid, timestamptz);

DROP FUNCTION IF EXISTS public.lead_c2s_desligar(uuid);

DROP FUNCTION IF EXISTS public.lead_c2s_aviso_texto(uuid, boolean);

DROP FUNCTION IF EXISTS public.lead_c2s_responsavel(uuid, text, text);

DROP FUNCTION IF EXISTS public.lead_c2s_norm(text);

ALTER TABLE public.lead_avisos_corretor DROP CONSTRAINT IF EXISTS lead_avisos_corretor_evento_check;

ALTER TABLE public.lead_avisos_corretor ADD CONSTRAINT lead_avisos_corretor_evento_check
  CHECK (evento IN ('passagem', 'reenvio', 'historico', 'pronto', 'historico_pronto'));

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_origem_check;

ALTER TABLE public.leads ADD CONSTRAINT leads_origem_check
  CHECK (origem IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx'));

ALTER TABLE public.leads DROP COLUMN IF EXISTS sem_prazo, DROP COLUMN IF EXISTS imovel_interesse;

DROP INDEX IF EXISTS public.lead_config_c2s_hash_uniq;

ALTER TABLE public.lead_config DROP COLUMN IF EXISTS c2s_token_hash, DROP COLUMN IF EXISTS c2s_desde,
  DROP COLUMN IF EXISTS c2s_aviso_whats;

COMMIT;

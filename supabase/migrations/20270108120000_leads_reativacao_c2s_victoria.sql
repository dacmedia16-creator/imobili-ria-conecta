-- t_5fcada08 (Denis 27/11/2026, tópico 6238): reativação dos leads arquivados da C2S na Única, TUDO DESLIGADO.
-- Nada muda para ninguém enquanto lead_config.aquecer_reativacao = false (padrão) e aquecer_sair_* = NULL (padrão).
--  1) Freio de SAIR por chip com taxa/amostra próprias (aquecer_sair_taxa/_min; NULL = regra antiga), comparação "passou de".
--  2) Modo reativação (aquecer_reativacao): 1ª mensagem e lembrete novos; só leads da importação (externo_id 'c2s-reativ:%'),
--     sem depender da lista de liberados; resposta ÚNICA ao SAIR/"não" com convite do treinamento (1 vez por telefone,
--     em qualquer chip/imobiliária); indicação vai ao responsável padrão com rótulo; interesse vai ao responsável padrão
--     (aceito, sem prazo, resumo), sem aviso ao corretor.
--  3) Lead sem responsável e sem_prazo nunca vai ao banco/rodízio (hoje 0 leads nessa condição).
--  4) Nome da assistente: Victoria (padrão da coluna, textos de reserva e as 3 imobiliárias que usam a assistente).
BEGIN;

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS aquecer_reativacao boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aquecer_sair_taxa numeric(4,2),
  ADD COLUMN IF NOT EXISTS aquecer_sair_min integer;
ALTER TABLE public.lead_config
  ADD CONSTRAINT lead_config_aquecer_sair_taxa_chk CHECK (aquecer_sair_taxa IS NULL OR aquecer_sair_taxa BETWEEN 0.05 AND 0.50),
  ADD CONSTRAINT lead_config_aquecer_sair_min_chk CHECK (aquecer_sair_min IS NULL OR aquecer_sair_min BETWEEN 5 AND 100);
ALTER TABLE public.lead_config ALTER COLUMN ia_nome SET DEFAULT 'Victoria';

ALTER TABLE public.lead_aquecer
  ADD COLUMN IF NOT EXISTS convite_em timestamptz,
  ADD COLUMN IF NOT EXISTS saida_msg_id uuid,
  ADD COLUMN IF NOT EXISTS indicacao_em timestamptz;

-- Lead da importação da reativação (só estes recebem a 1ª mensagem no modo reativação).
CREATE OR REPLACE FUNCTION public.lead_aquecer_reativacao_lead(_l public.leads)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT _l.origem = 'outro' AND coalesce(_l.externo_id, '') LIKE 'c2s-reativ:%'
$function$;

-- Já recebeu o convite do treinamento? (qualquer lead/chip/imobiliária com o mesmo telefone)
CREATE OR REPLACE FUNCTION public.lead_aquecer_convite_usado(_tel text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
                  WHERE a.convite_em IS NOT NULL
                    AND public.lead_ia_contatos(l.telefone, NULL) && public.lead_ia_contatos(_tel, NULL))
$function$;

-- Textos da saída (SAIR) e do "não" no modo reativação. _convite = incluir o convite do treinamento.
CREATE OR REPLACE FUNCTION public.lead_aquecer_saida_texto(_cls text, _motivo text, _convite boolean, _org text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN _cls = 'optout' AND _convite THEN 'Pronto, já tirei seu contato da nossa lista e você não vai mais receber mensagens nossas. ' || format('Só aproveitando: se você conhece alguém que queira trabalhar no mercado imobiliário, a %s está selecionando pessoas para o próximo treinamento. Se quiser indicar, é só responder aqui.', coalesce(nullif(btrim(_org), ''), 'imobiliária')) || ' Obrigada!'
    WHEN _cls = 'optout' THEN 'Pronto, já tirei seu contato da nossa lista e você não vai mais receber mensagens nossas. Obrigada!'
    WHEN _cls = 'nao' AND _convite THEN
      CASE WHEN _motivo = 'ja_comprou' THEN 'Que bom que deu certo, obrigada por me avisar! '
           ELSE 'Entendi, obrigada por me avisar! ' END
      || format('Só aproveitando: se você conhece alguém que queira trabalhar no mercado imobiliário, a %s está selecionando pessoas para o próximo treinamento. Se quiser indicar, é só responder aqui.', coalesce(nullif(btrim(_org), ''), 'imobiliária'))
    WHEN _cls = 'nao' AND _motivo = 'ja_comprou' THEN 'Que bom que deu certo, obrigada por me avisar!'
    WHEN _cls = 'nao' THEN 'Entendi, obrigada por me avisar!'
    ELSE NULL END
$function$;

-- Resposta depois do convite parece indicação/interesse no treinamento? (não: SAIR, "não", agradecimento, ok)
CREATE OR REPLACE FUNCTION public.lead_aquecer_indicacao(_t text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT char_length(n) >= 2 AND n ~ '[a-z]'
     AND NOT public.lead_ia_e_optout(_t)
     AND public.lead_aquecer_resposta_tipo(_t) <> 'nao'
     AND n !~ '(nao conheco|ninguem|nao tenho (ninguem|indicac))'
     AND n !~ '^[[:space:][:punct:]]*(ok|okay|blz|beleza|obrigad[oa]s?|obg|valeu|vlw|de nada|tchau|nao|n|nada|tudo bem|certo|ta|ta bom|entendi|show|top|amem|joia|legal|otimo|disponha|bom dia|boa tarde|boa noite|kk+|rs+)([[:space:][:punct:]]+(obrigad[oa]s?|valeu|vlw|obg))?[[:space:][:punct:]]*$'
  FROM (SELECT btrim(public.lead_ia_norm(coalesce(_t, ''))) AS n) x
$function$;

REVOKE ALL ON FUNCTION public.lead_aquecer_reativacao_lead(public.leads) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aquecer_convite_usado(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aquecer_saida_texto(text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aquecer_indicacao(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_reativacao_lead(public.leads) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_convite_usado(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_saida_texto(text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_indicacao(text) TO service_role;

-- Pedidos de saída em linguagem natural (amplia o reconhecimento do SAIR).
CREATE OR REPLACE FUNCTION public.lead_ia_e_optout(_t text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT public.lead_ia_norm(_t) ~ '^\s*(quero |pode )?(sair|parar|pare|stop|cancelar|descadastrar|remover)[\s,.!]*(por favor|pf|pfv|obrigad[oa])?[\s.!]*$'
      OR public.lead_ia_norm(_t) ~ '(nao (quero|desejo) (mais )?(receber|mensage)|nao me (mande|envie|chame|procure)|(para|parar|pare) de (me )?(mandar|enviar)|remov(a|e|er) (o )?meu (numero|contato|telefone)|(me )?(tira|tire|remove|remova) (da|dessa|desta|de sua|da sua) lista|descadastr)'
      -- t_5fcada08: a 1ª mensagem nova diz "é só me avisar" (sem a palavra SAIR): aceita os pedidos naturais.
      OR public.lead_ia_norm(_t) ~ '(nao (me )?(escreva|escreve|mande|manda|chame|chama|procure|procura) mais|nao precisa (mais )?(me )?(escrever|mandar|chamar)|(pode|podem) (parar de (me )?(mandar|enviar|escrever|chamar)|me tirar d|tirar meu (numero|contato)|(remover|excluir|apagar) meu (numero|contato))|nao quero mais (receber|mensage|contato)|para de me (escrever|mandar|chamar)|^\s*(me )?(tira|tire|exclui|exclua|apaga|apague)( meu (numero|contato))?[\s.!]*$)'
$function$;

-- 1ª mensagem e lembrete do modo reativação (as variantes antigas ficam iguais).
CREATE OR REPLACE FUNCTION public.lead_aquecer_texto(_tipo text, _nome text, _frase text, _ia text, _org text, _semente text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE _h integer := abs(hashtext(coalesce(_semente, ''))); _n text := CASE WHEN coalesce(_nome, '') = '' THEN '' ELSE ', ' || _nome END;
  _a text; _q text; _ab text[]; _qs text[] := ARRAY['Ainda está procurando imóvel?', 'Você segue procurando um imóvel?',
    'Ainda faz sentido eu te ajudar a encontrar um imóvel?'];
  _sair text := ' (Se não quiser mais mensagens, responda SAIR.)';
  _sair2 text := ' Se preferir que eu não escreva mais, é só me avisar.';
BEGIN
  -- t_5fcada08: modo reativação (Denis 27/11): mais curta, pergunta direta, sem tom de propaganda e sem o SAIR em maiúsculas.
  IF _tipo = 'lembrete_reativacao' THEN
    RETURN format('Oi%s! Só confirmando: ainda posso te ajudar a encontrar um imóvel? Um sim ou não já me ajuda.', _n) || _sair2;
  END IF;
  -- Base no piloto (58 envios): "Você chegou a ver" teve menos SAIR e mais retomadas; "Faz um tempinho"/"Lembrei de você"
  -- e "Você segue procurando?" tiveram mais SAIR. Sem a palavra SAIR em maiúsculas (os 17 SAIR foram só "SAIR").
  IF _tipo = 'primeira_reativacao' THEN
    RETURN (ARRAY[
      format('Oi%s! Aqui é a %s, da %s. Você chegou a ver %s com a gente. Ainda está procurando imóvel?', _n, _ia, _org, coalesce(_frase, 'um imóvel')),
      format('Oi%s, tudo bem? Sou a %s, da %s. Um tempo atrás você se interessou por %s. Ainda está procurando imóvel?', _n, _ia, _org, coalesce(_frase, 'um imóvel nosso')),
      format('Olá%s! Aqui é a %s, da %s. Você falou com a gente sobre %s. Ainda faz sentido eu te ajudar a encontrar um imóvel?', _n, _ia, _org, coalesce(_frase, 'um imóvel'))
    ])[1 + _h % 3] || _sair2;
  END IF;
  IF _tipo = 'lembrete' THEN
    RETURN (ARRAY[
      format('Oi%s! Passando só para saber: ainda está procurando imóvel? Pode me responder com um sim ou não.', _n),
      format('Oi%s, tudo bem? Só confirmando se ainda posso te ajudar a encontrar um imóvel. É só responder sim ou não.', _n)
    ])[1 + _h % 2] || _sair;
  END IF;
  _ab := ARRAY[
    format('Oi%s! Aqui é %s, da %s. Você chegou a ver %s com a gente há um tempo.', _n, _ia, _org, coalesce(_frase, 'um imóvel')),
    format('Olá%s, tudo bem? Aqui é %s, da %s. Faz um tempinho que você viu %s com a gente.', _n, _ia, _org, coalesce(_frase, 'um imóvel')),
    format('Oi%s, tudo certo? %s aqui, da %s. Lembrei de você, que viu %s com a gente.', _n, _ia, _org, coalesce(_frase, 'um imóvel'))];
  IF _frase IS NOT NULL THEN
    _ab := _ab || format('Oi%s! Sou %s, da %s. Um tempo atrás você se interessou por um imóvel nosso: %s.', _n, _ia, _org, _frase);
  END IF;
  _a := _ab[1 + _h % cardinality(_ab)];
  _q := _qs[1 + (_h / 7) % cardinality(_qs)];
  RETURN _a || ' ' || _q || _sair;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_texto_ok(_t text, _org text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT char_length(coalesce(_t, '')) BETWEEN 40 AND 600
     AND _t !~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/)|r\$)'
     AND replace(_t, coalesce(_org, ''), '') !~ '[[:digit:]０-９]'
     AND right(btrim(replace(replace(_t, ' (Se não quiser mais mensagens, responda SAIR.)', ''), ' Se preferir que eu não escreva mais, é só me avisar.', '')), 1) = '?'
$function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_freio(_org uuid, _chip text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _tot integer; _fal integer; _env integer; _opt integer;
BEGIN
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE e.status = 'falhou') INTO _tot, _fal FROM public.lead_aquecer_envios e
   WHERE e.created_at > now() - interval '24 hours' AND e.status <> 'enviando'
     AND (CASE WHEN _chip IS NOT NULL THEN e.modo_real AND e.chip_numero = _chip ELSE e.organization_id = _org END);
  IF _tot >= _c.aquecer_freio_min AND _fal::numeric / _tot >= _c.aquecer_freio_taxa THEN
    IF _chip IS NOT NULL THEN
      PERFORM public.lead_aquecer_pausar_chip(_chip, 'taxa de falha de envio alta',
        jsonb_build_object('tentativas_24h', _tot, 'falhas_24h', _fal, 'limite', _c.aquecer_freio_taxa));
    ELSE
      PERFORM public.lead_aquecer_pausar_interno(_org, 'taxa de falha de envio alta',
        jsonb_build_object('tentativas_24h', _tot, 'falhas_24h', _fal, 'limite', _c.aquecer_freio_taxa));
    END IF;
    RETURN 'taxa_falha';
  END IF;
  SELECT count(*) FILTER (WHERE a.enviado_em IS NOT NULL), count(*) FILTER (WHERE a.estado = 'optout')
    INTO _env, _opt FROM public.lead_aquecer a
   WHERE a.organization_id = _org AND a.created_at > now() - interval '7 days'
     AND (_chip IS NULL OR a.chip_numero = _chip);
  -- t_5fcada08: com aquecer_sair_taxa/_min preenchidos, pausa quando os SAIR PASSAM da taxa (>), com amostra mínima própria.
  IF (_c.aquecer_sair_taxa IS NOT NULL AND _env >= coalesce(_c.aquecer_sair_min, _c.aquecer_freio_min)
      AND _opt::numeric / _env > _c.aquecer_sair_taxa)
     OR (_c.aquecer_sair_taxa IS NULL AND _env >= _c.aquecer_freio_min AND _opt::numeric / _env >= _c.aquecer_freio_taxa) THEN
    IF _chip IS NOT NULL THEN
      PERFORM public.lead_aquecer_pausar_chip(_chip, 'muitos pedidos para sair',
        jsonb_build_object('enviados_7d', _env, 'optouts_7d', _opt, 'limite', coalesce(_c.aquecer_sair_taxa, _c.aquecer_freio_taxa)));
    ELSE
      PERFORM public.lead_aquecer_pausar_interno(_org, 'muitos pedidos para sair',
        jsonb_build_object('enviados_7d', _env, 'optouts_7d', _opt, 'limite', coalesce(_c.aquecer_sair_taxa, _c.aquecer_freio_taxa)));
    END IF;
    RETURN 'optouts';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_do_lead(_lead uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT CASE WHEN a.estado = 'retomado' AND a.retomado_em > now() - interval '30 days'
                               THEN CASE WHEN a.modo_real THEN 'aquecer' ELSE 'aquecer_teste' END
                               -- t_5fcada08: resposta única ao SAIR/"não" ainda por sair: pelo chip do aquecimento.
                               WHEN a.saida_msg_id IS NOT NULL AND a.modo_real AND EXISTS (SELECT 1 FROM public.lead_mensagens m
                                      WHERE m.id = a.saida_msg_id AND m.status IN ('pendente', 'enviando')) THEN 'aquecer' END
                     FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
                    WHERE a.lead_id = _lead AND a.enviado_em IS NOT NULL
                    ORDER BY a.created_at DESC LIMIT 1), 'atendimento')
$function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_pendentes(_chip text)
 RETURNS TABLE(lead_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT DISTINCT ON (a.lead_id) a.lead_id
    FROM public.lead_aquecer a
    JOIN public.lead_config c ON c.organization_id = a.organization_id
    JOIN public.lead_aquecer_chips k ON k.numero = a.chip_numero AND k.organization_id = a.organization_id
    JOIN public.lead_conversas cv ON cv.id = a.conversa_id
   WHERE _chip IS NOT NULL AND a.modo_real AND a.chip_numero = _chip
     AND ((a.estado = 'retomado' AND c.aquecer_pausado_em IS NULL AND k.pausado_em IS NULL)
          -- t_5fcada08: resposta única da saída (vale com o chip pausado pelo freio: é resposta a quem escreveu).
          OR (a.saida_msg_id IS NOT NULL AND c.aquecer_ativo
              AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.id = a.saida_msg_id AND m.status = 'pendente')))
     AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'enviando')
   ORDER BY a.lead_id
   LIMIT 5
$function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_envio_reservar(_lead uuid, _chip text)
 RETURNS TABLE(msg_id uuid, telefone text, texto text, primeira boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _a public.lead_aquecer; _m public.lead_mensagens;
BEGIN
  IF _chip IS NULL OR _chip !~ '^[0-9]{10,11}$' THEN RETURN; END IF;
  IF public.lead_aquecer_chip_do_lead(_lead) <> 'aquecer' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead FOR UPDATE;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = _lead AND organization_id = _l.organization_id
   ORDER BY created_at DESC LIMIT 1;
  IF _l.id IS NULL OR _cv.id IS NULL OR _c.organization_id IS NULL OR _a.id IS NULL THEN RETURN; END IF;
  -- t_5fcada08: a resposta única ao SAIR/"não" sai mesmo com o opt-out (é a confirmação) e com o chip pausado pelo freio;
  -- só ESSA mensagem, uma vez, pelo MESMO chip. Desligar o aquecimento (aquecer_ativo/ia_ativa) segura tudo.
  IF _a.saida_msg_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lead_mensagens m0 WHERE m0.id = _a.saida_msg_id AND m0.status = 'pendente') THEN
    IF _l.simulado OR _l.telefone IS NULL OR _cv.canal <> 'ziontalk' OR _cv.id <> _a.conversa_id OR NOT _a.modo_real
       OR NOT _c.ia_ativa OR NOT _c.aquecer_ativo OR _a.chip_numero IS DISTINCT FROM _chip
       OR NOT EXISTS (SELECT 1 FROM public.lead_aquecer_chips k WHERE k.numero = _chip AND k.organization_id = _l.organization_id)
       OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                       AND module = 'leads' AND enabled) THEN
      RETURN;
    END IF;
    SELECT * INTO _m FROM public.lead_mensagens WHERE id = _a.saida_msg_id AND conversa_id = _cv.id AND status = 'pendente'
     FOR UPDATE SKIP LOCKED;
    IF _m.id IS NULL THEN RETURN; END IF;
    UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
    msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := false;
    RETURN NEXT;
    RETURN;
  END IF;
  IF _l.simulado OR _l.telefone IS NULL OR _cv.canal <> 'ziontalk' OR _cv.id <> _a.conversa_id
     OR NOT _c.ia_ativa OR NOT _c.aquecer_ativo OR _c.aquecer_pausado_em IS NOT NULL
     OR _a.chip_numero IS DISTINCT FROM _chip
     OR NOT EXISTS (SELECT 1 FROM public.lead_aquecer_chips k WHERE k.numero = _chip
                     AND k.organization_id = _l.organization_id AND k.pausado_em IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                     AND module = 'leads' AND enabled)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _l.organization_id
                 AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    RETURN;
  END IF;
  SELECT * INTO _m FROM public.lead_mensagens WHERE conversa_id = _cv.id AND status = 'pendente'
   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _m.id IS NULL THEN RETURN; END IF;
  UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
  msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := false;
  RETURN NEXT;
END $function$;

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
       -- t_5fcada08: lead da reativação (sem responsável, sem prazo) fica com a assistente até mostrar interesse.
       AND NOT (l.responsavel_id IS NULL AND l.sem_prazo)
       AND (l.responsavel_id IS NULL
         OR NOT public.lead_pode_ser_responsavel(l.responsavel_id, l.organization_id)
         OR (NOT l.sem_prazo AND l.aceito_em IS NULL
             AND coalesce(l.atribuido_em, l.created_at) + make_interval(mins => c.prazo_aceite_min) <= now())
         OR (NOT l.sem_prazo AND l.aceito_em IS NOT NULL AND l.ultima_interacao_em IS NULL
             AND l.aceito_em + make_interval(days => c.prazo_primeira_interacao_dias) <= now())
         OR (NOT l.sem_prazo AND l.ultima_interacao_em IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar_chips(_chips text[] DEFAULT NULL::text[], _agora timestamp with time zone DEFAULT now())
 RETURNS TABLE(envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean, chip_numero text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _c public.lead_config; _a public.lead_aquecer; _l public.leads; _cv public.lead_conversas;
  _txt text; _org text; _ia text; _frase text; _env uuid; _n integer := 0; _k record; _ks text[]; _chip text;
  _real boolean; _tem_chip boolean; _hoje date := (_agora AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _chips IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(_chips) x WHERE x IS NULL OR x !~ '^[0-9]{10,11}$') THEN
    RAISE EXCEPTION 'Chip invalido' USING ERRCODE = '22023';
  END IF;
  FOR _c IN
    SELECT c.* FROM public.lead_config c
      JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
     WHERE c.aquecer_ativo AND c.aquecer_pausado_em IS NULL AND c.ia_ativa
       AND public.lead_aquecer_horario(c.ia_domingo, _agora)
     ORDER BY c.aquecer_proximo_em NULLS FIRST
     LIMIT 10
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    EXIT WHEN _n >= 10;
    _tem_chip := EXISTS (SELECT 1 FROM public.lead_aquecer_chips k WHERE k.organization_id = _c.organization_id);
    -- Imobiliária com chip cadastrado e envio real desligado no servidor: nada (simulação gastaria o contato por 7 dias).
    CONTINUE WHEN _tem_chip AND _chips IS NULL;
    -- Limpeza da imobiliária (igual à versão anterior).
    UPDATE public.lead_aquecer a SET estado = 'optout', finalizado_em = now(), updated_at = now()
      FROM public.leads l
     WHERE a.organization_id = _c.organization_id AND a.estado IN ('enviado', 'lembrete') AND l.id = a.lead_id
       AND EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = a.organization_id
                    AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)));
    WITH f AS (
      UPDATE public.lead_aquecer a SET estado = 'frio', finalizado_em = now(), updated_at = now()
       WHERE a.organization_id = _c.organization_id
         AND ((a.estado = 'lembrete' AND a.lembrete_em <= now() - make_interval(days => _c.aquecer_lembrete_dias))
           OR (a.estado = 'enviado' AND a.enviado_em <= now() - make_interval(days => 2 * _c.aquecer_lembrete_dias)))
      RETURNING a.organization_id, a.lead_id, a.modo_real)
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    SELECT f.organization_id, f.lead_id, 'ia', 'aquecer_frio',
           'Aquecimento: o cliente não respondeu à mensagem nem ao lembrete. Marcado como frio.'
           || CASE WHEN f.modo_real THEN '' ELSE ' (modo teste)' END
      FROM f;
    _org := public.lead_ia_org_nome(_c.organization_id);
    _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'Victoria');
    IF _tem_chip THEN
      -- Chips livres da imobiliária, o menos usado hoje primeiro (divide os envios).
      SELECT array_agg(k.numero ORDER BY (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real
                AND e.chip_numero = k.numero AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje), random())
        INTO _ks
        FROM public.lead_aquecer_chips k
       WHERE k.organization_id = _c.organization_id AND k.numero = ANY (_chips) AND k.pausado_em IS NULL
         AND (k.proximo_em IS NULL OR k.proximo_em <= now())
         AND NOT EXISTS (SELECT 1 FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                          AND e.created_at > now() - make_interval(secs => _c.aquecer_intervalo_min_s))
         AND (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje)
             < least(_c.aquecer_limite_dia, _c.aquecer_rampa_inicio + _c.aquecer_rampa_passo
                      * greatest(0, _hoje - coalesce(k.rampa_desde, _hoje)));
      _real := true;
    ELSE
      CONTINUE WHEN _c.aquecer_proximo_em IS NOT NULL AND _c.aquecer_proximo_em > now();
      CONTINUE WHEN public.lead_aquecer_enviados_hoje(_c.organization_id, NULL, _agora) >= public.lead_aquecer_limite_hoje(_c, _agora);
      _ks := ARRAY[NULL::text];
      _real := false;
    END IF;
    CONTINUE WHEN _ks IS NULL;
    FOREACH _chip IN ARRAY _ks LOOP
      _a := NULL; _txt := NULL; _l := NULL; _env := NULL;
      -- a) Lembrete (1 só), pelo MESMO chip da 1ª mensagem.
      SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
       WHERE a.organization_id = _c.organization_id AND a.estado = 'enviado' AND a.respondeu_em IS NULL
         AND a.modo_real = _real AND a.chip_numero IS NOT DISTINCT FROM _chip
         AND a.enviado_em <= now() - make_interval(days => _c.aquecer_lembrete_dias)
         AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.sale_id IS NULL
         AND (public.lead_aquecer_na_lista(_c, l.telefone) OR (_c.aquecer_reativacao AND public.lead_aquecer_reativacao_lead(l)))
         AND (l.proximo_contato_em IS NULL OR l.proximo_contato_em <= now())
         AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = l.organization_id
                          AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
         AND NOT EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = l.id AND e.autor_id IS NOT NULL
                          AND e.created_at > a.enviado_em)
       ORDER BY a.enviado_em
       LIMIT 1
       FOR UPDATE OF a SKIP LOCKED;
      IF _a.id IS NOT NULL THEN
        SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
        _txt := public.lead_aquecer_texto(CASE WHEN _c.aquecer_reativacao THEN 'lembrete_reativacao' ELSE 'lembrete' END,
                 public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text || ':l');
        INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
        VALUES (_c.organization_id, _a.id, 'lembrete', _txt, _real, _chip) RETURNING id INTO _env;
        UPDATE public.lead_aquecer SET estado = 'lembrete', lembrete_em = now(), updated_at = now() WHERE id = _a.id;
      ELSE
        SELECT l.* INTO _l FROM public.leads l
         WHERE l.organization_id = _c.organization_id AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
           AND l.funil = 'venda' AND l.telefone IS NOT NULL
           -- t_5fcada08: no modo reativação, SÓ os leads da importação (nunca os leads dos corretores) e sem a lista de 20.
           AND CASE WHEN _c.aquecer_reativacao THEN public.lead_aquecer_reativacao_lead(l) AND l.responsavel_id IS NULL
                      -- mesmo telefone com outro lead aberto na imobiliária (ex.: voltou pela C2S com corretor): não escreve.
                      AND NOT EXISTS (SELECT 1 FROM public.leads l3 WHERE l3.organization_id = l.organization_id AND l3.id <> l.id
                                       AND l3.etapa NOT IN ('ganho', 'perdido') AND l3.telefone IS NOT NULL
                                       AND public.lead_ia_contatos(l3.telefone, NULL) && public.lead_ia_contatos(l.telefone, NULL))
                      -- SAIR ou aquecimento em QUALQUER imobiliária (piloto, ZZ): nunca escreve de novo.
                      AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.contato = ANY (public.lead_ia_contatos(l.telefone, NULL)))
                      AND NOT EXISTS (SELECT 1 FROM public.lead_aquecer a4 JOIN public.leads l4 ON l4.id = a4.lead_id
                                       WHERE a4.organization_id <> l.organization_id
                                         AND public.lead_ia_contatos(l4.telefone, NULL) && public.lead_ia_contatos(l.telefone, NULL))
                    ELSE public.lead_aquecer_na_lista(_c, l.telefone) END
           AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
           AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
           AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
           AND (_real OR NOT EXISTS (SELECT 1 FROM public.lead_conversas cv0 WHERE cv0.lead_id = l.id AND cv0.estado = 'ativa'))
         ORDER BY public.lead_aquecer_ultima_interacao(l) DESC, l.id
         LIMIT 1
         FOR UPDATE OF l SKIP LOCKED;
        CONTINUE WHEN _l.id IS NULL;
        _frase := public.lead_aquecer_frase(_l);
        _txt := public.lead_aquecer_texto(CASE WHEN _c.aquecer_reativacao THEN 'primeira_reativacao' ELSE 'primeira' END,
                 public.lead_aquecer_nome(_l.nome), _frase, _ia, _org, _l.id::text);
        IF NOT public.lead_aquecer_texto_ok(_txt, _org) THEN
          _txt := public.lead_aquecer_texto(CASE WHEN _c.aquecer_reativacao THEN 'primeira_reativacao' ELSE 'primeira' END,
                   public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text);
        END IF;
        CONTINUE WHEN NOT public.lead_aquecer_texto_ok(_txt, _org);
        SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _l.id FOR UPDATE;
        IF _cv.id IS NULL THEN
          INSERT INTO public.lead_conversas (organization_id, lead_id, canal, estado, passo, encerrada_em, resumo)
          VALUES (_l.organization_id, _l.id, CASE WHEN _real THEN 'ziontalk' ELSE 'teste' END, 'parada', 'fim', now(),
                  'Conversa aberta pelo aquecimento de lead parado.')
          RETURNING * INTO _cv;
        ELSIF _cv.estado = 'ativa' THEN
          UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now(),
                 resumo = left(coalesce(resumo || ' ', '') || 'IA pausada: aquecimento de lead parado.', 1000)
           WHERE id = _cv.id;
        END IF;
        INSERT INTO public.lead_aquecer (organization_id, lead_id, conversa_id, estado, modo_real, chip_numero)
        VALUES (_l.organization_id, _l.id, _cv.id, 'enviando', _real, _chip) RETURNING * INTO _a;
        INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
        VALUES (_c.organization_id, _a.id, 'primeira', _txt, _real, _chip) RETURNING id INTO _env;
      END IF;
      IF _real THEN
        UPDATE public.lead_aquecer_chips
           SET proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                              + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
               rampa_desde = coalesce(rampa_desde, _hoje), updated_at = now()
         WHERE numero = _chip;
      END IF;
      UPDATE public.lead_config
         SET aquecer_proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                                   + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
             aquecer_rampa_desde = coalesce(aquecer_rampa_desde, _hoje)
       WHERE organization_id = _c.organization_id;
      envio_id := _env; lead_id := _l.id; telefone := _l.telefone; texto := _txt; modo_real := _real; chip_numero := _chip;
      _n := _n + 1;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_previa()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _ia text; _o text; _r boolean;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  _ia := coalesce((SELECT nullif(btrim(ia_nome), '') FROM public.lead_config WHERE organization_id = _org), 'Victoria');
  _o := public.lead_ia_org_nome(_org);
  _r := coalesce((SELECT aquecer_reativacao FROM public.lead_config WHERE organization_id = _org), false);
  IF _r THEN
    RETURN jsonb_build_array(
      public.lead_aquecer_texto('primeira_reativacao', 'Maria', 'o apartamento do bairro Centro', _ia, _o, 'exemplo-1'),
      public.lead_aquecer_texto('primeira_reativacao', 'João', 'a casa do bairro Jardim Europa', _ia, _o, 'exemplo-2'),
      public.lead_aquecer_texto('primeira_reativacao', '', NULL, _ia, _o, 'exemplo-3'),
      public.lead_aquecer_texto('lembrete_reativacao', 'Maria', NULL, _ia, _o, 'exemplo-1'));
  END IF;
  RETURN jsonb_build_array(
    public.lead_aquecer_texto('primeira', 'Maria', 'o apartamento do bairro Centro', _ia, _o, 'exemplo-1'),
    public.lead_aquecer_texto('primeira', 'João', 'a casa do bairro Jardim Europa', _ia, _o, 'exemplo-22'),
    public.lead_aquecer_texto('primeira', '', NULL, _ia, _o, 'exemplo-3'),
    public.lead_aquecer_texto('lembrete', 'Maria', NULL, _ia, _o, 'exemplo-1'));
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _c public.lead_config; _eleg integer; _chips jsonb;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    SELECT * INTO _c FROM jsonb_populate_record(NULL::public.lead_config, jsonb_build_object('organization_id', _org));
    _c.aquecer_ativo := false; _c.aquecer_dias := 30; _c.aquecer_limite_dia := 15; _c.aquecer_rampa_inicio := 5;
    _c.aquecer_rampa_passo := 2; _c.aquecer_lembrete_dias := 3; _c.ia_nome := 'Victoria'; _c.ia_ativa := false;
  END IF;
  SELECT count(*) INTO _eleg FROM (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = _org AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.funil = 'venda'
       AND l.telefone IS NOT NULL AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
       AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
       AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
     LIMIT 500) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id,
           'chip', '(' || left(k.numero, 2) || ') ****-' || right(k.numero, 4),
           'pausado_em', k.pausado_em, 'pausa_motivo', k.pausa_motivo, 'retorno_em', k.retorno_token_em,
           'enviados_hoje', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                              AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje),
           'limite_hoje', least(_c.aquecer_limite_dia, _c.aquecer_rampa_inicio + _c.aquecer_rampa_passo
                                 * greatest(0, _hoje - coalesce(k.rampa_desde, _hoje))),
           'ultimo_envio', (SELECT max(e.created_at) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero))
           ORDER BY k.created_at), '[]'::jsonb)
    INTO _chips FROM public.lead_aquecer_chips k WHERE k.organization_id = _org;
  RETURN jsonb_build_object(
    'ativo', _c.aquecer_ativo, 'dias', _c.aquecer_dias, 'limite_dia', _c.aquecer_limite_dia,
    'rampa_inicio', _c.aquecer_rampa_inicio, 'rampa_passo', _c.aquecer_rampa_passo, 'lembrete_dias', _c.aquecer_lembrete_dias,
    'pausado_em', _c.aquecer_pausado_em, 'pausa_motivo', _c.aquecer_pausa_motivo,
    'limite_hoje', public.lead_aquecer_limite_hoje(_c, now()),
    'enviados_hoje', public.lead_aquecer_enviados_hoje(_org, NULL, now()),
    'chip', CASE WHEN _c.aquecer_chip_numero IS NULL THEN NULL
                 ELSE '(' || left(_c.aquecer_chip_numero, 2) || ') ****-' || right(_c.aquecer_chip_numero, 4) END,
    'retorno_em', _c.aquecer_retorno_token_em, 'ia_ativa', coalesce(_c.ia_ativa, false), 'ia_nome', coalesce(_c.ia_nome, 'Victoria'),
    'elegiveis', _eleg, 'chips', _chips);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l leads, _c lead_config, _org_nome text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t text; _nome text; _imovel text; _x public.remax_xml_listings; _link text;
  -- Filtro genérico de link (revisão t_e520a9bb): qualquer "palavra.palavra" (.xyz, .co, t.co), http(s): ou @.
  _re text := '(h[t]tps?:|www\.|[a-z0-9-]\.[a-z]{2,}|@)'; _assist text; _imob text;
BEGIN
  _t := coalesce(nullif(btrim(_c.ia_primeira_msg), ''),
    'Oi, {nome}! Aqui é a {assistente}, da {imobiliaria}. Vi seu interesse {imovel}. {link}Quer saber mais detalhes ou já prefere agendar uma visita?');
  -- Lead sem nome (ex.: "Lead Grupo ZAP") ou nome com cara de link: "Oi!" em vez de "Oi, !".
  _nome := CASE WHEN btrim(_l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE split_part(btrim(_l.nome), ' ', 1) END;
  IF _nome ~* _re OR char_length(_nome) > 40 THEN _nome := ''; END IF;
  IF _nome = '' THEN _t := regexp_replace(_t, ',?\s*\{nome\}', '', 'g'); END IF;
  -- Imóvel: XML da PRÓPRIA imobiliária pelo código do anúncio (última coleta boa); sem ele, a captação.
  IF nullif(btrim(_l.anuncio_codigo), '') IS NOT NULL THEN
    SELECT x.* INTO _x FROM public.remax_xml_listings x
     WHERE x.organization_id = _l.organization_id
       AND x.code_key = public.portal_code_key(btrim(_l.anuncio_codigo))
       AND x.last_run = (public.remax_xml_last_ok(_l.organization_id)).id
     LIMIT 1;
  END IF;
  IF _x.code IS NOT NULL THEN
    _imovel := public.lead_ia_xml_frase_msg(_x, _l.portal_transacao);
    IF public.xml_url_anuncio_ok(_x.url) THEN _link := _x.url; END IF;
  END IF;
  -- Texto vindo do XML com cara de link nunca entra (o único link possível é o do anúncio, validado acima).
  IF _imovel ~* _re THEN _imovel := NULL; END IF;
  IF _imovel IS NULL AND _l.capture_id IS NOT NULL THEN
    _imovel := public.lead_ia_imovel_frase(_l.capture_id, _l.organization_id, 'em');
  END IF;
  _t := replace(_t, '{nome}', _nome);
  -- Nome da IA e da imobiliária também nunca levam link (o único link possível é o do anúncio).
  _assist := btrim(_c.ia_nome);
  IF coalesce(_assist, '') = '' OR _assist ~* _re THEN _assist := 'Victoria'; END IF;
  _imob := btrim(_org_nome);
  IF coalesce(_imob, '') = '' OR _imob ~* _re THEN _imob := 'imobiliária'; END IF;
  _t := replace(_t, '{assistente}', _assist);
  _t := replace(_t, '{imobiliaria}', _imob);
  _t := replace(_t, '{imovel}', coalesce(_imovel, 'no imóvel que você viu'));
  _t := replace(_t, '{link}', CASE WHEN _link IS NOT NULL THEN 'Anúncio: ' || _link || ' ' ELSE '' END);
  RETURN left(btrim(regexp_replace(_t, '\s+', ' ', 'g')), 2000);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _k public.lead_aquecer_chips; _num text; _ok boolean; _id text; _chave text; _tipo text; _texto text; _ev bigint;
  _a public.lead_aquecer; _cv public.lead_conversas; _cls text; _ctx jsonb; _n integer;
  _l public.leads; _conv boolean; _st text; _mid uuid; _txt text; _ia text; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _k FROM public.lead_aquecer_chips WHERE retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _k.id IS NOT NULL THEN
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = _k.organization_id FOR UPDATE;
    _num := _k.numero;
  ELSE
    -- Link antigo da imobiliária (sem chip cadastrado na tabela nova: modo teste).
    SELECT * INTO _c FROM public.lead_config
     WHERE aquecer_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') FOR UPDATE;
    _num := _c.aquecer_chip_numero;
  END IF;
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (m.enabled AND o.status = 'ativa') INTO _ok FROM public.organization_modules m
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.organization_id = _c.organization_id AND m.module = 'leads';
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa THEN RETURN jsonb_build_object('r', 'desligada'); END IF;
  IF _msg IS NULL OR jsonb_typeof(_msg) <> 'object' THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  IF coalesce(_msg->>'grupo', '') = 'true' OR coalesce(_msg->>'status', '') = 'true' OR coalesce(_msg->>'proprio', '') = 'true' THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _id := btrim(coalesce(_msg->>'id', ''));
  IF char_length(_id) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
  IF _chave IS NULL OR _chave !~ '^[0-9]{10,11}$' OR _chave = _c.ia_canal_numero OR _chave = _c.aquecer_chip_numero
     OR EXISTS (SELECT 1 FROM public.lead_aquecer_chips k2 WHERE k2.numero = _chave) THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;
  -- Dedup: o chip 1 mantém a chave antiga (ids já registrados continuam valendo); os demais usam o número do chip.
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':aquecer:'
            || CASE WHEN _num IS NULL OR _num = _c.aquecer_chip_numero THEN '' ELSE _num || ':' END || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;
  SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
   WHERE a.organization_id = _c.organization_id AND NOT l.simulado AND a.enviado_em IS NOT NULL
     AND (NOT a.modo_real OR a.chip_numero = _num)
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
     AND (a.estado IN ('enviado', 'lembrete', 'retomado')
          OR (a.estado IN ('nao', 'frio') AND a.finalizado_em > now() - interval '30 days')
          -- t_5fcada08: quem recebeu o convite do treinamento pode responder com uma indicação (30 dias).
          OR (_c.aquecer_reativacao AND a.estado = 'optout' AND a.convite_em > now() - interval '30 days'))
   ORDER BY a.created_at DESC LIMIT 1
   FOR UPDATE OF a;
  IF _a.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;
  PERFORM 1 FROM public.leads WHERE id = _a.lead_id FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _a.conversa_id FOR UPDATE;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;
  _texto := CASE WHEN _tipo = 'midia' AND _texto = '' THEN '[áudio ou arquivo recebido]' ELSE _texto END;
  _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'Victoria');
  -- t_5fcada08: resposta ao convite do treinamento (depois do SAIR ou do "não"). A assistente NÃO responde e NÃO chama
  -- o indicado: só registra e leva o lead ao responsável padrão com o rótulo. SAIR aqui = saída sem repetir o convite.
  -- Exceção: quem disse "não" e agora diz que ainda procura imóvel (sem falar de indicação) segue o fluxo normal (retoma).
  IF _c.aquecer_reativacao AND _a.convite_em IS NOT NULL AND _a.estado IN ('nao', 'optout')
     AND NOT (_a.estado = 'nao' AND _tipo = 'texto' AND public.lead_aquecer_resposta_tipo(_texto) = 'sim'
              AND public.lead_ia_norm(_texto) !~ '(conhec|indic|trein|trabalh|curso|vaga|amig|parent|filh|irm|prim[oa]|sobrinh|espos|marid|namorad|vizinh|colega)') THEN
    SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
    _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
    IF _tipo = 'texto' AND public.lead_ia_e_optout(_texto) THEN
      IF _a.estado = 'nao' THEN
        _txt := public.lead_aquecer_saida_texto('optout', NULL, false, public.lead_ia_org_nome(_c.organization_id));
        INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
        VALUES (_a.organization_id, _cv.id, 'sistema', _txt,
                CASE WHEN _a.modo_real AND _c.aquecer_ativo THEN 'pendente' ELSE 'nao_enviada' END) RETURNING id INTO _mid;
        UPDATE public.lead_aquecer SET estado = 'optout', saida_msg_id = _mid, finalizado_em = now(), updated_at = now() WHERE id = _a.id;
        INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
        VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_optout', 'Aquecimento: o cliente pediu para não receber mais mensagens (SAIR). Confirmação enviada, sem repetir o convite.');
        PERFORM public.lead_aquecer_freio(_c.organization_id, CASE WHEN _a.modo_real THEN _a.chip_numero END);
      END IF;
    ELSIF _a.indicacao_em IS NULL AND (_tipo = 'midia' OR public.lead_aquecer_indicacao(_texto)) THEN
      UPDATE public.lead_aquecer SET indicacao_em = now(), updated_at = now() WHERE id = _a.id;
      IF (_l.responsavel_id IS NULL OR _l.responsavel_id = _c.ia_corretor_passagem_id)
         AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _c.organization_id) THEN
        UPDATE public.leads SET responsavel_id = _c.ia_corretor_passagem_id, atribuido_em = coalesce(atribuido_em, now()),
               aceito_em = coalesce(aceito_em, now()), sem_prazo = true, no_banco_desde = NULL,
               tentativas_aceite = greatest(tentativas_aceite, 1),
               proximo_contato_em = _hoje, proximo_contato_motivo = 'Indicação treinamento/recrutamento', updated_at = now()
         WHERE id = _l.id;
      ELSE
        UPDATE public.leads SET proximo_contato_em = _hoje, proximo_contato_motivo = 'Indicação treinamento/recrutamento', updated_at = now()
         WHERE id = _l.id;
      END IF;
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (_a.organization_id, _a.lead_id, 'ia', 'indicacao_treinamento',
              left('Indicação treinamento/recrutamento (a ' || _ia || ' não chamou o indicado). O cliente respondeu: ' || _texto, 2000));
      PERFORM public.lead_notificar(coalesce(CASE WHEN _l.responsavel_id IS NULL OR _l.responsavel_id = _c.ia_corretor_passagem_id
                                                  THEN _c.ia_corretor_passagem_id END, _l.responsavel_id),
        _c.organization_id, 'Indicação treinamento/recrutamento',
        left('Lead "' || coalesce(_l.nome, '') || '" respondeu ao convite do treinamento. Veja em Meus leads.', 500));
    END IF;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  IF _a.estado <> 'retomado' THEN
    _cls := CASE WHEN _tipo = 'midia' THEN 'outro' ELSE public.lead_aquecer_resposta_tipo(_texto) END;
    IF _cls IN ('optout', 'nao') THEN
      IF _cv.estado = 'ativa' THEN
        UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now() WHERE id = _cv.id;
      END IF;
      _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
      UPDATE public.lead_aquecer SET estado = _cls, motivo = CASE WHEN _cls = 'nao' THEN public.lead_aquecer_motivo_nao(_texto) END,
             respondeu_em = coalesce(respondeu_em, now()), finalizado_em = now(), updated_at = now()
       WHERE id = _a.id;
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_' || _cls,
              CASE WHEN _cls = 'optout' THEN 'Aquecimento: o cliente pediu para não receber mais mensagens (SAIR).'
                   ELSE 'Aquecimento: o cliente respondeu que não procura mais imóvel ('
                        || replace(public.lead_aquecer_motivo_nao(_texto), '_', ' ') || '). Encerrado.' END);
      UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
      -- t_5fcada08: UMA resposta (confirmação do SAIR / agradecimento do "não") com o convite do treinamento, no máximo
      -- 1 convite por telefone. Não conta no limite diário (não é lead_aquecer_envios) e sai pelo MESMO chip.
      IF _c.aquecer_reativacao AND (_cls = 'optout' OR _a.estado IS DISTINCT FROM 'nao') THEN
        SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
        _conv := NOT public.lead_aquecer_convite_usado(_l.telefone);
        _txt := public.lead_aquecer_saida_texto(_cls, public.lead_aquecer_motivo_nao(_texto), _conv, public.lead_ia_org_nome(_c.organization_id));
        IF _txt IS NOT NULL THEN
          INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
          VALUES (_a.organization_id, _cv.id, 'sistema', _txt,
                  CASE WHEN _a.modo_real AND _c.aquecer_ativo THEN 'pendente' ELSE 'nao_enviada' END) RETURNING id INTO _mid;
          UPDATE public.lead_aquecer SET saida_msg_id = _mid, convite_em = CASE WHEN _conv THEN now() END, updated_at = now()
           WHERE id = _a.id;
        END IF;
      END IF;
      IF _cls = 'optout' THEN
        PERFORM public.lead_aquecer_freio(_c.organization_id, CASE WHEN _a.modo_real THEN _a.chip_numero END);
      END IF;
      RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
    END IF;
    UPDATE public.lead_conversas
       SET estado = 'ativa', passo = 'interesse', motivo_fim = NULL, encerrada_em = NULL,
           canal = CASE WHEN _a.modo_real THEN 'ziontalk' ELSE canal END,
           primeira_enviada_em = coalesce(primeira_enviada_em, _a.enviado_em, now()),
           dados = dados || jsonb_build_object('aquecer', true), updated_at = now()
     WHERE id = _cv.id;
    UPDATE public.lead_aquecer SET estado = 'retomado', motivo = NULL, respondeu_em = coalesce(respondeu_em, now()),
           retomado_em = now(), finalizado_em = NULL, updated_at = now()
     WHERE id = _a.id;
    -- t_5fcada08: interesse em imóvel no modo reativação: o lead vai já para o responsável padrão (aceito, sem prazo de
    -- aceite, nunca para o banco), com o resumo; sem WhatsApp a corretor (c2s_aviso_whats/ia_aviso_corretor_whats).
    IF _c.aquecer_reativacao THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      IF _l.responsavel_id IS NULL AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _c.organization_id) THEN
        UPDATE public.leads SET responsavel_id = _c.ia_corretor_passagem_id, atribuido_em = now(), aceito_em = now(),
               sem_prazo = true, no_banco_desde = NULL, tentativas_aceite = tentativas_aceite + 1, updated_at = now()
         WHERE id = _l.id;
        INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
        VALUES (_a.organization_id, _l.id, 'atribuido', _c.ia_corretor_passagem_id::text,
                'Reativação C2S: o cliente respondeu com interesse; lead no painel do responsável padrão, sem prazo de aceite e sem aviso ao corretor.');
        INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
        VALUES (_a.organization_id, _l.id, 'nota', 'resumo_reativacao',
                left('Resumo da reativação: lead de venda arquivado na C2S' || coalesce(' (imóvel ' || nullif(btrim(_l.anuncio_codigo), '') || ')', '')
                     || '. A ' || _ia || ' perguntou em ' || to_char(_a.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM')
                     || ' se o cliente ainda procura imóvel. Resposta: "' || public.lead_ia_mascarar(_texto) || '". A ' || _ia
                     || ' continua a conversa por aqui; veja a conversa completa abaixo.', 2000));
        PERFORM public.lead_notificar(_c.ia_corretor_passagem_id, _c.organization_id, 'Lead reativado com interesse',
          left('Lead "' || coalesce(_l.nome, '') || '" respondeu à reativação com interesse. Já está em Meus leads, com o resumo.', 500));
      END IF;
    END IF;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_retomado',
            'Aquecimento: o cliente respondeu e voltou a procurar imóvel. A '
            || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ' retomou a conversa.');
  END IF;
  _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
  IF _ctx->>'estado' = 'optout' THEN
    UPDATE public.lead_aquecer SET estado = 'optout', finalizado_em = now(), updated_at = now() WHERE id = _a.id;
    IF _c.aquecer_reativacao THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      _conv := NOT public.lead_aquecer_convite_usado(_l.telefone);
      _txt := public.lead_aquecer_saida_texto('optout', NULL, _conv, public.lead_ia_org_nome(_c.organization_id));
      _st := CASE WHEN _a.modo_real AND _c.aquecer_ativo THEN 'pendente' ELSE 'nao_enviada' END;
      SELECT id INTO _mid FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'sistema' AND created_at = now()
         AND texto LIKE 'Pronto, você não vai mais receber mensagens nossas%' ORDER BY id LIMIT 1;
      IF _mid IS NOT NULL THEN
        UPDATE public.lead_mensagens SET texto = _txt, status = _st WHERE id = _mid;
      ELSE
        INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
        VALUES (_a.organization_id, _cv.id, 'sistema', _txt, _st) RETURNING id INTO _mid;
      END IF;
      UPDATE public.lead_aquecer SET saida_msg_id = _mid, convite_em = CASE WHEN _conv THEN now() END WHERE id = _a.id;
    END IF;
    PERFORM public.lead_aquecer_freio(_c.organization_id, CASE WHEN _a.modo_real THEN _a.chip_numero END);
  END IF;
  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  -- Aquecimento desligado, imobiliária pausada ou ESTE chip pausado: registra, mas a assistente não responde pelo chip.
  IF NOT _c.aquecer_ativo OR _c.aquecer_pausado_em IS NOT NULL OR _k.pausado_em IS NOT NULL THEN
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id, 'pausado', true);
  END IF;
  PERFORM public.lead_ia_encaminhar_cedo(_cv.id);
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'ia'
     AND created_at >= coalesce(_a.retomado_em, now());
  IF _n >= _c.ia_resp_max_conversa THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  IF (SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = _c.organization_id
        AND resultado = 'responder' AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id, 'limite', true);
  END IF;
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'responder' WHERE id = _ev;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _a.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $function$;

-- Nome mostrado ao lead: Victoria nas 3 imobiliárias que usam a assistente (Única, Piloto C2S, ZZ). Só o rótulo.
UPDATE public.lead_config SET ia_nome = 'Victoria', updated_at = now() WHERE ia_nome = 'Nicole';

COMMIT;

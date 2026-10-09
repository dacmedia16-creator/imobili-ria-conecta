-- "Ajuda e sugestões": acesso MÍNIMO e próprio para o MAX (agente) acompanhar e responder chamados.
-- Pedido de Denis em 09/10/2026 (tópico 6238). RASCUNHO: não aplicar em produção sem o ok dele.
--
--  Papel    max_suporte_bot: papel Postgres próprio, criado SEM LOGIN (desligado). Só vira credencial
--           quando Denis aprovar: scripts/max-suporte/ativar_credencial.py define a senha (verificador
--           SCRAM gerado localmente; a senha nunca passa por log, chat ou repositório) e grava o .env 600.
--           Não usa service_role, não usa a chave da IA, não é usuário do app (não tem JWT nem papel).
--  Schema   max_suporte (fora da API REST). O papel só tem USAGE nele e EXECUTE em 4 funções:
--             pendentes(_desde, _limite)    chamados abertos cuja última mensagem pública é do usuário
--                                           (é o que o verificador sem IA consulta a cada 15 min);
--             chamado(_ticket)              chamado aberto + conversa (inclui nota interna da equipe);
--             responder(_ticket, _texto, _status)   resposta pública assinada "— MAX", status
--                                           em_analise/respondido, aviso no sino do autor;
--             mudar_status(_ticket, _status) só em_analise/respondido.
--           Nada de apagar, editar mensagem, nota interna, 'resolvido', print, outras tabelas.
--  Freios   não responde chamado resolvido; não responde duas vezes seguidas (a última mensagem
--           pública precisa ser do usuário); no máximo 30 respostas por hora; texto 1–3.900.
--  Endurecimento: um papel com login pode forjar request.jwt.claim.sub e, com isso, auth.uid().
--           9 funções SECURITY DEFINER antigas ainda tinham EXECUTE para PUBLIC; aqui o EXECUTE passa a
--           ser só de anon/authenticated/service_role (que já o tinham explicitamente) — o app não muda.
--
-- Rollback: supabase/rollback/20261009030000_ajuda_acesso_max.sql
-- Desligar na hora, sem rollback: ALTER ROLE max_suporte_bot NOLOGIN;
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.support_tickets') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes 20261008220000_ajuda_sugestoes';
  END IF;
END $$;

-- Papel ----------------------------------------------------------------------------------------------
CREATE ROLE max_suporte_bot NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 3;
COMMENT ON ROLE max_suporte_bot IS
  'MAX (agente) no canal Ajuda e sugestões: só EXECUTE em max_suporte.* (20261009030000).';
ALTER ROLE max_suporte_bot SET search_path = '';
ALTER ROLE max_suporte_bot SET statement_timeout = '5s';
ALTER ROLE max_suporte_bot SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE max_suporte_bot SET lock_timeout = '2s';

-- Endurecimento: tira o PUBLIC (que inclui qualquer papel novo) das funções SECURITY DEFINER antigas.
-- Primeiro garante o EXECUTE explícito dos papéis do app; depois remove o PUBLIC.
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.archive_sale_document(uuid)',
    'public.change_sale_status(uuid,text,text)',
    'public.cliente_historico(uuid,uuid)',
    'public.criar_ocorrencia_lancamento(uuid)',
    'public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)',
    'public.list_active_corretores()',
    'public.list_active_gestores()',
    'public.list_active_team_leaders()',
    'public.list_active_users()'
  ] LOOP
    IF to_regprocedure(_f) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', _f);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _f);
    END IF;
  END LOOP;
END $$;

-- Schema --------------------------------------------------------------------------------------------
CREATE SCHEMA max_suporte;
COMMENT ON SCHEMA max_suporte IS 'Ajuda e sugestões: funções do MAX (agente). Fora da API REST (20261009030000).';
REVOKE ALL ON SCHEMA max_suporte FROM PUBLIC;
GRANT USAGE ON SCHEMA max_suporte TO max_suporte_bot;
-- Garante que funções futuras neste schema não nasçam executáveis por todos.
ALTER DEFAULT PRIVILEGES IN SCHEMA max_suporte REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- (a) Chamados que pedem atenção: abertos e com a última mensagem pública do usuário.
--     _desde (opcional): só os que receberam mensagem do usuário depois do marcador.
--     Saída estável (ordem por numero) para o verificador comparar sem IA.
CREATE FUNCTION max_suporte.pendentes(_desde timestamptz DEFAULT NULL, _limite integer DEFAULT 50)
 RETURNS TABLE (id uuid, numero bigint, tipo text, status text, ultima_msg_usuario_em timestamptz,
                created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT t.id, t.numero, t.tipo, t.status, u.created_at, t.created_at
  FROM public.support_tickets t
  CROSS JOIN LATERAL (
    SELECT m.autor_equipe, m.created_at FROM public.support_ticket_messages m
     WHERE m.ticket_id = t.id AND NOT m.interna
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) u
  WHERE t.status <> 'resolvido' AND NOT u.autor_equipe
    AND (_desde IS NULL OR u.created_at > _desde)
  ORDER BY t.numero
  LIMIT least(greatest(coalesce(_limite, 50), 1), 200)
$function$;

-- (b) Um chamado ABERTO e a conversa. Do autor só o primeiro nome; nada de e-mail, telefone, id.
--     A rota da tela vem junto; o print não (só "tem_print").
CREATE FUNCTION max_suporte.chamado(_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE; _r jsonb;
BEGIN
  SELECT * INTO _t FROM public.support_tickets WHERE support_tickets.id = _ticket;
  IF NOT FOUND OR _t.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado não encontrado ou já resolvido' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', _t.id, 'numero', _t.numero, 'tipo', _t.tipo, 'status', _t.status, 'assunto', _t.assunto,
    'tela_nome', _t.tela_nome, 'tela_rota', _t.tela_rota, 'navegador', _t.user_agent,
    'tem_print', _t.print_path IS NOT NULL, 'aberto_em', _t.created_at,
    'imobiliaria', (SELECT o.nome FROM public.organizations o WHERE o.id = _t.organization_id),
    'autor_primeiro_nome', (SELECT nullif(split_part(btrim(p.nome), ' ', 1), '')
                              FROM public.profiles p WHERE p.id = _t.author_id),
    'mensagens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'de', CASE WHEN m.autor_equipe AND m.author_id IS NULL THEN 'MAX'
                          WHEN m.autor_equipe THEN 'equipe' ELSE 'usuario' END,
               'interna', m.interna, 'texto', m.texto, 'em', m.created_at)
             ORDER BY m.created_at, m.id)
      FROM (SELECT * FROM public.support_ticket_messages
             WHERE ticket_id = _t.id ORDER BY created_at DESC, id DESC LIMIT 200) m), '[]'::jsonb))
  INTO _r;
  RETURN _r;
END $function$;

-- (c) Responder como MAX (resposta pública). Status: em_analise ou respondido. Avisa o autor no sino
--     (mesmo texto do servidor em src/lib/ajuda-sugestoes.ts). Devolve o status final.
CREATE FUNCTION max_suporte.responder(_ticket uuid, _texto text, _status text DEFAULT 'respondido')
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE; _txt text := btrim(coalesce(_texto, ''));
  _ultima_equipe boolean;
BEGIN
  IF _status NOT IN ('em_analise', 'respondido') THEN
    RAISE EXCEPTION 'O MAX só usa os status em_analise e respondido' USING ERRCODE = '42501';
  END IF;
  IF length(_txt) < 1 THEN RAISE EXCEPTION 'Escreva a mensagem'; END IF;
  IF length(_txt) > 3900 THEN RAISE EXCEPTION 'Texto muito longo (máximo 3.900 caracteres)'; END IF;
  IF _txt !~ '— MAX$' THEN _txt := _txt || E'\n\n— MAX'; END IF;

  SELECT * INTO _t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND OR _t.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado não encontrado ou já resolvido' USING ERRCODE = '42501';
  END IF;
  SELECT m.autor_equipe INTO _ultima_equipe FROM public.support_ticket_messages m
   WHERE m.ticket_id = _t.id AND NOT m.interna ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  IF coalesce(_ultima_equipe, false) THEN
    RAISE EXCEPTION 'A última mensagem já é da equipe: aguarde o usuário' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.support_ticket_messages
       WHERE autor_equipe AND author_id IS NULL AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Limite de 30 respostas do MAX por hora' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_t.id, _t.organization_id, NULL, true, false, _txt);
  UPDATE public.support_tickets SET status = _status, last_message_at = now(), resolved_at = NULL
   WHERE id = _t.id;
  INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem, support_ticket_id)
  VALUES (_t.author_id, _t.organization_id, 'suporte_resposta',
          'A equipe MAX respondeu o chamado #' || _t.numero, 'Abra o chamado para ver a resposta.', _t.id);
  RETURN _status;
END $function$;

-- (c) Mudar status sem mensagem (ex.: "em análise" ao encaminhar a Denis). Só em_analise/respondido.
CREATE FUNCTION max_suporte.mudar_status(_ticket uuid, _status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE;
BEGIN
  IF _status NOT IN ('em_analise', 'respondido') THEN
    RAISE EXCEPTION 'O MAX só usa os status em_analise e respondido' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND OR _t.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado não encontrado ou já resolvido' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_tickets SET status = _status WHERE id = _t.id;
  RETURN _status;
END $function$;

REVOKE ALL ON FUNCTION max_suporte.pendentes(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION max_suporte.chamado(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION max_suporte.responder(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION max_suporte.mudar_status(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION max_suporte.pendentes(timestamptz, integer) TO max_suporte_bot;
GRANT EXECUTE ON FUNCTION max_suporte.chamado(uuid) TO max_suporte_bot;
GRANT EXECUTE ON FUNCTION max_suporte.responder(uuid, text, text) TO max_suporte_bot;
GRANT EXECUTE ON FUNCTION max_suporte.mudar_status(uuid, text) TO max_suporte_bot;

COMMIT;

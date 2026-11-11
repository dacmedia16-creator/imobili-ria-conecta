-- Ajuda MAX na Locação — fatia 2/2 (t_365484dc; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
-- Ideia, erro (com print opcional) e dúvida que o assistente não soube responder viram CHAMADO (support_tickets) com
-- origem 'locacao', em vez de tabela nova. Tela "Sugestões e erros" lê por RPC própria:
--   - gestão/staff da imobiliária (admin, super_admin, staff = locacao_eh_gerencia): tudo da própria casa, inclusive o
--     print, e muda o status (novo = recebido / em análise / resolvido);
--   - usuário comum: só os próprios envios.
-- Tudo exige a chave 'ajuda_max_locacao' + Locação ligadas (ajuda_max_locacao_enabled). Nenhum aviso (sino, WhatsApp,
-- Telegram) nesta fase; o bot do MAX Suporte NÃO pega estes chamados (max_suporte.pendentes fila 'adm' = adm/estudo).
-- O botão "Ajuda e sugestões" do topo e as RPCs support_ticket_* existentes não mudam.
-- Rollback: supabase/rollback/20261117120000_ajuda_max_locacao_sugestoes.sql
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

ALTER TABLE public.support_tickets DROP CONSTRAINT support_tickets_origem_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_origem_check
  CHECK (origem IN ('adm', 'estudo', 'visita', 'locacao'));
COMMENT ON COLUMN public.support_tickets.origem IS
  'Onde o chamado foi aberto. adm e estudo vão para o MAX Tecnologia; visita vai para o MAX Visita Prova; locacao = '
  'balão Ajuda MAX da Locação (fica com a gestão da imobiliária; fora da fila do bot).';

-- Registrar (com o login de quem envia). Reaproveita support_ticket_create (validação de texto, freio 10/hora e
-- conferência do print <org>/<autor>/<uuid>.<ext> no bucket privado) e só marca a origem.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_registrar(_tipo text, _texto text, _tela_rota text DEFAULT NULL,
  _tela_nome text DEFAULT NULL, _user_agent text DEFAULT NULL, _print_path text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid; _numero bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ajuda_max_locacao_enabled() THEN
    RAISE EXCEPTION 'Ajuda MAX desligado nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('sugestao', 'erro', 'duvida') THEN RAISE EXCEPTION 'Tipo inválido' USING ERRCODE = '22023'; END IF;
  _id := public.support_ticket_create(_tipo, _texto, _tela_rota, _tela_nome, _user_agent, _print_path);
  UPDATE public.support_tickets SET origem = 'locacao' WHERE id = _id RETURNING numero INTO _numero;
  RETURN jsonb_build_object('id', _id, 'numero', _numero);
END $$;

-- Lista da tela "Sugestões e erros". gestao=true: tudo da imobiliária; senão: só os meus.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_sugestoes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _gestao boolean;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT public.ajuda_max_locacao_enabled() THEN
    RAISE EXCEPTION 'Ajuda MAX desligado nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  _gestao := public.locacao_eh_gerencia(_uid);
  RETURN jsonb_build_object('gestao', _gestao, 'itens', coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.created_at DESC) FROM (
      SELECT t.created_at, jsonb_build_object(
        'id', t.id, 'numero', t.numero, 'tipo', t.tipo, 'status', t.status,
        'texto', coalesce((SELECT m.texto FROM public.support_ticket_messages m
                            WHERE m.ticket_id = t.id AND NOT m.autor_equipe AND NOT m.interna
                            ORDER BY m.created_at, m.id LIMIT 1), t.assunto),
        'tela_nome', t.tela_nome, 'autor_nome', coalesce(p.nome, 'Usuário'), 'meu', t.author_id = _uid,
        'tem_print', t.print_path IS NOT NULL, 'created_at', t.created_at, 'resolved_at', t.resolved_at) AS j
      FROM public.support_tickets t
      LEFT JOIN public.profiles p ON p.id = t.author_id
      WHERE t.organization_id = _org AND t.origem = 'locacao' AND (_gestao OR t.author_id = _uid)
      ORDER BY t.created_at DESC
      LIMIT 500) x), '[]'::jsonb));
END $$;

-- Status pela gestão da própria imobiliária (só chamados da Locação).
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_sugestao_status(_ticket uuid, _status text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _t public.support_tickets%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT public.ajuda_max_locacao_enabled() THEN
    RAISE EXCEPTION 'Ajuda MAX desligado nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('recebido', 'em_analise', 'resolvido') THEN
    RAISE EXCEPTION 'Status inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT public.locacao_eh_gerencia(_uid) THEN
    RAISE EXCEPTION 'Só a gestão da imobiliária muda o status' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _t FROM public.support_tickets
   WHERE id = _ticket AND organization_id = _org AND origem = 'locacao' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envio não encontrado' USING ERRCODE = '42501'; END IF;
  UPDATE public.support_tickets
     SET status = _status,
         resolved_at = CASE WHEN _status = 'resolvido' THEN coalesce(resolved_at, now()) ELSE NULL END
   WHERE id = _t.id;
  RETURN _status;
END $$;

-- Caminho do print (o servidor gera o link assinado de 5 min): autor ou gestão da mesma imobiliária.
CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_sugestao_print(_ticket uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT t.print_path FROM public.support_tickets t
   WHERE t.id = _ticket AND t.origem = 'locacao' AND auth.uid() IS NOT NULL
     AND t.organization_id = public.current_org_id() AND public.ajuda_max_locacao_enabled()
     AND (t.author_id = auth.uid() OR public.locacao_eh_gerencia(auth.uid()))
$$;

REVOKE ALL ON FUNCTION public.ajuda_max_locacao_registrar(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_sugestoes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_sugestao_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_sugestao_print(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_registrar(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_sugestoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_sugestao_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_sugestao_print(uuid) TO authenticated;

COMMIT;

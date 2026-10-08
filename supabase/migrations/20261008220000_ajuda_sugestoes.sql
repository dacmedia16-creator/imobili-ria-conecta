-- "Ajuda e sugestões": canal de chamados (Erro / Dúvida / Ideia) dos usuários para a equipe MAX.
-- Maquete t_b92e0383 aprovada por Denis em 08/10/2026 (tópico 6238, "pode fazer").
--
--  Tabelas  support_tickets (1 por chamado) e support_ticket_messages (conversa; nota interna só da
--           equipe MAX).
--  Storage  bucket PRIVADO support-attachments (png/jpeg/webp, 5 MB). Caminho
--           <organização>/<autor>/<uuid>.<ext>. Só o autor e a equipe MAX leem (link assinado).
--  Coluna   notifications.support_ticket_id, para o sino abrir o chamado.
--
-- Quem vê o quê
--   - autor: os próprios chamados e as respostas (nunca a nota interna);
--   - admin da imobiliária (admin/super_admin da agência): os chamados da PRÓPRIA imobiliária, só
--     leitura, sem nota interna e sem o print;
--   - equipe MAX (platform_admins / is_platform_super_admin): todos, de todas as imobiliárias;
--     responde, escreve nota interna e muda o status.
--   Uma imobiliária nunca vê chamado de outra (org_isolation restritiva + checagens nas RPCs).
--
-- Escrita só pelas RPCs abaixo (SECURITY DEFINER, search_path vazio); as tabelas não têm INSERT,
-- UPDATE nem DELETE para authenticated. Avisos (sino/WhatsApp) são gravados pelo servidor.
-- Rollback: supabase/rollback/20261008220000_ajuda_sugestoes.sql
BEGIN;

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('erro', 'duvida', 'sugestao')),
  status text NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido', 'em_analise', 'respondido', 'resolvido')),
  assunto text NOT NULL CHECK (length(assunto) BETWEEN 1 AND 120),
  tela_rota text CHECK (length(tela_rota) <= 300),
  tela_nome text CHECK (length(tela_nome) <= 120),
  user_agent text CHECK (length(user_agent) <= 400),
  print_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (id, organization_id),
  -- O autor pertence à imobiliária do chamado.
  CONSTRAINT support_tickets_author_org_fk FOREIGN KEY (author_id, organization_id)
    REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX support_tickets_org_idx ON public.support_tickets (organization_id, last_message_at DESC);
CREATE INDEX support_tickets_author_idx ON public.support_tickets (author_id, last_message_at DESC);
CREATE INDEX support_tickets_status_idx ON public.support_tickets (status, last_message_at DESC);
CREATE UNIQUE INDEX support_tickets_print_uq ON public.support_tickets (print_path) WHERE print_path IS NOT NULL;
COMMENT ON TABLE public.support_tickets IS 'Ajuda e sugestões: chamados dos usuários para a equipe MAX (20261008220000).';

CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_equipe boolean NOT NULL DEFAULT false,
  interna boolean NOT NULL DEFAULT false,
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_ticket_fk FOREIGN KEY (ticket_id, organization_id)
    REFERENCES public.support_tickets(id, organization_id) ON DELETE CASCADE,
  -- Nota interna só pode ser da equipe MAX.
  CONSTRAINT support_ticket_messages_interna_equipe CHECK (NOT interna OR autor_equipe)
);
CREATE INDEX support_ticket_messages_ticket_idx ON public.support_ticket_messages (ticket_id, created_at);
CREATE INDEX support_ticket_messages_org_idx ON public.support_ticket_messages (organization_id, created_at);

DROP TRIGGER IF EXISTS support_tickets_updated ON public.support_tickets;
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: leitura direta é defesa em profundidade (as telas usam as RPCs de leitura abaixo).
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets, public.support_ticket_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_tickets, public.support_ticket_messages TO authenticated;
GRANT ALL ON public.support_tickets, public.support_ticket_messages TO service_role;

CREATE POLICY org_isolation ON public.support_tickets AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) OR (SELECT public.is_platform_super_admin()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()) OR (SELECT public.is_platform_super_admin()));
CREATE POLICY org_isolation ON public.support_ticket_messages AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) OR (SELECT public.is_platform_super_admin()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()) OR (SELECT public.is_platform_super_admin()));

CREATE POLICY support_tickets_read ON public.support_tickets FOR SELECT TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    OR (SELECT public.is_platform_super_admin())
    OR (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
  );
CREATE POLICY support_ticket_messages_read ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (
    ticket_id IN (SELECT t.id FROM public.support_tickets t)
    AND (NOT interna OR (SELECT public.is_platform_super_admin()))
  );

-- Sino --------------------------------------------------------------------------------------------
-- O aviso da equipe MAX fica na imobiliária de quem recebe (FK de notifications), por isso a
-- referência ao chamado é simples (sem organização).
ALTER TABLE public.notifications ADD COLUMN support_ticket_id uuid
  REFERENCES public.support_tickets(id) ON DELETE CASCADE;
CREATE INDEX notifications_support_ticket_idx ON public.notifications (support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;
COMMENT ON COLUMN public.notifications.support_ticket_id IS
  'Ajuda e sugestões: chamado que o aviso abre (20261008220000).';

-- Storage: bucket PRIVADO para os prints -----------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('support-attachments', 'support-attachments', false, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'support-attachments' AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket support-attachments deve ser privado'; END IF;
END $$;

-- O navegador NÃO acessa este bucket (nenhuma policy para authenticated; a trava multiempresa
-- mt_1c_storage_scope também não o inclui). Envio e link assinado (5 min) passam pelo servidor:
-- ele confere a permissão no banco (support_ticket_print_path / current_org_id) e só então usa a
-- service_role. Admin da imobiliária e colegas NÃO leem o print.

-- RPCs --------------------------------------------------------------------------------------------

-- Abrir chamado (qualquer usuário ativo, na própria imobiliária). Devolve o id.
CREATE FUNCTION public.support_ticket_create(
  _tipo text, _texto text, _tela_rota text DEFAULT NULL, _tela_nome text DEFAULT NULL,
  _user_agent text DEFAULT NULL, _print_path text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid; _id uuid; _txt text := btrim(coalesce(_texto, ''));
  _print text := nullif(btrim(coalesce(_print_path, '')), '');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login para abrir um chamado' USING ERRCODE = '42501'; END IF;
  IF public.mt_pc_context_org() IS NOT NULL THEN
    RAISE EXCEPTION 'Saia do contexto da imobiliária para abrir um chamado' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL OR NOT public.is_active_user(_uid) THEN
    RAISE EXCEPTION 'Usuário sem imobiliária ativa' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('erro', 'duvida', 'sugestao') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF length(_txt) < 5 THEN RAISE EXCEPTION 'Escreva pelo menos 5 caracteres'; END IF;
  IF length(_txt) > 4000 THEN RAISE EXCEPTION 'Texto muito longo (máximo 4.000 caracteres)'; END IF;
  -- Freio contra envio repetido.
  IF (SELECT count(*) FROM public.support_tickets
       WHERE author_id = _uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Muitos chamados em pouco tempo. Tente de novo mais tarde.';
  END IF;
  IF _print IS NOT NULL THEN
    IF _print !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|webp)$'
       OR split_part(_print, '/', 1) <> _org::text OR split_part(_print, '/', 2) <> _uid::text
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'support-attachments' AND o.name = _print)
       OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.print_path = _print)
    THEN RAISE EXCEPTION 'Print inválido'; END IF;
  END IF;

  INSERT INTO public.support_tickets (organization_id, author_id, tipo, assunto, tela_rota, tela_nome, user_agent, print_path)
  VALUES (_org, _uid, _tipo,
    left(regexp_replace(_txt, '\s+', ' ', 'g'), 120),
    left(nullif(btrim(coalesce(_tela_rota, '')), ''), 300),
    left(nullif(btrim(coalesce(_tela_nome, '')), ''), 120),
    left(nullif(btrim(coalesce(_user_agent, '')), ''), 400),
    _print)
  RETURNING id INTO _id;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_id, _org, _uid, false, false, _txt);
  RETURN _id;
END $function$;

-- Responder. Equipe MAX: resposta (status vira 'respondido') ou nota interna (status não muda).
-- Autor: responde no próprio chamado não resolvido (status volta para 'em_analise').
-- Admin da imobiliária: só leitura. Devolve o status final.
CREATE FUNCTION public.support_ticket_reply(_ticket uuid, _texto text, _interna boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _t public.support_tickets%ROWTYPE; _txt text := btrim(coalesce(_texto, ''));
  _equipe boolean; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  IF length(_txt) < 1 THEN RAISE EXCEPTION 'Escreva a mensagem'; END IF;
  IF length(_txt) > 4000 THEN RAISE EXCEPTION 'Texto muito longo (máximo 4.000 caracteres)'; END IF;
  _equipe := public.is_platform_super_admin(_uid);
  SELECT * INTO _t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado' USING ERRCODE = '42501'; END IF;

  IF _equipe THEN
    _status := CASE WHEN coalesce(_interna, false) THEN _t.status ELSE 'respondido' END;
  ELSIF _t.author_id = _uid AND _t.organization_id = public.current_org_id() THEN
    IF coalesce(_interna, false) THEN RAISE EXCEPTION 'Nota interna é só da equipe MAX' USING ERRCODE = '42501'; END IF;
    IF _t.status = 'resolvido' THEN RAISE EXCEPTION 'Chamado resolvido. Abra um novo chamado.'; END IF;
    _status := CASE WHEN _t.status = 'respondido' THEN 'em_analise' ELSE _t.status END;
  ELSE
    RAISE EXCEPTION 'Somente leitura: quem responde é a equipe MAX' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_t.id, _t.organization_id, _uid, _equipe, _equipe AND coalesce(_interna, false), _txt);
  UPDATE public.support_tickets
     SET status = _status, last_message_at = now(),
         resolved_at = CASE WHEN _status = 'resolvido' THEN coalesce(resolved_at, now()) ELSE NULL END
   WHERE id = _t.id;
  RETURN _status;
END $function$;

-- Mudar status. Equipe MAX: qualquer status. Autor: só 'resolvido' ("Resolveu, pode fechar").
CREATE FUNCTION public.support_ticket_set_status(_ticket uuid, _status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _t public.support_tickets%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('recebido', 'em_analise', 'respondido', 'resolvido') THEN RAISE EXCEPTION 'Status inválido'; END IF;
  SELECT * INTO _t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chamado não encontrado' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_platform_super_admin(_uid)
     AND NOT (_t.author_id = _uid AND _t.organization_id = public.current_org_id() AND _status = 'resolvido') THEN
    RAISE EXCEPTION 'Somente leitura: quem muda o status é a equipe MAX' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_tickets
     SET status = _status,
         resolved_at = CASE WHEN _status = 'resolvido' THEN coalesce(resolved_at, now()) ELSE NULL END
   WHERE id = _t.id;
END $function$;

-- Listas. 'meus' = os meus; 'org' = da minha imobiliária (admin, só leitura); 'todos' = equipe MAX.
CREATE FUNCTION public.support_ticket_list(_escopo text)
 RETURNS TABLE (
  id uuid, numero bigint, organization_id uuid, organizacao text, author_id uuid, autor_nome text,
  autor_papeis text, tipo text, status text, assunto text, tela_nome text, tela_rota text,
  print_path text, tem_print boolean, created_at timestamptz, last_message_at timestamptz,
  resolved_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _equipe boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  _equipe := public.is_platform_super_admin(_uid);
  IF _escopo = 'todos' AND NOT _equipe THEN
    RAISE EXCEPTION 'Só a equipe MAX vê a central de chamados' USING ERRCODE = '42501';
  END IF;
  IF _escopo = 'org' AND (_org IS NULL
      OR NOT public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'Só o admin da imobiliária vê os chamados da imobiliária' USING ERRCODE = '42501';
  END IF;
  IF _escopo NOT IN ('meus', 'org', 'todos') THEN RAISE EXCEPTION 'Escopo inválido'; END IF;
  RETURN QUERY
  SELECT t.id, t.numero, t.organization_id, o.nome, t.author_id, p.nome,
    (SELECT string_agg(r.role::text, ',' ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = t.author_id),
    t.tipo, t.status, t.assunto, t.tela_nome, t.tela_rota,
    CASE WHEN _escopo = 'org' THEN NULL ELSE t.print_path END,
    t.print_path IS NOT NULL, t.created_at, t.last_message_at, t.resolved_at
  FROM public.support_tickets t
  JOIN public.organizations o ON o.id = t.organization_id
  LEFT JOIN public.profiles p ON p.id = t.author_id
  WHERE CASE _escopo
    WHEN 'meus' THEN t.author_id = _uid AND t.organization_id = _org
    WHEN 'org' THEN t.organization_id = _org
    ELSE true END
  ORDER BY t.last_message_at DESC
  LIMIT 500;
END $function$;

-- Conversa de um chamado. Nota interna só para a equipe MAX; para os demais a equipe aparece
-- como "Equipe MAX".
CREATE FUNCTION public.support_ticket_thread(_ticket uuid)
 RETURNS TABLE (id uuid, autor_equipe boolean, interna boolean, autor_nome text, texto text, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _t public.support_tickets%ROWTYPE; _equipe boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  _equipe := public.is_platform_super_admin(_uid);
  SELECT * INTO _t FROM public.support_tickets WHERE support_tickets.id = _ticket;
  IF NOT FOUND OR NOT (
    _equipe
    OR (_t.organization_id = public.current_org_id()
        AND (_t.author_id = _uid
             OR public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[])))
  ) THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.id, m.autor_equipe, m.interna,
    CASE WHEN m.autor_equipe AND NOT _equipe THEN 'Equipe MAX'
         WHEN m.autor_equipe THEN coalesce(p.nome, 'Equipe MAX') || ' (Equipe MAX)'
         ELSE coalesce(p.nome, 'Usuário') END,
    m.texto, m.created_at
  FROM public.support_ticket_messages m
  LEFT JOIN public.profiles p ON p.id = m.author_id
  WHERE m.ticket_id = _t.id AND (NOT m.interna OR _equipe)
  ORDER BY m.created_at, m.id;
END $function$;

-- Caminho do print, só para quem pode vê-lo: o autor (na imobiliária dele) e a equipe MAX.
-- O servidor usa a resposta para gerar o link assinado.
CREATE FUNCTION public.support_ticket_print_path(_ticket uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT t.print_path FROM public.support_tickets t
   WHERE t.id = _ticket AND auth.uid() IS NOT NULL
     AND (public.is_platform_super_admin(auth.uid())
          OR (t.author_id = auth.uid() AND t.organization_id = public.current_org_id()))
$function$;

REVOKE ALL ON FUNCTION public.support_ticket_print_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_print_path(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.support_ticket_create(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ticket_reply(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ticket_set_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ticket_list(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ticket_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_create(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_reply(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_set_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_thread(uuid) TO authenticated;

COMMIT;

-- Avisos de exclusividade vencendo + reunião de 45 dias com o proprietário (cartão t_c337fc12, Denis 08/11/2026,
-- tópico 6238). CONSTRUÇÃO EM TESTE: aplicar em produção só com o "sim" de Denis.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261108120000_avisos_exclusividade.rollback.sql
-- Sem BEGIN/COMMIT próprios: o teste (supabase/tests/avisos_exclusividade.sql) a inclui numa transação desfeita.
--
-- O que faz:
-- 1) Módulo 'avisos_exclusividade' em organization_modules. Nasce DESLIGADO em todas as imobiliárias (nenhuma
--    linha é criada). Só o super-admin da plataforma liga/desliga (tela Módulos). Desligar não apaga nada.
-- 2) exclusive_owner_meetings: reuniões de prestação de contas com o proprietário (data + o que foi combinado).
--    Leitura: quem já vê a captação (exclusive_can_view). Escrita só pela RPC exclusive_reuniao_registrar.
-- 3) exclusive_notice_log: 1 linha por aviso (pessoa + captação + tipo + data-chave). UNIQUE = nunca repete o
--    mesmo aviso. Guarda o resultado de cada canal (sino, push, WhatsApp). Só service_role.
-- 4) push_subscriptions: aparelhos que autorizaram o push. Cada um vê/apaga só os seus; inscrição pela RPC.
-- 5) aviso_preferencias: o corretor desliga push e/ou WhatsApp destes avisos (o sino fica sempre ligado).
-- Nenhuma captação, venda ou notificação existente é alterada.

-- 1) Chave do módulo ------------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                                        'avisos_exclusividade')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

-- Para a rotina do servidor (service_role); authenticated não executa.
CREATE OR REPLACE FUNCTION public.avisos_exclusividade_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'avisos_exclusividade'), false)
$$;
REVOKE ALL ON FUNCTION public.avisos_exclusividade_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisos_exclusividade_modulo_ligado(uuid) TO service_role;

-- Para a tela: módulo ligado na imobiliária de quem está logado.
CREATE OR REPLACE FUNCTION public.avisos_exclusividade_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.avisos_exclusividade_modulo_ligado(public.current_org_id())
$$;
REVOKE ALL ON FUNCTION public.avisos_exclusividade_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisos_exclusividade_enabled() TO authenticated, service_role;

-- 2) Reuniões com o proprietário ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exclusive_owner_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL,
  met_on date NOT NULL,
  notes text NOT NULL CHECK (length(btrim(notes)) BETWEEN 5 AND 2000),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exclusive_owner_meetings_capture_fk FOREIGN KEY (capture_id, organization_id)
    REFERENCES public.exclusive_captures (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS exclusive_owner_meetings_capture ON public.exclusive_owner_meetings (capture_id, met_on DESC);

ALTER TABLE public.exclusive_owner_meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusive_owner_meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exclusive_owner_meetings TO authenticated;
GRANT ALL ON public.exclusive_owner_meetings TO service_role;

CREATE POLICY org_isolation ON public.exclusive_owner_meetings AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY modulo_ligado ON public.exclusive_owner_meetings AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.avisos_exclusividade_enabled()));
CREATE POLICY reunioes_ler ON public.exclusive_owner_meetings FOR SELECT TO authenticated
  USING (public.exclusive_can_view(capture_id, (SELECT auth.uid())));

-- Registra a reunião. Quem já pode ver a captação (captador, líder dele, admin) registra.
-- Só captação aprovada (assinada), não arquivada/descartada. Data entre a assinatura e hoje (São Paulo).
CREATE OR REPLACE FUNCTION public.exclusive_reuniao_registrar(_capture uuid, _data date, _texto text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _c record; _id uuid;
        _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _t text := btrim(coalesce(_texto, ''));
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT public.is_active_user(_me) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.avisos_exclusividade_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Avisos de exclusividade não estão ligados nesta imobiliária' USING ERRCODE = '42501';
  END IF;
  IF _capture IS NULL OR NOT public.exclusive_can_view(_capture, _me) THEN
    RAISE EXCEPTION 'Captação não encontrada' USING ERRCODE = '42501';
  END IF;
  SELECT id, status, signed_on, archived_at, discarded_at INTO _c FROM public.exclusive_captures
   WHERE id = _capture AND organization_id = _org;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Captação não encontrada' USING ERRCODE = '42501'; END IF;
  IF _c.status <> 'aprovada' OR _c.signed_on IS NULL OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só dá para registrar reunião em exclusividade assinada e ativa' USING ERRCODE = '22023';
  END IF;
  IF _data IS NULL OR _data > _hoje OR _data < _c.signed_on THEN
    RAISE EXCEPTION 'Data da reunião deve ficar entre a assinatura e hoje' USING ERRCODE = '22023';
  END IF;
  IF length(_t) < 5 OR length(_t) > 2000 THEN
    RAISE EXCEPTION 'Descreva o que foi combinado (de 5 a 2000 caracteres)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.exclusive_owner_meetings (organization_id, capture_id, met_on, notes, created_by)
  VALUES (_org, _capture, _data, _t, _me) RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_reuniao_registrar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_reuniao_registrar(uuid, date, text) TO authenticated, service_role;

-- 3) Registro dos avisos (sem duplicidade) ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exclusive_notice_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Nulo no resumo semanal do gestor/TL (não é de uma captação só).
  capture_id uuid REFERENCES public.exclusive_captures(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('vence_30', 'vence_15', 'vence_hoje', 'vencida_semanal',
                                     'reuniao_45', 'reuniao_semanal', 'resumo_gestor')),
  -- Data-chave do aviso: fim da exclusividade (30/15/hoje), início do ciclo semanal, ou a segunda do resumo.
  chave date NOT NULL,
  sino text, push text, whatsapp text,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT: o resumo do gestor (capture_id nulo) também não repete.
  CONSTRAINT exclusive_notice_log_unico UNIQUE NULLS NOT DISTINCT (recipient_id, capture_id, tipo, chave)
);
CREATE INDEX IF NOT EXISTS exclusive_notice_log_org ON public.exclusive_notice_log (organization_id, created_at DESC);
ALTER TABLE public.exclusive_notice_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusive_notice_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exclusive_notice_log TO service_role;

-- 4) Aparelhos com push ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 200),
  auth text NOT NULL CHECK (length(auth) BETWEEN 8 AND 100),
  aparelho text CHECK (aparelho IS NULL OR length(aparelho) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  ultimo_ok_em timestamptz,
  falhas integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
CREATE POLICY org_isolation ON public.push_subscriptions AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY push_proprio ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Inscreve este aparelho para mim (se o aparelho era de outra pessoa, passa a ser meu).
CREATE OR REPLACE FUNCTION public.push_inscrever(_endpoint text, _p256dh text, _auth text, _aparelho text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _id uuid;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT public.is_active_user(_me) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _endpoint IS NULL OR _endpoint !~ '^https://' OR length(_endpoint) > 1000
     OR length(coalesce(_p256dh, '')) NOT BETWEEN 20 AND 200 OR length(coalesce(_auth, '')) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'Inscrição inválida' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = _me AND endpoint <> _endpoint) >= 10 THEN
    RAISE EXCEPTION 'Limite de 10 aparelhos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth, aparelho)
  VALUES (_org, _me, _endpoint, _p256dh, _auth, left(_aparelho, 200))
  ON CONFLICT (endpoint) DO UPDATE SET organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, aparelho = EXCLUDED.aparelho, falhas = 0
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.push_inscrever(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_inscrever(text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.push_cancelar(_endpoint text)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.push_subscriptions WHERE user_id = auth.uid() AND endpoint = _endpoint;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.push_cancelar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_cancelar(text) TO authenticated, service_role;

-- 5) Preferências (sem linha = push e WhatsApp ligados; o sino não desliga) -----------------------------------
CREATE TABLE IF NOT EXISTS public.aviso_preferencias (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  push boolean NOT NULL DEFAULT true,
  whatsapp boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aviso_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aviso_preferencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.aviso_preferencias TO authenticated;
GRANT ALL ON public.aviso_preferencias TO service_role;
CREATE POLICY org_isolation ON public.aviso_preferencias AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY prefs_proprio ON public.aviso_preferencias FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.aviso_preferencias_salvar(_push boolean, _whatsapp boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT public.is_active_user(_me) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _push IS NULL OR _whatsapp IS NULL THEN RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.aviso_preferencias (user_id, organization_id, push, whatsapp, updated_at)
  VALUES (_me, _org, _push, _whatsapp, now())
  ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, push = EXCLUDED.push,
    whatsapp = EXCLUDED.whatsapp, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.aviso_preferencias_salvar(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_preferencias_salvar(boolean, boolean) TO authenticated, service_role;

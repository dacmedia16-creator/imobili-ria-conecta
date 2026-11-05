-- Módulo "Agendar fotos + Vouchers de Fotos + Perfil do fotógrafo" (card t_d86ab990; regras aprovadas por Denis
-- em 04/11/2026, tópico 6238; maquete t_1b69c957).
--
-- ADITIVA. Rollback: docs/sql/rollback/20261105120000_vouchers_fotos.rollback.sql
-- Sem BEGIN/COMMIT próprios: o teste (supabase/tests/run-vouchers-fotos.sh) a inclui numa transação desfeita.
--
-- Regras:
-- * Módulo 'vouchers_fotos' em organization_modules; só o super-admin da plataforma liga/desliga
--   (platform_set_organization_module). Desligado: nenhuma RPC responde e nenhum voucher é gerado.
--   Estado inicial: DESLIGADO em todas as imobiliárias (nenhuma linha é criada).
-- * Meta: 3 captações exclusivas ASSINADAS no mês (exclusive_captures.status='aprovada' + signed_on no mês,
--   discarded_at nulo; arquivada CONTA) para quem captou = coalesce(captador_original_id, captor_id).
--   Com 3 → 3 vouchers; cada captação a mais no mês → +1 (5 captações = 5 vouchers).
-- * Geração: photo_vouchers_conferir(org, corretor, mês) conta e gera só a diferença. Idempotente
--   (pode rodar de novo sem duplicar) e com trava (pg_advisory_xact_lock + UNIQUE por sequência) contra
--   duas aprovações ao mesmo tempo. Nunca retira voucher: captação cancelada/desaprovada/transferida depois
--   da geração não muda nada (decisão de Denis).
-- * Validade: vale desde a geração; vence em (1º dia do mês seguinte ao mês da meta) + 89 dias, ou seja,
--   90 dias corridos contando o dia 1º (novembro → 28/02). "Vencido" é calculado pela data.
-- * Uso: 1 voucher por imóvel (captação), só em imóvel do próprio corretor; vouchers de meses diferentes
--   podem ser somados (cada um num imóvel).
-- * Agenda: 1 fotógrafo por imobiliária (usuário com papel staff, escolhido nas configurações).
--   O fotógrafo libera e bloqueia faixas de horário. Sessão de 2 h com 1 h obrigatória de intervalo antes da
--   próxima (EXCLUDE com btree_gist sobre [início, fim + 1 h)). Com voucher (imobiliária paga) ou sem
--   (o corretor paga; o Financeiro cobra por telefone e marca "cobrado").
-- * Confirmação (ajuste de Denis 04/11): a sessão nasce "aguardando" (já ocupa o horário); o fotógrafo
--   (ou admin) confirma ou recusa. Recusar devolve o voucher, libera o horário e não conta para a
--   penalidade (confirmado por Denis 04/11).
-- * Desmarcar: o corretor pode desmarcar a qualquer momento (voucher volta). 3 desmarcações em 30 dias
--   → 7 dias sem agendar (photo_penalidades). Quem conta fica isolado em photo_papeis_que_penalizam()
--   (só o corretor; fotógrafo/admin NÃO contam — confirmado por Denis 04/11).
-- * Avisos: sino (public.notifications, gravado aqui) + WhatsApp pelo mesmo canal ZionTalk das vendas
--   (enviado pelo servidor, 1 por destinatário do evento). Fotógrafo: marcou/desmarcou. Corretor:
--   confirmou/recusou (e desmarcação feita por outro). Sem e-mail.
-- * Valor por sessão configurável; congelado na sessão quando ela é marcada como feita.
-- * RLS ligada em todas as tabelas novas, isolada por organização; escrita só pelas RPCs SECURITY DEFINER.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1) Chave do módulo ------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos')
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

-- Módulo ligado numa imobiliária específica (uso interno: gatilho e RPCs).
CREATE OR REPLACE FUNCTION public.photo_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'vouchers_fotos'), false)
$$;
REVOKE ALL ON FUNCTION public.photo_modulo_ligado(uuid) FROM PUBLIC, anon;
-- authenticated precisa executar: é chamada pelas políticas de RLS (só devolve true/false).
GRANT EXECUTE ON FUNCTION public.photo_modulo_ligado(uuid) TO authenticated, service_role;

-- Módulo ligado na imobiliária atual (menu e guarda da rota). Sem linha, erro ou sem login = desligado.
CREATE OR REPLACE FUNCTION public.vouchers_fotos_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.photo_modulo_ligado(public.current_org_id())
$$;
REVOKE ALL ON FUNCTION public.vouchers_fotos_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vouchers_fotos_enabled() TO authenticated, service_role;

-- 2) Tabelas ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.photo_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  fotografo_id uuid,
  valor_sessao numeric(10,2) NOT NULL DEFAULT 0 CHECK (valor_sessao >= 0 AND valor_sessao <= 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT photo_settings_fotografo_org_fk FOREIGN KEY (fotografo_id, organization_id)
    REFERENCES public.profiles(id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.photo_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  corretor_id uuid NOT NULL,
  mes_ref date NOT NULL CHECK (mes_ref = date_trunc('month', mes_ref)::date),
  seq integer NOT NULL CHECK (seq >= 1),
  gerado_em timestamptz NOT NULL DEFAULT now(),
  vence_em date NOT NULL,
  status text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'agendado', 'usado')),
  CONSTRAINT photo_vouchers_unq UNIQUE (organization_id, corretor_id, mes_ref, seq),
  CONSTRAINT photo_vouchers_id_org UNIQUE (id, organization_id),
  CONSTRAINT photo_vouchers_corretor_org_fk FOREIGN KEY (corretor_id, organization_id)
    REFERENCES public.profiles(id, organization_id)
);
CREATE INDEX IF NOT EXISTS photo_vouchers_corretor_idx ON public.photo_vouchers (organization_id, corretor_id, status);

-- Faixas do fotógrafo: 'livre' (liberado para agendar) ou 'bloqueio' (fechado, vence a faixa livre).
CREATE TABLE IF NOT EXISTS public.photo_agenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fotografo_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('livre', 'bloqueio')),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photo_agenda_intervalo CHECK (fim > inicio AND fim - inicio <= interval '16 hours'),
  CONSTRAINT photo_agenda_fotografo_org_fk FOREIGN KEY (fotografo_id, organization_id)
    REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS photo_agenda_org_idx ON public.photo_agenda (organization_id, inicio);

CREATE TABLE IF NOT EXISTS public.photo_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fotografo_id uuid NOT NULL,
  corretor_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  voucher_id uuid,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  -- fim + 1 h de intervalo obrigatório (gravado pela RPC; a CHECK garante a conta).
  ocupa_ate timestamptz NOT NULL,
  -- aguardando (confirmação do fotógrafo; já ocupa o horário) → confirmada → feita;
  -- recusada (pelo fotógrafo/admin) ou cancelada (desmarcada) liberam o horário e devolvem o voucher.
  status text NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando', 'confirmada', 'feita', 'cancelada', 'recusada')),
  confirmada_em timestamptz,
  confirmada_por uuid REFERENCES auth.users(id),
  paga_por text NOT NULL CHECK (paga_por IN ('imobiliaria', 'corretor')),
  valor_congelado numeric(10,2),
  cobranca_status text CHECK (cobranca_status IN ('a_cobrar', 'cobrado')),
  cobrado_em timestamptz,
  cobrado_por uuid REFERENCES auth.users(id),
  feita_em timestamptz,
  feita_por uuid REFERENCES auth.users(id),
  cancelada_em timestamptz,
  cancelada_por uuid REFERENCES auth.users(id),
  cancelada_papel text CHECK (cancelada_papel IN ('corretor', 'fotografo', 'admin')),
  motivo_cancelamento text CHECK (motivo_cancelamento IS NULL OR char_length(motivo_cancelamento) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT photo_sessions_duracao CHECK (fim = inicio + interval '2 hours' AND ocupa_ate = fim + interval '1 hour'),
  CONSTRAINT photo_sessions_paga CHECK ((voucher_id IS NULL) = (paga_por = 'corretor')),
  CONSTRAINT photo_sessions_feita CHECK (status <> 'feita' OR (feita_em IS NOT NULL AND valor_congelado IS NOT NULL)),
  CONSTRAINT photo_sessions_cobranca CHECK (cobranca_status IS NULL OR (paga_por = 'corretor' AND status = 'feita')),
  CONSTRAINT photo_sessions_cancelada CHECK (status NOT IN ('cancelada', 'recusada') OR (cancelada_em IS NOT NULL AND cancelada_papel IS NOT NULL)),
  CONSTRAINT photo_sessions_fotografo_org_fk FOREIGN KEY (fotografo_id, organization_id)
    REFERENCES public.profiles(id, organization_id),
  CONSTRAINT photo_sessions_corretor_org_fk FOREIGN KEY (corretor_id, organization_id)
    REFERENCES public.profiles(id, organization_id),
  CONSTRAINT photo_sessions_capture_org_fk FOREIGN KEY (capture_id, organization_id)
    REFERENCES public.exclusive_captures(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT photo_sessions_voucher_org_fk FOREIGN KEY (voucher_id, organization_id)
    REFERENCES public.photo_vouchers(id, organization_id),
  -- Duas sessões ativas da imobiliária (1 fotógrafo) não podem se encostar: 2 h + 1 h de intervalo.
  CONSTRAINT photo_sessions_sem_choque EXCLUDE USING gist
    (organization_id WITH =, tstzrange(inicio, ocupa_ate) WITH &&) WHERE (status NOT IN ('cancelada', 'recusada'))
);
-- 1 voucher por imóvel e o mesmo voucher numa só sessão ativa; 1 agendamento aberto por imóvel.
CREATE UNIQUE INDEX IF NOT EXISTS photo_sessions_voucher_por_imovel
  ON public.photo_sessions (capture_id) WHERE voucher_id IS NOT NULL AND status NOT IN ('cancelada', 'recusada');
CREATE UNIQUE INDEX IF NOT EXISTS photo_sessions_voucher_unico
  ON public.photo_sessions (voucher_id) WHERE voucher_id IS NOT NULL AND status NOT IN ('cancelada', 'recusada');
CREATE UNIQUE INDEX IF NOT EXISTS photo_sessions_uma_aberta_por_imovel
  ON public.photo_sessions (capture_id) WHERE status IN ('aguardando', 'confirmada');
CREATE INDEX IF NOT EXISTS photo_sessions_org_inicio_idx ON public.photo_sessions (organization_id, inicio);
CREATE INDEX IF NOT EXISTS photo_sessions_corretor_idx ON public.photo_sessions (organization_id, corretor_id, cancelada_em);

-- Bloqueio por desmarcações (1 linha por corretor; bloqueado_desde zera a contagem seguinte).
CREATE TABLE IF NOT EXISTS public.photo_penalidades (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  corretor_id uuid NOT NULL,
  bloqueado_desde timestamptz NOT NULL,
  bloqueado_ate timestamptz NOT NULL,
  PRIMARY KEY (organization_id, corretor_id),
  CONSTRAINT photo_penalidades_corretor_org_fk FOREIGN KEY (corretor_id, organization_id)
    REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.photo_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid,
  voucher_id uuid,
  ator_id uuid,
  acao text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_history_org_idx ON public.photo_history (organization_id, created_at DESC);

-- 3) Papéis ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.photo_eh_fotografo(_org uuid, _uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.photo_settings s
    WHERE s.organization_id = _org AND s.fotografo_id = _uid)
    AND public.has_role(_uid, 'staff'::public.app_role)
$$;
REVOKE ALL ON FUNCTION public.photo_eh_fotografo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_eh_fotografo(uuid, uuid) TO authenticated; -- usada pela RLS

CREATE OR REPLACE FUNCTION public.photo_eh_admin(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['admin', 'super_admin']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.photo_eh_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_eh_admin(uuid) TO authenticated; -- usada pela RLS

CREATE OR REPLACE FUNCTION public.photo_eh_financeiro(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['financeiro', 'admin', 'super_admin']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.photo_eh_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_eh_financeiro(uuid) TO authenticated; -- usada pela RLS

-- Contexto comum das RPCs: logado, imobiliária atual e módulo ligado (senão recusa).
CREATE OR REPLACE FUNCTION public.photo_org_ativa() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  _org := public.current_org_id();
  IF _org IS NULL OR NOT public.photo_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Modulo Agendar fotos desligado' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.photo_org_ativa() FROM PUBLIC, anon, authenticated;

-- 4) RLS (leitura isolada por organização; escrita só pelas RPCs) ---------------------------------------
ALTER TABLE public.photo_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_penalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_settings, public.photo_vouchers, public.photo_agenda, public.photo_sessions,
  public.photo_penalidades, public.photo_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.photo_settings, public.photo_vouchers, public.photo_agenda, public.photo_sessions,
  public.photo_penalidades TO authenticated;

CREATE POLICY photo_settings_org ON public.photo_settings FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) AND public.photo_modulo_ligado(organization_id));
CREATE POLICY photo_agenda_org ON public.photo_agenda FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) AND public.photo_modulo_ligado(organization_id));
CREATE POLICY photo_vouchers_scope ON public.photo_vouchers FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) AND public.photo_modulo_ligado(organization_id)
         AND (corretor_id = (SELECT auth.uid()) OR public.photo_eh_financeiro((SELECT auth.uid()))));
CREATE POLICY photo_sessions_scope ON public.photo_sessions FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id()) AND public.photo_modulo_ligado(organization_id)
         AND (corretor_id = (SELECT auth.uid()) OR public.photo_eh_financeiro((SELECT auth.uid()))
              OR public.photo_eh_fotografo(organization_id, (SELECT auth.uid()))));
CREATE POLICY photo_penalidades_scope ON public.photo_penalidades FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id())
         AND (corretor_id = (SELECT auth.uid()) OR public.photo_eh_admin((SELECT auth.uid()))));

-- 5) Datas -----------------------------------------------------------------------------------------
-- Vencimento: 1º dia do mês seguinte + 89 dias (90 dias corridos contando o dia 1º).
CREATE OR REPLACE FUNCTION public.photo_voucher_vencimento(_mes date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT ((date_trunc('month', _mes) + interval '1 month')::date + 89)
$$;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.photo_hoje() RETURNS date
LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;
REVOKE ALL ON FUNCTION public.photo_hoje() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_hoje() TO authenticated, service_role;

-- 6) Geração de vouchers (idempotente + trava) ----------------------------------------------------------
-- Captações assinadas do corretor no mês (quem captou; arquivada conta; descartada não).
CREATE OR REPLACE FUNCTION public.photo_captacoes_assinadas(_org uuid, _corretor uuid, _mes date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT count(*)::int FROM public.exclusive_captures c
   WHERE c.organization_id = _org
     AND coalesce(c.captador_original_id, c.captor_id) = _corretor
     AND c.status = 'aprovada'
     AND c.signed_on IS NOT NULL
     AND c.discarded_at IS NULL
     AND c.signed_on >= date_trunc('month', _mes)::date
     AND c.signed_on < (date_trunc('month', _mes) + interval '1 month')::date
$$;
REVOKE ALL ON FUNCTION public.photo_captacoes_assinadas(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_vouchers_conferir(_org uuid, _corretor uuid, _mes date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _m date := date_trunc('month', _mes)::date;
  _assinadas int;
  _devidos int;
  _existentes int;
  _novos int := 0;
BEGIN
  IF _org IS NULL OR _corretor IS NULL OR _mes IS NULL THEN RETURN 0; END IF;
  IF NOT public.photo_modulo_ligado(_org) THEN RETURN 0; END IF;
  -- Trava por (imobiliária, corretor, mês): duas aprovações simultâneas esperam uma pela outra.
  PERFORM pg_advisory_xact_lock(hashtextextended('photo_vouchers:' || _org || ':' || _corretor || ':' || _m, 0));
  _assinadas := public.photo_captacoes_assinadas(_org, _corretor, _m);
  _devidos := CASE WHEN _assinadas >= 3 THEN _assinadas ELSE 0 END;
  SELECT count(*)::int INTO _existentes FROM public.photo_vouchers
   WHERE organization_id = _org AND corretor_id = _corretor AND mes_ref = _m;
  IF _devidos > _existentes THEN
    INSERT INTO public.photo_vouchers (organization_id, corretor_id, mes_ref, seq, vence_em)
    SELECT _org, _corretor, _m, g, public.photo_voucher_vencimento(_m)
      FROM generate_series(_existentes + 1, _devidos) g
    ON CONFLICT (organization_id, corretor_id, mes_ref, seq) DO NOTHING;
    GET DIAGNOSTICS _novos = ROW_COUNT;
    IF _novos > 0 THEN
      INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
      VALUES (_org, auth.uid(), 'vouchers_gerados', jsonb_build_object(
        'corretor_id', _corretor, 'mes_ref', _m, 'assinadas', _assinadas, 'novos', _novos));
    END IF;
  END IF;
  RETURN _novos;
END $$;
REVOKE ALL ON FUNCTION public.photo_vouchers_conferir(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_vouchers_conferir(uuid, uuid, date) TO service_role;

-- Gatilho na captação: ao ficar aprovada/assinada (ou mudar a data/captador), confere o mês.
-- shortcut: um erro aqui NÃO pode travar a aprovação da captação; vira WARNING e a próxima conferência
-- (abrir Minha carreira ou outra captação do mês) gera o que faltar.
CREATE OR REPLACE FUNCTION public.photo_vouchers_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.status = 'aprovada' AND NEW.signed_on IS NOT NULL AND NEW.discarded_at IS NULL
     AND public.photo_modulo_ligado(NEW.organization_id) THEN
    BEGIN
      PERFORM public.photo_vouchers_conferir(NEW.organization_id,
        coalesce(NEW.captador_original_id, NEW.captor_id), NEW.signed_on);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'photo_vouchers_conferir falhou: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.photo_vouchers_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_photo_vouchers ON public.exclusive_captures;
CREATE TRIGGER trg_zz_photo_vouchers
  AFTER INSERT OR UPDATE OF status, signed_on, captor_id, captador_original_id, discarded_at
  ON public.exclusive_captures FOR EACH ROW EXECUTE FUNCTION public.photo_vouchers_trg();

-- 7) Leitura ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.photo_imovel_label(_c public.exclusive_captures) RETURNS text
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT nullif(concat_ws(' · ',
    nullif(btrim(_c.form_data->'imovel'->>'tipo_imovel'), ''),
    nullif(btrim(concat_ws(', ', nullif(btrim(_c.form_data->'imovel'->>'endereco'), ''),
                                 nullif(btrim(_c.form_data->'imovel'->>'complemento'), ''))), ''),
    nullif(btrim(_c.form_data->'imovel'->>'bairro'), '')), '')
$$;
REVOKE ALL ON FUNCTION public.photo_imovel_label(public.exclusive_captures) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_status_voucher(_v public.photo_vouchers) RETURNS text
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _v.status = 'disponivel' AND _v.vence_em < public.photo_hoje() THEN 'vencido' ELSE _v.status END
$$;
REVOKE ALL ON FUNCTION public.photo_status_voucher(public.photo_vouchers) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_bloqueado_ate(_org uuid, _corretor uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p.bloqueado_ate FROM public.photo_penalidades p
   WHERE p.organization_id = _org AND p.corretor_id = _corretor AND p.bloqueado_ate > now()
$$;
REVOKE ALL ON FUNCTION public.photo_bloqueado_ate(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- REGRA ISOLADA (Denis 04/11: só o corretor conta): quem desmarca e conta para a penalidade do corretor.
-- Hoje só a desmarcação feita pelo próprio corretor. Para contar também a do fotógrafo/admin, troque para
-- ARRAY['corretor','fotografo','admin'] (CREATE OR REPLACE desta função; nada mais muda). Recusa nunca conta.
CREATE OR REPLACE FUNCTION public.photo_papeis_que_penalizam() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$ SELECT ARRAY['corretor']::text[] $$;
REVOKE ALL ON FUNCTION public.photo_papeis_que_penalizam() FROM PUBLIC, anon, authenticated;

-- Desmarcações que contam para a penalidade (30 dias, depois do último bloqueio).
CREATE OR REPLACE FUNCTION public.photo_desmarcacoes_30d(_org uuid, _corretor uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT count(*)::int FROM public.photo_sessions s
   WHERE s.organization_id = _org AND s.corretor_id = _corretor
     AND s.status = 'cancelada' AND s.cancelada_papel = ANY (public.photo_papeis_que_penalizam())
     AND s.cancelada_em > now() - interval '30 days'
     AND s.cancelada_em > coalesce((SELECT p.bloqueado_desde FROM public.photo_penalidades p
                                     WHERE p.organization_id = _org AND p.corretor_id = _corretor), '-infinity')
$$;
REVOKE ALL ON FUNCTION public.photo_desmarcacoes_30d(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_sessao_json(_s public.photo_sessions) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object(
    'id', _s.id, 'inicio', _s.inicio, 'fim', _s.fim, 'status', _s.status, 'paga_por', _s.paga_por,
    'voucher_id', _s.voucher_id, 'capture_id', _s.capture_id, 'corretor_id', _s.corretor_id,
    'corretor_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _s.corretor_id),
    'corretor_telefone', (SELECT p.telefone FROM public.profiles p WHERE p.id = _s.corretor_id),
    'imovel', (SELECT public.photo_imovel_label(c) FROM public.exclusive_captures c WHERE c.id = _s.capture_id),
    'endereco', (SELECT nullif(concat_ws(', ', nullif(btrim(c.form_data->'imovel'->>'endereco'), ''),
                    nullif(btrim(c.form_data->'imovel'->>'complemento'), ''),
                    nullif(btrim(c.form_data->'imovel'->>'bairro'), ''),
                    nullif(btrim(c.form_data->'imovel'->>'municipio'), '')), '')
                  FROM public.exclusive_captures c WHERE c.id = _s.capture_id),
    'valor_congelado', _s.valor_congelado, 'cobranca_status', _s.cobranca_status, 'cobrado_em', _s.cobrado_em,
    'feita_em', _s.feita_em, 'cancelada_em', _s.cancelada_em, 'cancelada_papel', _s.cancelada_papel,
    'motivo_cancelamento', _s.motivo_cancelamento)
$$;
REVOKE ALL ON FUNCTION public.photo_sessao_json(public.photo_sessions) FROM PUBLIC, anon, authenticated;

-- Resumo de quem está logado: papéis, configuração, progresso do mês, vouchers, imóveis, bloqueio.
-- Confere o mês atual (idempotente): quem bateu a meta antes de ligar o módulo recebe ao abrir.
CREATE OR REPLACE FUNCTION public.photo_meu_resumo() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.photo_org_ativa();
  _hoje date := public.photo_hoje();
  _mes date := date_trunc('month', public.photo_hoje())::date;
  _cfg public.photo_settings;
  _assinadas int;
BEGIN
  PERFORM public.photo_vouchers_conferir(_org, _uid, _mes);
  SELECT * INTO _cfg FROM public.photo_settings WHERE organization_id = _org;
  _assinadas := public.photo_captacoes_assinadas(_org, _uid, _mes);
  RETURN jsonb_build_object(
    'hoje', _hoje,
    'eh_fotografo', public.photo_eh_fotografo(_org, _uid),
    'eh_admin', public.photo_eh_admin(_uid),
    'eh_financeiro', public.photo_eh_financeiro(_uid),
    'fotografo_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _cfg.fotografo_id),
    'fotografo_id', _cfg.fotografo_id,
    'valor_sessao', coalesce(_cfg.valor_sessao, 0),
    'mes', jsonb_build_object('mes_ref', _mes, 'assinadas', _assinadas, 'meta', 3,
      'faltam', greatest(3 - _assinadas, 0),
      'vence_em', public.photo_voucher_vencimento(_mes)),
    'bloqueado_ate', public.photo_bloqueado_ate(_org, _uid),
    'desmarcacoes_30d', public.photo_desmarcacoes_30d(_org, _uid),
    'vouchers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'mes_ref', v.mes_ref, 'seq', v.seq, 'gerado_em', v.gerado_em, 'vence_em', v.vence_em,
        'status', public.photo_status_voucher(v),
        'sessao_id', (SELECT s.id FROM public.photo_sessions s WHERE s.voucher_id = v.id AND s.status NOT IN ('cancelada', 'recusada')),
        'imovel', (SELECT public.photo_imovel_label(c) FROM public.photo_sessions s
                     JOIN public.exclusive_captures c ON c.id = s.capture_id
                    WHERE s.voucher_id = v.id AND s.status NOT IN ('cancelada', 'recusada')))
        ORDER BY v.vence_em, v.mes_ref, v.seq)
      FROM public.photo_vouchers v WHERE v.organization_id = _org AND v.corretor_id = _uid), '[]'::jsonb),
    'imoveis', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'imovel', coalesce(public.photo_imovel_label(c), 'Imóvel sem endereço'),
        'tem_sessao_aberta', EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = c.id AND s.status IN ('aguardando', 'confirmada')),
        'voucher_ja_usado', EXISTS (SELECT 1 FROM public.photo_sessions s
                                     WHERE s.capture_id = c.id AND s.voucher_id IS NOT NULL AND s.status NOT IN ('cancelada', 'recusada')))
        ORDER BY c.signed_on DESC NULLS LAST, c.created_at DESC)
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND (c.captor_id = _uid OR c.captador_original_id = _uid)
       AND c.status = 'aprovada' AND c.discarded_at IS NULL AND c.archived_at IS NULL), '[]'::jsonb),
    'minhas_sessoes', coalesce((SELECT jsonb_agg(public.photo_sessao_json(s) ORDER BY s.inicio DESC)
      FROM public.photo_sessions s WHERE s.organization_id = _org AND s.corretor_id = _uid
       AND (s.status IN ('aguardando', 'confirmada') OR s.inicio > now() - interval '60 days')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.photo_meu_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_meu_resumo() TO authenticated;

-- Horários livres (início a cada 30 min) entre _de e _ate (datas de São Paulo, até 62 dias).
CREATE OR REPLACE FUNCTION public.photo_horarios_livres(_de date, _ate date) RETURNS SETOF timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.photo_org_ativa(); _fot uuid;
BEGIN
  IF _de IS NULL OR _ate IS NULL OR _ate < _de OR _ate - _de > 62 THEN
    RAISE EXCEPTION 'Periodo invalido' USING ERRCODE = '22023';
  END IF;
  SELECT fotografo_id INTO _fot FROM public.photo_settings WHERE organization_id = _org;
  IF _fot IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT DISTINCT c.t FROM public.photo_agenda w
   CROSS JOIN LATERAL generate_series(w.inicio, w.fim - interval '2 hours', interval '30 minutes') AS c(t)
   WHERE w.organization_id = _org AND w.fotografo_id = _fot AND w.tipo = 'livre'
     AND w.fim > ((_de::timestamp) AT TIME ZONE 'America/Sao_Paulo')
     AND w.inicio < (((_ate + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo')
     AND (c.t AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN _de AND _ate
     AND c.t > now()
     AND NOT EXISTS (SELECT 1 FROM public.photo_agenda b
                      WHERE b.organization_id = _org AND b.tipo = 'bloqueio'
                        AND tstzrange(b.inicio, b.fim) && tstzrange(c.t, c.t + interval '2 hours'))
     AND NOT EXISTS (SELECT 1 FROM public.photo_sessions s
                      WHERE s.organization_id = _org AND s.status NOT IN ('cancelada', 'recusada')
                        AND tstzrange(s.inicio, s.ocupa_ate) && tstzrange(c.t, c.t + interval '3 hours'))
   ORDER BY c.t;
END $$;
REVOKE ALL ON FUNCTION public.photo_horarios_livres(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_horarios_livres(date, date) TO authenticated;

-- Agenda do fotógrafo (fotógrafo e admin): faixas e sessões do período, com corretor, imóvel e endereço.
CREATE OR REPLACE FUNCTION public.photo_agenda_listar(_de date, _ate date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa();
  _ini timestamptz; _fim timestamptz;
BEGIN
  IF NOT (public.photo_eh_fotografo(_org, _uid) OR public.photo_eh_admin(_uid)) THEN
    RAISE EXCEPTION 'Apenas o fotografo ou o admin veem a agenda' USING ERRCODE = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate < _de OR _ate - _de > 400 THEN
    RAISE EXCEPTION 'Periodo invalido' USING ERRCODE = '22023';
  END IF;
  _ini := (_de::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  _fim := ((_ate + 1)::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  RETURN jsonb_build_object(
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'tipo', a.tipo, 'inicio', a.inicio, 'fim', a.fim)
        ORDER BY a.inicio) FROM public.photo_agenda a
       WHERE a.organization_id = _org AND a.fim > _ini AND a.inicio < _fim), '[]'::jsonb),
    'sessoes', coalesce((SELECT jsonb_agg(public.photo_sessao_json(s) ORDER BY s.inicio)
       FROM public.photo_sessions s WHERE s.organization_id = _org AND s.inicio >= _ini AND s.inicio < _fim), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.photo_agenda_listar(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_agenda_listar(date, date) TO authenticated;

-- Financeiro do mês (data da sessão em São Paulo): "RE/MAX paga" (com voucher, feitas) e "A cobrar".
CREATE OR REPLACE FUNCTION public.photo_financeiro(_mes date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa();
  _ini timestamptz; _fim timestamptz;
BEGIN
  IF NOT public.photo_eh_financeiro(_uid) THEN
    RAISE EXCEPTION 'Apenas o Financeiro ou o admin' USING ERRCODE = '42501';
  END IF;
  IF _mes IS NULL THEN RAISE EXCEPTION 'Mes invalido' USING ERRCODE = '22023'; END IF;
  _ini := (date_trunc('month', _mes)::date::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  _fim := ((date_trunc('month', _mes) + interval '1 month')::date::timestamp) AT TIME ZONE 'America/Sao_Paulo';
  RETURN jsonb_build_object(
    'mes_ref', date_trunc('month', _mes)::date,
    'remax', coalesce((SELECT jsonb_agg(public.photo_sessao_json(s) ORDER BY s.inicio)
       FROM public.photo_sessions s WHERE s.organization_id = _org AND s.status = 'feita'
        AND s.paga_por = 'imobiliaria' AND s.inicio >= _ini AND s.inicio < _fim), '[]'::jsonb),
    'remax_total', coalesce((SELECT sum(s.valor_congelado) FROM public.photo_sessions s
       WHERE s.organization_id = _org AND s.status = 'feita' AND s.paga_por = 'imobiliaria'
         AND s.inicio >= _ini AND s.inicio < _fim), 0),
    'a_cobrar', coalesce((SELECT jsonb_agg(public.photo_sessao_json(s) ORDER BY s.cobranca_status, s.inicio)
       FROM public.photo_sessions s WHERE s.organization_id = _org AND s.status = 'feita'
        AND s.paga_por = 'corretor' AND s.inicio >= _ini AND s.inicio < _fim), '[]'::jsonb),
    'a_cobrar_total', coalesce((SELECT sum(s.valor_congelado) FROM public.photo_sessions s
       WHERE s.organization_id = _org AND s.status = 'feita' AND s.paga_por = 'corretor'
         AND s.cobranca_status = 'a_cobrar' AND s.inicio >= _ini AND s.inicio < _fim), 0));
END $$;
REVOKE ALL ON FUNCTION public.photo_financeiro(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_financeiro(date) TO authenticated;

-- Configurações (admin): staff da imobiliária que pode ser fotógrafo.
CREATE OR REPLACE FUNCTION public.photo_staff_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.photo_org_ativa();
BEGIN
  IF NOT public.photo_eh_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o admin configura' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome)
    FROM public.profiles p
   WHERE p.organization_id = _org AND p.ativo IS TRUE
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'staff')), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.photo_staff_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_staff_listar() TO authenticated;

-- 8) Escrita ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.photo_configurar(_fotografo uuid, _valor numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa();
BEGIN
  IF NOT public.photo_eh_admin(_uid) THEN RAISE EXCEPTION 'Apenas o admin configura' USING ERRCODE = '42501'; END IF;
  IF _valor IS NULL OR _valor < 0 OR _valor > 100000 THEN
    RAISE EXCEPTION 'Valor por sessao invalido' USING ERRCODE = '22023';
  END IF;
  IF _fotografo IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = _fotografo AND p.organization_id = _org AND p.ativo IS TRUE
          AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'staff')) THEN
    RAISE EXCEPTION 'O fotografo precisa ser um usuario staff ativo desta imobiliaria' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.photo_settings (organization_id, fotografo_id, valor_sessao, updated_at, updated_by)
  VALUES (_org, _fotografo, round(_valor, 2), now(), _uid)
  ON CONFLICT (organization_id) DO UPDATE
    SET fotografo_id = EXCLUDED.fotografo_id, valor_sessao = EXCLUDED.valor_sessao, updated_at = now(), updated_by = _uid;
  INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
  VALUES (_org, _uid, 'configuracao', jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2)));
  RETURN jsonb_build_object('fotografo_id', _fotografo, 'valor_sessao', round(_valor, 2));
END $$;
REVOKE ALL ON FUNCTION public.photo_configurar(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_configurar(uuid, numeric) TO authenticated;

-- Fotógrafo (ou admin) libera ('livre') ou bloqueia ('bloqueio') uma faixa.
CREATE OR REPLACE FUNCTION public.photo_faixa_salvar(_tipo text, _inicio timestamptz, _fim timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa(); _fot uuid; _id uuid;
BEGIN
  IF NOT (public.photo_eh_fotografo(_org, _uid) OR public.photo_eh_admin(_uid)) THEN
    RAISE EXCEPTION 'Apenas o fotografo ou o admin mexem na agenda' USING ERRCODE = '42501';
  END IF;
  SELECT fotografo_id INTO _fot FROM public.photo_settings WHERE organization_id = _org;
  IF _fot IS NULL THEN RAISE EXCEPTION 'Escolha o fotografo nas configuracoes' USING ERRCODE = '22023'; END IF;
  IF _tipo IS NULL OR _tipo NOT IN ('livre', 'bloqueio') OR _inicio IS NULL OR _fim IS NULL
     OR _fim <= _inicio OR _fim - _inicio > interval '16 hours' THEN
    RAISE EXCEPTION 'Faixa invalida' USING ERRCODE = '22023';
  END IF;
  IF _fim <= now() THEN RAISE EXCEPTION 'Faixa no passado' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.photo_agenda (organization_id, fotografo_id, tipo, inicio, fim, criado_por)
  VALUES (_org, _fot, _tipo, _inicio, _fim, _uid) RETURNING id INTO _id;
  INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
  VALUES (_org, _uid, 'faixa_' || _tipo, jsonb_build_object('faixa_id', _id, 'inicio', _inicio, 'fim', _fim));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.photo_faixa_salvar(text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_faixa_salvar(text, timestamptz, timestamptz) TO authenticated;

-- Remove uma faixa. Sessões já marcadas continuam (o fotógrafo desmarca se precisar).
CREATE OR REPLACE FUNCTION public.photo_faixa_remover(_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa();
BEGIN
  IF NOT (public.photo_eh_fotografo(_org, _uid) OR public.photo_eh_admin(_uid)) THEN
    RAISE EXCEPTION 'Apenas o fotografo ou o admin mexem na agenda' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.photo_agenda WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faixa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.photo_history (organization_id, ator_id, acao, payload)
  VALUES (_org, _uid, 'faixa_removida', jsonb_build_object('faixa_id', _id));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.photo_faixa_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_faixa_remover(uuid) TO authenticated;

-- Aviso no sino (gravado no banco, na mesma transação da ação). O WhatsApp do mesmo evento é enviado
-- depois pelo servidor (src/lib/photo-notifications.functions.ts), com o mesmo canal ZionTalk das vendas,
-- 1 mensagem por destinatário do evento, conferindo antes este photo_history.
CREATE OR REPLACE FUNCTION public.photo_avisar(_org uuid, _para uuid, _capture uuid, _tipo text, _titulo text, _msg text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _para IS NULL OR _para = auth.uid() THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, organization_id, exclusive_capture_id, tipo, titulo, mensagem)
  VALUES (_para, _org, _capture, _tipo, _titulo, _msg);
END $$;
REVOKE ALL ON FUNCTION public.photo_avisar(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_quando(_t timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT to_char(_t AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
$$;
REVOKE ALL ON FUNCTION public.photo_quando(timestamptz) FROM PUBLIC, anon, authenticated;

-- Texto único do aviso por evento (sino e WhatsApp usam o mesmo).
CREATE OR REPLACE FUNCTION public.photo_texto_aviso(_s public.photo_sessions, _evento text, _papel text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE _evento
    WHEN 'marcada' THEN jsonb_build_object('titulo', 'Nova sessão de fotos para confirmar', 'mensagem',
      coalesce((SELECT nome FROM public.profiles WHERE id = _s.corretor_id), 'Um corretor') || ' pediu fotos para '
      || public.photo_quando(_s.inicio)
      || coalesce(' — ' || (SELECT public.photo_imovel_label(c) FROM public.exclusive_captures c WHERE c.id = _s.capture_id), '')
      || CASE WHEN _s.voucher_id IS NULL THEN ' (sem voucher)' ELSE ' (com voucher)' END || '. Confirme ou recuse na sua agenda.')
    WHEN 'confirmada' THEN jsonb_build_object('titulo', 'Sessão de fotos confirmada', 'mensagem',
      'O fotógrafo confirmou sua sessão de ' || public.photo_quando(_s.inicio) || '.')
    WHEN 'recusada' THEN jsonb_build_object('titulo', 'Sessão de fotos recusada', 'mensagem',
      'O fotógrafo recusou sua sessão de ' || public.photo_quando(_s.inicio)
      || coalesce(' (motivo: ' || _s.motivo_cancelamento || ')', '')
      || CASE WHEN _s.voucher_id IS NOT NULL THEN '. O voucher voltou para você.' ELSE '.' END
      || ' Escolha outro horário.')
    WHEN 'desmarcada' THEN jsonb_build_object('titulo', 'Sessão de fotos desmarcada', 'mensagem',
      'A sessão de ' || public.photo_quando(_s.inicio) || ' foi desmarcada'
      || CASE _papel WHEN 'fotografo' THEN ' pelo fotógrafo' WHEN 'admin' THEN ' pela administração'
                     ELSE ' pelo corretor' END
      || coalesce(' (motivo: ' || _s.motivo_cancelamento || ')', '') || '.')
  END
$$;
REVOKE ALL ON FUNCTION public.photo_texto_aviso(public.photo_sessions, text, text) FROM PUBLIC, anon, authenticated;

-- Destinatários de cada evento (uma regra só, usada pelo sino e pelo WhatsApp).
-- marcada → fotógrafo; confirmada/recusada → corretor; desmarcada → fotógrafo e corretor (menos quem agiu).
CREATE OR REPLACE FUNCTION public.photo_destinos_aviso(_s public.photo_sessions, _evento text) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE _evento
    WHEN 'marcada' THEN ARRAY[_s.fotografo_id]
    WHEN 'confirmada' THEN ARRAY[_s.corretor_id]
    WHEN 'recusada' THEN ARRAY[_s.corretor_id]
    WHEN 'desmarcada' THEN ARRAY[_s.fotografo_id, _s.corretor_id]
    ELSE ARRAY[]::uuid[] END
$$;
REVOKE ALL ON FUNCTION public.photo_destinos_aviso(public.photo_sessions, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.photo_avisar_evento(_s public.photo_sessions, _evento text, _papel text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t jsonb := public.photo_texto_aviso(_s, _evento, _papel); _u uuid;
BEGIN
  FOREACH _u IN ARRAY public.photo_destinos_aviso(_s, _evento) LOOP
    PERFORM public.photo_avisar(_s.organization_id, _u, _s.capture_id, 'foto_' || _evento, _t->>'titulo', _t->>'mensagem');
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.photo_avisar_evento(public.photo_sessions, text, text) FROM PUBLIC, anon, authenticated;

-- Corretor pede uma sessão de 2 h no próprio imóvel, com voucher (imobiliária paga) ou sem (corretor paga).
-- Nasce "aguardando" a confirmação do fotógrafo e já ocupa o horário (2 h + 1 h de intervalo).
CREATE OR REPLACE FUNCTION public.photo_agendar(_capture uuid, _inicio timestamptz, _voucher uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.photo_org_ativa();
  _fot uuid;
  _cap public.exclusive_captures;
  _v public.photo_vouchers;
  _s public.photo_sessions;
  _bloq timestamptz;
  _fim timestamptz;
BEGIN
  SELECT fotografo_id INTO _fot FROM public.photo_settings WHERE organization_id = _org;
  IF _fot IS NULL THEN RAISE EXCEPTION 'A imobiliaria ainda nao escolheu o fotografo' USING ERRCODE = '22023'; END IF;
  _bloq := public.photo_bloqueado_ate(_org, _uid);
  IF _bloq IS NOT NULL THEN
    RAISE EXCEPTION 'Agendamento bloqueado ate % (3 desmarcacoes em 30 dias)',
      to_char(_bloq AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _inicio <= now() THEN RAISE EXCEPTION 'Escolha um horario futuro' USING ERRCODE = '22023'; END IF;
  _fim := _inicio + interval '2 hours';

  SELECT * INTO _cap FROM public.exclusive_captures WHERE id = _capture AND organization_id = _org FOR SHARE;
  -- coalesce: com captador_original_id nulo, "x = NULL" daria NULL e o IF deixaria passar.
  IF _cap.id IS NULL OR NOT coalesce(_cap.captor_id = _uid OR _cap.captador_original_id = _uid, false) THEN
    RAISE EXCEPTION 'So e possivel agendar fotos de imovel captado por voce' USING ERRCODE = '42501';
  END IF;
  IF _cap.status <> 'aprovada' OR _cap.discarded_at IS NOT NULL OR _cap.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'A captacao precisa estar aprovada (assinada) e ativa' USING ERRCODE = '22023';
  END IF;

  -- Horário dentro de uma faixa livre do fotógrafo e fora de bloqueios.
  IF NOT EXISTS (SELECT 1 FROM public.photo_agenda w WHERE w.organization_id = _org AND w.fotografo_id = _fot
                    AND w.tipo = 'livre' AND w.inicio <= _inicio AND w.fim >= _fim)
     OR EXISTS (SELECT 1 FROM public.photo_agenda b WHERE b.organization_id = _org AND b.tipo = 'bloqueio'
                    AND tstzrange(b.inicio, b.fim) && tstzrange(_inicio, _fim)) THEN
    RAISE EXCEPTION 'Horario fora da agenda liberada do fotografo' USING ERRCODE = '22023';
  END IF;

  IF _voucher IS NOT NULL THEN
    SELECT * INTO _v FROM public.photo_vouchers WHERE id = _voucher AND organization_id = _org FOR UPDATE;
    IF _v.id IS NULL OR _v.corretor_id <> _uid THEN
      RAISE EXCEPTION 'Voucher nao encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF _v.status <> 'disponivel' THEN RAISE EXCEPTION 'Este voucher nao esta disponivel' USING ERRCODE = '22023'; END IF;
    IF _v.vence_em < public.photo_hoje() OR (_inicio AT TIME ZONE 'America/Sao_Paulo')::date > _v.vence_em THEN
      RAISE EXCEPTION 'A sessao precisa ser ate % (validade do voucher)', to_char(_v.vence_em, 'DD/MM/YYYY')
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = _capture
                  AND s.voucher_id IS NOT NULL AND s.status NOT IN ('cancelada', 'recusada')) THEN
      RAISE EXCEPTION 'Este imovel ja usou um voucher (1 por imovel)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = _capture AND s.status IN ('aguardando', 'confirmada')) THEN
    RAISE EXCEPTION 'Este imovel ja tem uma sessao marcada' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.photo_sessions (organization_id, fotografo_id, corretor_id, capture_id, voucher_id,
      inicio, fim, ocupa_ate, paga_por, created_by)
    VALUES (_org, _fot, _uid, _capture, _voucher, _inicio, _fim, _fim + interval '1 hour',
      CASE WHEN _voucher IS NULL THEN 'corretor' ELSE 'imobiliaria' END, _uid)
    RETURNING * INTO _s;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'Horario indisponivel (sessao de 2 h + 1 h de intervalo)' USING ERRCODE = '23P01';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Imovel ou voucher ja usado em outra sessao' USING ERRCODE = '23505';
  END;
  IF _voucher IS NOT NULL THEN
    UPDATE public.photo_vouchers SET status = 'agendado' WHERE id = _voucher;
  END IF;
  INSERT INTO public.photo_history (organization_id, session_id, voucher_id, ator_id, acao, payload)
  VALUES (_org, _s.id, _voucher, _uid, 'marcada', jsonb_build_object('inicio', _inicio, 'capture_id', _capture));
  PERFORM public.photo_avisar_evento(_s, 'marcada');
  RETURN _s.id;
END $$;
REVOKE ALL ON FUNCTION public.photo_agendar(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_agendar(uuid, timestamptz, uuid) TO authenticated;

-- Fotógrafo (ou admin) confirma ou recusa uma sessão "aguardando".
-- Recusar devolve o voucher, libera o horário e NÃO conta para a penalidade do corretor (confirmado por Denis
-- 04/11: a recusa nunca entra em photo_desmarcacoes_30d porque o status é 'recusada').
CREATE OR REPLACE FUNCTION public.photo_responder(_session uuid, _confirmar boolean, _motivo text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa(); _s public.photo_sessions; _papel text;
BEGIN
  IF public.photo_eh_admin(_uid) THEN _papel := 'admin';
  ELSIF public.photo_eh_fotografo(_org, _uid) THEN _papel := 'fotografo';
  ELSE RAISE EXCEPTION 'Apenas o fotografo ou o admin confirmam' USING ERRCODE = '42501';
  END IF;
  IF _confirmar IS NULL THEN RAISE EXCEPTION 'Resposta invalida' USING ERRCODE = '22023'; END IF;
  IF _motivo IS NOT NULL AND char_length(_motivo) > 300 THEN RAISE EXCEPTION 'Motivo muito longo' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _s FROM public.photo_sessions WHERE id = _session AND organization_id = _org FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Sessao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _s.status <> 'aguardando' THEN RAISE EXCEPTION 'So sessoes aguardando confirmacao' USING ERRCODE = '22023'; END IF;
  IF _confirmar THEN
    UPDATE public.photo_sessions SET status = 'confirmada', confirmada_em = now(), confirmada_por = _uid
     WHERE id = _session RETURNING * INTO _s;
  ELSE
    UPDATE public.photo_sessions SET status = 'recusada', cancelada_em = now(), cancelada_por = _uid,
      cancelada_papel = _papel, motivo_cancelamento = nullif(btrim(_motivo), '')
     WHERE id = _session RETURNING * INTO _s;
    IF _s.voucher_id IS NOT NULL THEN
      UPDATE public.photo_vouchers SET status = 'disponivel' WHERE id = _s.voucher_id AND status = 'agendado';
    END IF;
  END IF;
  INSERT INTO public.photo_history (organization_id, session_id, voucher_id, ator_id, acao, payload)
  VALUES (_org, _session, _s.voucher_id, _uid, CASE WHEN _confirmar THEN 'confirmada' ELSE 'recusada' END,
    jsonb_build_object('papel', _papel));
  PERFORM public.photo_avisar_evento(_s, CASE WHEN _confirmar THEN 'confirmada' ELSE 'recusada' END, _papel);
  RETURN _s.status;
END $$;
REVOKE ALL ON FUNCTION public.photo_responder(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_responder(uuid, boolean, text) TO authenticated;

-- Desmarca (aguardando ou confirmada). Conta para a penalidade conforme photo_papeis_que_penalizam().
CREATE OR REPLACE FUNCTION public.photo_desmarcar(_session uuid, _motivo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.photo_org_ativa();
  _s public.photo_sessions;
  _papel text;
  _qtd int := 0;
  _bloq timestamptz;
BEGIN
  SELECT * INTO _s FROM public.photo_sessions WHERE id = _session AND organization_id = _org FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Sessao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  -- O papel vem de quem está agindo sobre a sessão: o próprio corretor desmarcando a sua é "corretor",
  -- mesmo que também seja admin.
  IF _s.corretor_id = _uid THEN _papel := 'corretor';
  ELSIF public.photo_eh_admin(_uid) THEN _papel := 'admin';
  ELSIF public.photo_eh_fotografo(_org, _uid) THEN _papel := 'fotografo';
  ELSE RAISE EXCEPTION 'Sem permissao para desmarcar' USING ERRCODE = '42501';
  END IF;
  IF _s.status NOT IN ('aguardando', 'confirmada') THEN
    RAISE EXCEPTION 'So sessoes marcadas podem ser desmarcadas' USING ERRCODE = '22023';
  END IF;
  IF _motivo IS NOT NULL AND char_length(_motivo) > 300 THEN
    RAISE EXCEPTION 'Motivo muito longo' USING ERRCODE = '22023';
  END IF;

  UPDATE public.photo_sessions SET status = 'cancelada', cancelada_em = now(), cancelada_por = _uid,
    cancelada_papel = _papel, motivo_cancelamento = nullif(btrim(_motivo), '')
   WHERE id = _session RETURNING * INTO _s;
  IF _s.voucher_id IS NOT NULL THEN
    UPDATE public.photo_vouchers SET status = 'disponivel' WHERE id = _s.voucher_id AND status = 'agendado';
  END IF;

  IF _papel = ANY (public.photo_papeis_que_penalizam()) THEN
    -- Trava por corretor: duas desmarcações simultâneas não escapam da contagem.
    PERFORM pg_advisory_xact_lock(hashtextextended('photo_penalidade:' || _org || ':' || _s.corretor_id, 0));
    _qtd := public.photo_desmarcacoes_30d(_org, _s.corretor_id);
    IF _qtd >= 3 THEN
      _bloq := now() + interval '7 days';
      INSERT INTO public.photo_penalidades (organization_id, corretor_id, bloqueado_desde, bloqueado_ate)
      VALUES (_org, _s.corretor_id, now(), _bloq)
      ON CONFLICT (organization_id, corretor_id) DO UPDATE
        SET bloqueado_desde = EXCLUDED.bloqueado_desde, bloqueado_ate = EXCLUDED.bloqueado_ate;
    END IF;
  END IF;

  INSERT INTO public.photo_history (organization_id, session_id, voucher_id, ator_id, acao, payload)
  VALUES (_org, _session, _s.voucher_id, _uid, 'desmarcada',
    jsonb_build_object('papel', _papel, 'desmarcacoes_30d', _qtd, 'bloqueado_ate', _bloq));
  PERFORM public.photo_avisar_evento(_s, 'desmarcada', _papel);
  RETURN jsonb_build_object('papel', _papel, 'desmarcacoes_30d', _qtd, 'bloqueado_ate', _bloq);
END $$;
REVOKE ALL ON FUNCTION public.photo_desmarcar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_desmarcar(uuid, text) TO authenticated;

-- Dados do aviso de WhatsApp para o servidor (photo-notifications.functions.ts). Só devolve algo se a
-- ÚLTIMA ação da sessão for este evento, feita por quem chama há no máximo 2 minutos (evita aviso
-- forjado ou repetido). Os destinatários e o texto são os mesmos do sino.
CREATE OR REPLACE FUNCTION public.photo_aviso_para_envio(_session uuid, _evento text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa(); _s public.photo_sessions;
  _h public.photo_history; _papel text; _t jsonb;
BEGIN
  IF _evento IS NULL OR _evento NOT IN ('marcada', 'confirmada', 'recusada', 'desmarcada') THEN
    RAISE EXCEPTION 'Evento invalido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _s FROM public.photo_sessions WHERE id = _session AND organization_id = _org;
  IF _s.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _h FROM public.photo_history WHERE session_id = _session AND organization_id = _org
   ORDER BY id DESC LIMIT 1;
  IF _h.id IS NULL OR _h.acao <> _evento OR _h.ator_id IS DISTINCT FROM _uid
     OR _h.created_at < now() - interval '2 minutes' THEN
    RETURN NULL;
  END IF;
  _papel := _h.payload->>'papel';
  _t := public.photo_texto_aviso(_s, _evento, _papel);
  RETURN jsonb_build_object('organization_id', _org, 'capture_id', _s.capture_id, 'tipo', 'foto_' || _evento,
    'titulo', _t->>'titulo', 'mensagem', _t->>'mensagem',
    'destinos', coalesce((SELECT jsonb_agg(d) FROM unnest(public.photo_destinos_aviso(_s, _evento)) d
                           WHERE d IS DISTINCT FROM _uid), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.photo_aviso_para_envio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_aviso_para_envio(uuid, text) TO authenticated;

-- Fotógrafo (ou admin) marca como feita: congela o valor; voucher vira "usado"; sem voucher → "a cobrar".
CREATE OR REPLACE FUNCTION public.photo_marcar_feita(_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa(); _s public.photo_sessions; _valor numeric;
BEGIN
  IF NOT (public.photo_eh_fotografo(_org, _uid) OR public.photo_eh_admin(_uid)) THEN
    RAISE EXCEPTION 'Apenas o fotografo ou o admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.photo_sessions WHERE id = _session AND organization_id = _org FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Sessao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _s.status NOT IN ('aguardando', 'confirmada') THEN RAISE EXCEPTION 'So sessoes marcadas podem virar feitas' USING ERRCODE = '22023'; END IF;
  IF _s.inicio > now() THEN RAISE EXCEPTION 'A sessao ainda nao comecou' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(valor_sessao, 0) INTO _valor FROM public.photo_settings WHERE organization_id = _org;
  UPDATE public.photo_sessions SET status = 'feita', feita_em = now(), feita_por = _uid,
    valor_congelado = coalesce(_valor, 0),
    cobranca_status = CASE WHEN _s.paga_por = 'corretor' THEN 'a_cobrar' END
   WHERE id = _session;
  IF _s.voucher_id IS NOT NULL THEN UPDATE public.photo_vouchers SET status = 'usado' WHERE id = _s.voucher_id; END IF;
  INSERT INTO public.photo_history (organization_id, session_id, voucher_id, ator_id, acao, payload)
  VALUES (_org, _session, _s.voucher_id, _uid, 'feita', jsonb_build_object('valor', coalesce(_valor, 0)));
  RETURN jsonb_build_object('valor_congelado', coalesce(_valor, 0));
END $$;
REVOKE ALL ON FUNCTION public.photo_marcar_feita(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_marcar_feita(uuid) TO authenticated;

-- Financeiro marca a cobrança por telefone como feita (ou volta para "a cobrar").
CREATE OR REPLACE FUNCTION public.photo_marcar_cobrado(_session uuid, _cobrado boolean DEFAULT true) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.photo_org_ativa(); _s public.photo_sessions;
BEGIN
  IF NOT public.photo_eh_financeiro(_uid) THEN RAISE EXCEPTION 'Apenas o Financeiro ou o admin' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _s FROM public.photo_sessions WHERE id = _session AND organization_id = _org FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION 'Sessao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _s.status <> 'feita' OR _s.paga_por <> 'corretor' THEN
    RAISE EXCEPTION 'So sessoes feitas sem voucher entram na cobranca' USING ERRCODE = '22023';
  END IF;
  UPDATE public.photo_sessions SET
    cobranca_status = CASE WHEN coalesce(_cobrado, true) THEN 'cobrado' ELSE 'a_cobrar' END,
    cobrado_em = CASE WHEN coalesce(_cobrado, true) THEN now() END,
    cobrado_por = CASE WHEN coalesce(_cobrado, true) THEN _uid END
   WHERE id = _session;
  INSERT INTO public.photo_history (organization_id, session_id, ator_id, acao, payload)
  VALUES (_org, _session, _uid, CASE WHEN coalesce(_cobrado, true) THEN 'cobrado' ELSE 'cobranca_reaberta' END, '{}'::jsonb);
  RETURN coalesce(_cobrado, true);
END $$;
REVOKE ALL ON FUNCTION public.photo_marcar_cobrado(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_marcar_cobrado(uuid, boolean) TO authenticated;

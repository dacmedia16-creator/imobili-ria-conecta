-- Leads — piloto P1 (card t_2472761a; "sim" de Denis em 24/10/2026, tópico 6238).
-- Plano: card t_5fe4e90b (substituir Lais + C2S), piloto só na imobiliária "ZZ Teste Provisionamento".
--
-- O que esta migration faz (ADITIVA; rollback em docs/sql/rollback/20261025120000_leads_piloto.rollback.sql):
-- 1) Módulo novo "leads" (organization_modules). Nasce DESLIGADO em todas as imobiliárias.
--    Desligado: menu some, rota bloqueia, o banco não entrega nada e as RPCs recusam.
-- 2) Tabelas: leads, lead_eventos (linha do tempo), lead_motivos_perda, lead_config.
--    Todas com organization_id NOT NULL, FK composta (id, organization_id) para não misturar
--    imobiliárias, RLS por imobiliária + trava do módulo.
-- 3) Funil: novo -> em_atendimento -> visita_agendada -> proposta -> ganho | perdido.
--    "perdido" exige motivo. Ganho/perdido só reabre por gestor/admin.
-- 4) Vínculo lead -> captação (exclusive_captures) -> captador (D4: o dono da captação recebe o lead).
--    Aqui só GUARDA o vínculo e o captador; a regra de distribuição/rodízio e o prazo de aceite
--    (D3 = 30 min, em lead_config) são da fase P3.
-- 5) Escrita SÓ por RPC (SECURITY DEFINER, valida usuário, papel, imobiliária e módulo).
--    authenticated só tem SELECT nas tabelas.
-- Fora do escopo (fases seguintes): rodízio/prazo (P3), formulário público/simulador (P2),
-- caixa de conversas + IA com entrada por WhatsApp REAL (P4, número a definir por Denis — D5),
-- métricas (P5). Nenhuma mensagem é enviada por esta migration.
BEGIN;

-- 1) Módulo ------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads')
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

CREATE OR REPLACE FUNCTION public.leads_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'leads'), false)
$$;
REVOKE ALL ON FUNCTION public.leads_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_enabled() TO authenticated, service_role;

-- Desligado em todas. A ZZ é ligada na publicação (P0), pelo painel Plataforma.
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'leads', false FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Tabelas ----------------------------------------------------------------------------------
-- Configuração por imobiliária (P3 usa). D3: prazo de aceite = 30 min. D4: dono da captação, depois rodízio.
CREATE TABLE IF NOT EXISTS public.lead_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  prazo_aceite_min integer NOT NULL DEFAULT 30 CHECK (prazo_aceite_min BETWEEN 1 AND 1440),
  distribuicao text NOT NULL DEFAULT 'captador_depois_rodizio'
    CHECK (distribuicao IN ('captador_depois_rodizio', 'rodizio', 'manual')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_motivos_perda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, nome)
);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  telefone text CHECK (telefone ~ '^\+?[0-9]{8,15}$'),
  email text CHECK (char_length(email) <= 160 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  origem text NOT NULL CHECK (origem IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro')),
  -- Id no sistema de origem (portal, WhatsApp...). Evita lead duplicado quando a mesma entrada chega 2x (P2/P4).
  externo_id text CHECK (char_length(externo_id) <= 200),
  mensagem text CHECK (char_length(mensagem) <= 4000),
  etapa text NOT NULL DEFAULT 'novo'
    CHECK (etapa IN ('novo', 'em_atendimento', 'visita_agendada', 'proposta', 'ganho', 'perdido')),
  etapa_em timestamptz NOT NULL DEFAULT now(),
  responsavel_id uuid,
  atribuido_em timestamptz,
  -- Imóvel de interesse (captação) e o captador dela no momento do vínculo (D4).
  capture_id uuid,
  captador_id uuid,
  cliente_id uuid,
  motivo_perda_id uuid,
  motivo_perda_obs text CHECK (char_length(motivo_perda_obs) <= 1000),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  -- FKs compostas: responsável, captação, captador, cliente e motivo têm de ser da MESMA imobiliária.
  CONSTRAINT leads_responsavel_org_fk FOREIGN KEY (responsavel_id, organization_id) REFERENCES public.profiles(id, organization_id),
  CONSTRAINT leads_captador_org_fk FOREIGN KEY (captador_id, organization_id) REFERENCES public.profiles(id, organization_id),
  CONSTRAINT leads_capture_org_fk FOREIGN KEY (capture_id, organization_id) REFERENCES public.exclusive_captures(id, organization_id) ON DELETE SET NULL (capture_id),
  CONSTRAINT leads_cliente_org_fk FOREIGN KEY (cliente_id, organization_id) REFERENCES public.clientes(id, organization_id) ON DELETE SET NULL (cliente_id),
  CONSTRAINT leads_motivo_org_fk FOREIGN KEY (motivo_perda_id, organization_id) REFERENCES public.lead_motivos_perda(id, organization_id),
  CONSTRAINT leads_perdido_tem_motivo CHECK ((etapa = 'perdido') = (motivo_perda_id IS NOT NULL)),
  CONSTRAINT leads_contato CHECK (telefone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_externo_uniq ON public.leads (organization_id, origem, externo_id)
  WHERE externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_org_etapa_idx ON public.leads (organization_id, etapa, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_org_resp_idx ON public.leads (organization_id, responsavel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_capture_idx ON public.leads (capture_id) WHERE capture_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo')),
  de text CHECK (char_length(de) <= 60),
  para text CHECK (char_length(para) <= 60),
  nota text CHECK (char_length(nota) <= 2000),
  autor_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_eventos_lead_org_fk FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.leads(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lead_eventos_lead_idx ON public.lead_eventos (lead_id, created_at);
CREATE INDEX IF NOT EXISTS lead_eventos_org_idx ON public.lead_eventos (organization_id, created_at);

-- 3) Acesso -----------------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_motivos_perda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads, public.lead_eventos, public.lead_motivos_perda, public.lead_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.leads, public.lead_eventos, public.lead_motivos_perda, public.lead_config TO authenticated;
GRANT ALL ON public.leads, public.lead_eventos, public.lead_motivos_perda, public.lead_config TO service_role;

-- Quem vê o painel inteiro da imobiliária.
CREATE OR REPLACE FUNCTION public.leads_gestor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'gestor'::public.app_role))
$$;
-- Responsáveis cujos leads o usuário vê: ele mesmo + membros das equipes que lidera (Team Leader).
CREATE OR REPLACE FUNCTION public.leads_responsaveis_visiveis() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() WHERE auth.uid() IS NOT NULL
  UNION
  SELECT tm.membro_id FROM public.team_members tm
   WHERE auth.uid() IS NOT NULL AND tm.organization_id = public.current_org_id()
     AND public.has_role(auth.uid(), 'team_leader'::public.app_role)
     AND public.leads_team_or_parent(tm.team_id, auth.uid())
$$;
REVOKE ALL ON FUNCTION public.leads_gestor(), public.leads_responsaveis_visiveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_gestor(), public.leads_responsaveis_visiveis() TO authenticated, service_role;

CREATE POLICY org_isolation ON public.leads AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.lead_eventos AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.lead_motivos_perda AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.lead_config AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY zz_mt_modulo_leads ON public.leads AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_eventos AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_motivos_perda AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_config AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));

-- Corretor vê os próprios; Team Leader, os da equipe; gestor/admin, todos da imobiliária.
CREATE POLICY leads_read ON public.leads FOR SELECT TO authenticated
  USING ((SELECT public.leads_gestor())
         OR responsavel_id IN (SELECT public.leads_responsaveis_visiveis()));
-- Linha do tempo: segue a visibilidade do lead (subconsulta passa pela RLS de leads).
CREATE POLICY lead_eventos_read ON public.lead_eventos FOR SELECT TO authenticated
  USING (lead_id IN (SELECT l.id FROM public.leads l));
CREATE POLICY lead_motivos_read ON public.lead_motivos_perda FOR SELECT TO authenticated USING (true);
CREATE POLICY lead_config_read ON public.lead_config FOR SELECT TO authenticated USING (true);

-- 4) RPCs (única porta de escrita) -------------------------------------------------------------
-- Contexto comum: usuário ativo, imobiliária ativa e módulo ligado. Devolve a org.
CREATE OR REPLACE FUNCTION public.lead_ctx() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessario' USING ERRCODE = '42501';
  END IF;
  IF NOT public.leads_enabled() THEN
    RAISE EXCEPTION 'Modulo de leads desligado nesta imobiliaria' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;

-- Pode ser responsável: membro ativo da imobiliária com papel de atendimento.
CREATE OR REPLACE FUNCTION public.lead_pode_ser_responsavel(_user uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
      JOIN public.profiles p ON p.id = m.user_id AND p.ativo IS TRUE AND p.organization_id = _org
     WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo)
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user AND r.organization_id = _org
                AND r.role::text IN ('corretor', 'team_leader', 'gestor', 'admin', 'super_admin'))
$$;

-- Lead visível para quem chama (mesma regra da policy), travado para atualização.
CREATE OR REPLACE FUNCTION public.lead_pega(_lead uuid, _org uuid) RETURNS public.leads
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.leads;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead AND organization_id = _org FOR UPDATE;
  IF _l.id IS NULL OR NOT (public.leads_gestor()
       OR _l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis())) THEN
    RAISE EXCEPTION 'Lead nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN _l;
END $$;
REVOKE ALL ON FUNCTION public.lead_ctx(), public.lead_pode_ser_responsavel(uuid, uuid), public.lead_pega(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Criar lead (P1: manual pelo gestor/admin; P2 acrescenta formulário/simulador pelo servidor).
-- Se vier captação, guarda o captador dela (D4). O responsável é opcional (P3 distribui).
CREATE OR REPLACE FUNCTION public.lead_criar(_nome text, _telefone text, _email text, _origem text,
  _mensagem text DEFAULT NULL, _capture_id uuid DEFAULT NULL, _responsavel_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador cadastra lead' USING ERRCODE = '42501';
  END IF;
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro') THEN
    RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023';
  END IF;
  IF _capture_id IS NOT NULL THEN
    SELECT c.captor_id INTO _captador FROM public.exclusive_captures c
     WHERE c.id = _capture_id AND c.organization_id = _org AND c.discarded_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF _responsavel_id IS NOT NULL AND NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.leads (organization_id, nome, telefone, email, origem, mensagem, capture_id, captador_id,
                            responsavel_id, atribuido_em, created_by)
  VALUES (_org, btrim(_nome), _tel, nullif(lower(btrim(coalesce(_email, ''))), ''), _origem,
          nullif(btrim(coalesce(_mensagem, '')), ''), _capture_id, _captador,
          _responsavel_id, CASE WHEN _responsavel_id IS NOT NULL THEN now() END, _me)
  RETURNING id INTO _id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _id, 'criado', _origem, _me);
  IF _responsavel_id IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'atribuido', _responsavel_id::text, _me);
  END IF;
  RETURN _id;
END $$;

-- Mudar etapa. "perdido" exige motivo da imobiliária. Ganho/perdido só reabre por gestor/admin.
CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text,
  _motivo_perda_id uuid DEFAULT NULL, _obs text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _etapa IS NULL OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada', 'proposta', 'ganho', 'perdido') THEN
    RAISE EXCEPTION 'Etapa invalida' USING ERRCODE = '22023';
  END IF;
  IF _etapa = _l.etapa THEN RETURN _etapa; END IF;
  IF _l.etapa IN ('ganho', 'perdido') AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead encerrado: so gestor ou administrador reabre' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $$;

-- Atribuir / trocar responsável (gestor/admin). P3 fará isso automaticamente.
CREATE OR REPLACE FUNCTION public.lead_atribuir(_lead uuid, _responsavel_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador atribui lead' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NOT DISTINCT FROM _responsavel_id THEN RETURN _responsavel_id; END IF;
  UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(), updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
  VALUES (_org, _l.id, 'atribuido', _l.responsavel_id::text, _responsavel_id::text, _me);
  RETURN _responsavel_id;
END $$;

-- Anotação na linha do tempo (responsável, líder da equipe ou gestor/admin).
CREATE OR REPLACE FUNCTION public.lead_anotar(_lead uuid, _nota text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _id uuid;
  _t text := btrim(coalesce(_nota, ''));
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF char_length(_t) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Anotacao vazia ou longa demais' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, nota, autor_id)
  VALUES (_org, _l.id, 'nota', _t, _me) RETURNING id INTO _id;
  UPDATE public.leads SET updated_at = now() WHERE id = _l.id;
  RETURN _id;
END $$;

-- Opções de tela: responsáveis possíveis e captações (só o necessário, sem proprietário/endereço).
CREATE OR REPLACE FUNCTION public.lead_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  RETURN jsonb_build_object(
    'responsaveis', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome)
       FROM public.profiles p WHERE p.organization_id = _org AND public.lead_pode_ser_responsavel(p.id, _org)), '[]'::jsonb),
    'capturas', CASE WHEN public.leads_gestor() THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
         'id', c.id, 'captador_id', c.captor_id, 'captador', coalesce(nullif(c.broker_name, ''), p.nome),
         'tipo', c.form_data->'imovel'->>'tipo_imovel', 'bairro', c.form_data->'imovel'->>'bairro') ORDER BY c.created_at DESC)
       FROM public.exclusive_captures c LEFT JOIN public.profiles p ON p.id = c.captor_id
       WHERE c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL), '[]'::jsonb)
      ELSE '[]'::jsonb END);
END $$;

REVOKE ALL ON FUNCTION public.lead_criar(text, text, text, text, text, uuid, uuid),
  public.lead_mudar_etapa(uuid, text, uuid, text), public.lead_atribuir(uuid, uuid),
  public.lead_anotar(uuid, text), public.lead_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_criar(text, text, text, text, text, uuid, uuid),
  public.lead_mudar_etapa(uuid, text, uuid, text), public.lead_atribuir(uuid, uuid),
  public.lead_anotar(uuid, text), public.lead_opcoes() TO authenticated, service_role;

-- Preparar uma imobiliária para o piloto (só servidor): motivos de perda padrão + configuração.
-- Idempotente. Não liga o módulo (isso é do painel Plataforma, com histórico).
CREATE OR REPLACE FUNCTION public.leads_preparar_org(_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org AND status = 'ativa') THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.lead_motivos_perda (organization_id, nome, ordem)
  SELECT _org, x.nome, x.ordem FROM (VALUES
    ('Sem resposta', 1), ('Contato inválido', 2), ('Fora do perfil / orçamento', 3),
    ('Comprou ou alugou com outro', 4), ('Desistiu', 5), ('Só pesquisando', 6), ('Outro', 99)) AS x(nome, ordem)
  ON CONFLICT (organization_id, nome) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.leads_preparar_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_preparar_org(uuid) TO service_role;

COMMIT;

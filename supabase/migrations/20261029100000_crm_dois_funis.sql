-- CRM — dois funis (Venda e Captação) sobre o módulo Leads. Card t_188fb282; maquete aprovada por Denis
-- em 29/10/2026 (card t_a7dc6562, tópico 6238). Base: migrations de leads 20261025120000 … 20261028190000.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261029100000_crm_dois_funis.rollback.sql
--
-- O que faz:
-- 1) Módulo novo "crm" (organization_modules), nasce DESLIGADO em todas as imobiliárias. Usa as tabelas do
--    módulo Leads, então só funciona com o Leads ligado (crm_enabled = crm E leads). Não depende da IA
--    (Nicole) nem da Captação exclusiva: sem a captação, só o "Converter em captação" fica indisponível.
-- 2) leads.funil = 'venda' (comprador, padrão; todos os leads atuais) | 'captacao' (proprietário).
--    Etapas reaproveitadas (nada é renomeado no banco):
--      Venda:    novo → em_atendimento (Em contato) → visita_agendada (Visita) → proposta → ganho (Fechado) | perdido
--      Captação: novo → em_atendimento (Em contato) → avaliacao (Avaliação) → proposta (Proposta de exclusividade)
--                → ganho (Captado) | perdido
-- 3) Próximo contato (data + motivo). Com o CRM ligado, mover para etapa aberta só pela RPC crm_mover, que
--    exige data e motivo (lead_mudar_etapa recusa etapa aberta sem passar por ela). Ganho/perdido limpam.
-- 4) Vínculos: leads.sale_id (venda) e leads.capture_convertida_id (captação exclusiva criada pelo lead).
--    RPCs crm_converter_venda / crm_converter_captacao criam o registro pré-preenchido, vinculam e põem o
--    lead em Fechado/Captado. Idempotentes (lead já vinculado devolve o mesmo registro).
-- 5) Visibilidade e distribuição: as MESMAS do módulo Leads (corretor só os próprios; Team Leader a equipe;
--    gestor/admin a imobiliária; contato só depois do aceite; captador do imóvel e depois rodízio).
-- Nenhuma mensagem é enviada; nada muda para imobiliária com o CRM desligado.
BEGIN;

-- 1) Módulo ------------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm')
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

-- CRM ligado = módulo crm E módulo leads ligados na imobiliária atual.
CREATE OR REPLACE FUNCTION public.crm_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.leads_enabled() AND coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'crm'), false)
$$;
REVOKE ALL ON FUNCTION public.crm_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_enabled() TO authenticated, service_role;

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'crm', false FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Colunas do lead ------------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS funil text NOT NULL DEFAULT 'venda'
    CONSTRAINT leads_funil_check CHECK (funil IN ('venda', 'captacao')),
  ADD COLUMN IF NOT EXISTS proximo_contato_em date,
  ADD COLUMN IF NOT EXISTS proximo_contato_motivo text
    CONSTRAINT leads_proximo_motivo_check CHECK (char_length(btrim(proximo_contato_motivo)) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS sale_id uuid,
  ADD COLUMN IF NOT EXISTS capture_convertida_id uuid,
  ADD COLUMN IF NOT EXISTS convertido_em timestamptz;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_proximo_par CHECK ((proximo_contato_em IS NULL) = (proximo_contato_motivo IS NULL)),
  -- Mesma imobiliária (FK composta). Venda/captação apagada: o lead perde o vínculo, não some.
  ADD CONSTRAINT leads_sale_org_fk FOREIGN KEY (sale_id, organization_id)
    REFERENCES public.sales(id, organization_id) ON DELETE SET NULL (sale_id),
  ADD CONSTRAINT leads_capture_convertida_org_fk FOREIGN KEY (capture_convertida_id, organization_id)
    REFERENCES public.exclusive_captures(id, organization_id) ON DELETE SET NULL (capture_convertida_id);
-- Etapas: avaliação só existe no funil de captação; visita, só no de venda.
ALTER TABLE public.leads DROP CONSTRAINT leads_etapa_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_check
  CHECK (etapa IN ('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'ganho', 'perdido'));
ALTER TABLE public.leads ADD CONSTRAINT leads_etapa_do_funil
  CHECK ((funil = 'venda' AND etapa <> 'avaliacao') OR (funil = 'captacao' AND etapa <> 'visita_agendada'));
CREATE UNIQUE INDEX IF NOT EXISTS leads_sale_uniq ON public.leads (sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_capture_convertida_uniq ON public.leads (capture_convertida_id)
  WHERE capture_convertida_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_fila_idx ON public.leads (organization_id, responsavel_id, proximo_contato_em)
  WHERE etapa NOT IN ('ganho', 'perdido');

-- Coluna nova em leads NÃO fica legível para o app sozinha (migration 20261025160000): libera as do CRM.
GRANT SELECT (funil, proximo_contato_em, proximo_contato_motivo, sale_id, capture_convertida_id, convertido_em)
  ON public.leads TO authenticated;

-- 3) Linha do tempo: tipos novos -------------------------------------------------------------------
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo', 'aceite', 'devolvido_banco',
                  'redistribuido', 'ligacao', 'ia', 'proximo_contato', 'convertido', 'funil'));

-- 4) Regras internas -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_ctx() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT public.crm_enabled() THEN
    RAISE EXCEPTION 'Modulo CRM desligado nesta imobiliaria' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;

-- Hoje no fuso de São Paulo (a data do próximo contato é dia de calendário do corretor).
CREATE OR REPLACE FUNCTION public.crm_hoje() RETURNS date
LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- Valida data + motivo do próximo contato: hoje até 1 ano à frente, motivo de 1 a 200 caracteres.
CREATE OR REPLACE FUNCTION public.crm_validar_proximo(_data date, _motivo text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE _m text := btrim(coalesce(_motivo, ''));
BEGIN
  IF _data IS NULL OR char_length(_m) = 0 THEN
    RAISE EXCEPTION 'Informe a data e o motivo do proximo contato' USING ERRCODE = '22023';
  END IF;
  IF _data < public.crm_hoje() OR _data > public.crm_hoje() + 366 THEN
    RAISE EXCEPTION 'Data do proximo contato invalida' USING ERRCODE = '22023';
  END IF;
  IF char_length(_m) > 200 THEN RAISE EXCEPTION 'Motivo do proximo contato longo demais' USING ERRCODE = '22023'; END IF;
  RETURN _m;
END $$;
REVOKE ALL ON FUNCTION public.crm_ctx(), public.crm_hoje(), public.crm_validar_proximo(date, text)
  FROM PUBLIC, anon, authenticated;
-- "Hoje" em São Paulo é inofensivo e a tela pode comparar a fila com a mesma data do banco.
GRANT EXECUTE ON FUNCTION public.crm_hoje() TO authenticated, service_role;

-- 5) lead_mudar_etapa (mesma assinatura): etapa conforme o funil; com CRM ligado, etapa aberta só via
--    crm_mover (que exige próximo contato); ganho/perdido limpam o próximo contato.
CREATE OR REPLACE FUNCTION public.lead_mudar_etapa(_lead uuid, _etapa text,
  _motivo_perda_id uuid DEFAULT NULL, _obs text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _conta boolean;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _etapa IS NULL OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada', 'avaliacao', 'proposta', 'ganho', 'perdido')
     OR (_l.funil = 'venda' AND _etapa = 'avaliacao') OR (_l.funil = 'captacao' AND _etapa = 'visita_agendada') THEN
    RAISE EXCEPTION 'Etapa invalida' USING ERRCODE = '22023';
  END IF;
  IF _etapa = _l.etapa THEN RETURN _etapa; END IF;
  IF _l.etapa IN ('ganho', 'perdido') AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead encerrado: so gestor ou administrador reabre' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  IF _etapa NOT IN ('ganho', 'perdido') AND public.crm_enabled()
     AND current_setting('app.crm_mover', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Informe a data e o motivo do proximo contato' USING ERRCODE = '22023';
  END IF;
  _conta := public.lead_checar_atendimento(_l, _me);
  IF _etapa = 'perdido' THEN
    IF _motivo_perda_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_motivos_perda
        WHERE id = _motivo_perda_id AND organization_id = _org AND ativo) THEN
      RAISE EXCEPTION 'Informe o motivo da perda' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- Reabrir (sair de ganho/perdido) recomeça o relógio, para o lead não voltar ao banco na hora.
  UPDATE public.leads SET etapa = _etapa, etapa_em = now(), updated_at = now(),
         motivo_perda_id = CASE WHEN _etapa = 'perdido' THEN _motivo_perda_id END,
         motivo_perda_obs = CASE WHEN _etapa = 'perdido' THEN nullif(btrim(coalesce(_obs, '')), '') END,
         proximo_contato_em = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_em END,
         proximo_contato_motivo = CASE WHEN _etapa IN ('ganho', 'perdido') THEN NULL ELSE proximo_contato_motivo END,
         ultima_interacao_em = CASE WHEN _conta OR (_l.etapa IN ('ganho', 'perdido') AND aceito_em IS NOT NULL)
                                    THEN now() ELSE ultima_interacao_em END,
         atribuido_em = CASE WHEN _l.etapa IN ('ganho', 'perdido') AND aceito_em IS NULL AND responsavel_id IS NOT NULL
                             THEN now() ELSE atribuido_em END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, 'etapa', _l.etapa, _etapa, left(nullif(btrim(coalesce(_obs, '')), ''), 2000), _me);
  RETURN _etapa;
END $$;

-- 6) RPCs do CRM -----------------------------------------------------------------------------------
-- Mover no quadro. Etapa aberta exige próximo contato (data + motivo); perdido exige motivo da perda.
CREATE OR REPLACE FUNCTION public.crm_mover(_lead uuid, _etapa text, _proximo_em date DEFAULT NULL,
  _proximo_motivo text DEFAULT NULL, _motivo_perda_id uuid DEFAULT NULL, _obs text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _m text;
BEGIN
  IF _etapa IN ('ganho', 'perdido') THEN
    RETURN public.lead_mudar_etapa(_lead, _etapa, _motivo_perda_id, _obs);
  END IF;
  _m := public.crm_validar_proximo(_proximo_em, _proximo_motivo);
  PERFORM set_config('app.crm_mover', 'on', true);
  PERFORM public.lead_mudar_etapa(_lead, _etapa, NULL, _obs);
  PERFORM set_config('app.crm_mover', 'off', true);
  UPDATE public.leads SET proximo_contato_em = _proximo_em, proximo_contato_motivo = _m, updated_at = now()
   WHERE id = _lead AND organization_id = _org;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota, autor_id)
  VALUES (_org, _lead, 'proximo_contato', to_char(_proximo_em, 'YYYY-MM-DD'), _m, _me);
  RETURN _etapa;
END $$;

-- Atualizar só o próximo contato (sem mudar etapa). Conta como atendimento do responsável.
CREATE OR REPLACE FUNCTION public.crm_proximo_contato(_lead uuid, _proximo_em date, _proximo_motivo text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _l public.leads; _m text; _conta boolean;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _l.etapa IN ('ganho', 'perdido') THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE = '42501'; END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  _m := public.crm_validar_proximo(_proximo_em, _proximo_motivo);
  _conta := public.lead_checar_atendimento(_l, _me);
  UPDATE public.leads SET proximo_contato_em = _proximo_em, proximo_contato_motivo = _m, updated_at = now(),
         ultima_interacao_em = CASE WHEN _conta THEN now() ELSE ultima_interacao_em END
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota, autor_id)
  VALUES (_org, _l.id, 'proximo_contato', to_char(_proximo_em, 'YYYY-MM-DD'), _m, _me);
  RETURN _proximo_em;
END $$;

-- Trocar o funil (comprador ↔ proprietário) enquanto o lead está no começo (Novo / Em contato).
CREATE OR REPLACE FUNCTION public.crm_definir_funil(_lead uuid, _funil text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _l public.leads;
BEGIN
  IF _funil IS NULL OR _funil NOT IN ('venda', 'captacao') THEN
    RAISE EXCEPTION 'Funil invalido' USING ERRCODE = '22023';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF _l.funil = _funil THEN RETURN _funil; END IF;
  IF _l.etapa NOT IN ('novo', 'em_atendimento') THEN
    RAISE EXCEPTION 'So troca o funil em Novo ou Em contato' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lead_checar_atendimento(_l, _me);
  UPDATE public.leads SET funil = _funil, updated_at = now() WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
  VALUES (_org, _l.id, 'funil', _l.funil, _funil, _me);
  RETURN _funil;
END $$;

-- Converter em venda: cria a venda (rascunho) pré-preenchida, vincula e põe o lead em Fechado.
-- Quem: o responsável (depois do aceite), o Team Leader dele ou gestor/admin — com papel que cria venda.
-- Imóvel de captação exclusiva aprovada: usa o "Virou venda" da captação (mantém o vínculo da captação).
-- Sem isso: venda comum com captador e código do anúncio quando houver. Comprador 1 = o lead.
CREATE OR REPLACE FUNCTION public.crm_converter_venda(_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _l public.leads; _sale uuid; _r jsonb;
  _vend uuid; _vend_nome text; _cap uuid; _cap_nome text; _cod text;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _l.funil <> 'venda' THEN RAISE EXCEPTION 'Lead nao e do funil de venda' USING ERRCODE = '22023'; END IF;
  IF _l.sale_id IS NOT NULL THEN RETURN _l.sale_id; END IF;
  IF _l.etapa = 'perdido' THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_any_role(_me, ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Seu papel nao cria venda' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS NULL AND NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Lead sem responsavel' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lead_checar_atendimento(_l, _me);
  _vend := coalesce(_l.responsavel_id, _me);
  SELECT nullif(btrim(nome), '') INTO _vend_nome FROM public.profiles WHERE id = _vend;

  IF _l.capture_id IS NOT NULL AND public.exclusive_capture_enabled()
     AND public.exclusive_pode_virar_venda(_l.capture_id, _me) THEN
    _r := public.exclusive_virar_venda(_l.capture_id);
    IF NOT coalesce((_r->>'criada')::boolean, false) THEN
      RAISE EXCEPTION 'Este imovel ja tem venda em andamento (%)', coalesce(_r->'venda'->>'codigo', '')
        USING ERRCODE = '23505';
    END IF;
    _sale := (_r->'venda'->>'id')::uuid;
    UPDATE public.sales SET corretor_vendedor_id = _vend, corretor_vendedor = _vend_nome WHERE id = _sale;
  ELSE
    IF _l.captador_id IS NOT NULL AND public.lead_pode_ser_responsavel(_l.captador_id, _org) THEN
      _cap := _l.captador_id;
      SELECT nullif(btrim(nome), '') INTO _cap_nome FROM public.profiles WHERE id = _cap;
    END IF;
    _cod := nullif(btrim(coalesce(_l.anuncio_codigo, '')), '');
    IF _cod IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales WHERE organization_id = _org AND imovel_id = _cod
         AND status NOT IN ('arquivada', 'cancelada')) THEN
      _cod := NULL; -- código já tem venda em andamento: o corretor informa depois
    END IF;
    INSERT INTO public.sales (corretor_id, imovel_id, corretor_vendedor_id, corretor_vendedor,
                              corretor_captador_id, corretor_captador)
    VALUES (_me, _cod, _vend, _vend_nome, _cap, _cap_nome)
    RETURNING id INTO _sale;
    INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa) VALUES (_sale, 'vendedor_1', 'fisica');
    INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa) VALUES (_sale, 'comprador_1', 'fisica');
  END IF;
  UPDATE public.sale_parties SET nome = _l.nome, telefone = _l.telefone, email = _l.email
   WHERE sale_id = _sale AND papel = 'comprador_1';

  UPDATE public.leads SET sale_id = _sale, convertido_em = now(), updated_at = now(),
         etapa = 'ganho', etapa_em = CASE WHEN etapa = 'ganho' THEN etapa_em ELSE now() END,
         proximo_contato_em = NULL, proximo_contato_motivo = NULL,
         ultima_interacao_em = CASE WHEN responsavel_id = _me THEN now() ELSE ultima_interacao_em END
   WHERE id = _l.id;
  IF _l.etapa <> 'ganho' THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
    VALUES (_org, _l.id, 'etapa', _l.etapa, 'ganho', _me);
  END IF;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota, autor_id)
  VALUES (_org, _l.id, 'convertido', 'venda', upper(left(_sale::text, 8)), _me);
  RETURN _sale;
END $$;

-- Converter em captação: cria a captação exclusiva (rascunho) na unidade escolhida, com o lead como
-- proprietário 1, vincula e põe o lead em Captado. Só o RESPONSÁVEL (depois do aceite), porque quem cria
-- vira o captador. Exige o módulo Captação exclusiva (exclusive_create_unit confere módulo, papel e unidade).
CREATE OR REPLACE FUNCTION public.crm_converter_captacao(_lead uuid, _unit_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.crm_ctx(); _me uuid := auth.uid(); _l public.leads; _cap uuid;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF _l.funil <> 'captacao' THEN RAISE EXCEPTION 'Lead nao e do funil de captacao' USING ERRCODE = '22023'; END IF;
  IF _l.capture_convertida_id IS NOT NULL THEN RETURN _l.capture_convertida_id; END IF;
  IF _l.etapa = 'perdido' THEN RAISE EXCEPTION 'Lead encerrado' USING ERRCODE = '42501'; END IF;
  IF NOT public.exclusive_capture_enabled() THEN
    RAISE EXCEPTION 'Captacao exclusiva desligada nesta imobiliaria' USING ERRCODE = '42501';
  END IF;
  IF _l.responsavel_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'So o corretor responsavel converte em captacao' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lead_checar_atendimento(_l, _me);
  _cap := public.exclusive_create_unit(_unit_id);
  UPDATE public.exclusive_captures
     SET form_data = jsonb_set(coalesce(form_data, '{}'::jsonb), '{proprietario_1}',
           jsonb_strip_nulls(jsonb_build_object('nome_completo', _l.nome, 'email', _l.email, 'telefone_1', _l.telefone)))
   WHERE id = _cap AND organization_id = _org;
  UPDATE public.leads SET capture_convertida_id = _cap, convertido_em = now(), updated_at = now(),
         etapa = 'ganho', etapa_em = CASE WHEN etapa = 'ganho' THEN etapa_em ELSE now() END,
         proximo_contato_em = NULL, proximo_contato_motivo = NULL, ultima_interacao_em = now()
   WHERE id = _l.id;
  IF _l.etapa <> 'ganho' THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, autor_id)
    VALUES (_org, _l.id, 'etapa', _l.etapa, 'ganho', _me);
  END IF;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota, autor_id)
  VALUES (_org, _l.id, 'convertido', 'captacao', upper(left(_cap::text, 8)), _me);
  RETURN _cap;
END $$;

REVOKE ALL ON FUNCTION public.crm_mover(uuid, text, date, text, uuid, text),
  public.crm_proximo_contato(uuid, date, text), public.crm_definir_funil(uuid, text),
  public.crm_converter_venda(uuid), public.crm_converter_captacao(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mover(uuid, text, date, text, uuid, text),
  public.crm_proximo_contato(uuid, date, text), public.crm_definir_funil(uuid, text),
  public.crm_converter_venda(uuid), public.crm_converter_captacao(uuid, uuid) TO authenticated, service_role;

COMMIT;

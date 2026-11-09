-- Módulo de Locação — Fase 2, Financeiro parte 1. Cartão t_be750361; maquete t_de4e155c; Denis 09/11/2026
-- ("pode construir a Fase 2", tópico 6238). CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA sobre a Fase 1 (20261110120000). Rollback: supabase/rollback/20261111120000_locacao_fase2_financeiro.sql
-- Teste: supabase/tests/run-locacao-fin.sh (transação desfeita; nunca produção).
--
-- O que entra:
--  * Papel 'financeiro' DENTRO de locacao_papeis (não é a app_role global 'financeiro'). Vê e edita só o financeiro
--    da locação da própria imobiliária; NÃO vê a esteira da Fase 1. Administrador/adm. principal agem em qualquer papel.
--  * Contrato ativo: nasce sozinho (situação 'a_completar') quando a Fase 1 registra a entrega das chaves; o Financeiro
--    completa proprietário/vencimento e ativa. Só contrato ativo gera cobrança.
--  * Cobranças mensais geradas pelo sistema (idempotente por contrato + competência). Baixa LANÇADA À MÃO pelo
--    Financeiro (data e valor pago). Multa e juros pela regra da imobiliária, gravados com a regra usada.
--  * Repasse: recebido − taxa de adm (ou retenção do 1º aluguel) − descontos (+ partes que são do proprietário).
--    Repasse feito marcado à mão, com o cálculo congelado no momento. Extrato por proprietário.
--  * Auditoria: locacao_fin_eventos (só inserção; UPDATE bloqueado por trigger) para baixa, estorno, desconto,
--    repasse, contrato e regras.
-- Fora: Itaú (boleto/Pix/baixa automática), nota fiscal, portal, régua de cobrança, acordos, DIMOB, migração da
-- Superlógica. Nada aqui envia mensagem, gera boleto ou move dinheiro.
--
-- Regras "A CONFIRMAR" (valores de EXEMPLO da maquete, editáveis por imobiliária; não são fato): multa 10%,
-- juros 1% a.m. pró-rata dia, multa/juros sobre o aluguel, multa/juros do proprietário, repasse 5 dias após o
-- pagamento, condomínio e IPTU no boleto, IPTU repassado ao proprietário, índice IGP-M, retenção do 1º aluguel.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Papel 'financeiro' em locacao_papeis ------------------------------------------------------------------------
ALTER TABLE public.locacao_papeis DROP CONSTRAINT locacao_papeis_papel_check;
ALTER TABLE public.locacao_papeis ADD CONSTRAINT locacao_papeis_papel_check
  CHECK (papel IN ('gestora', 'contratos', 'vistoria', 'financeiro'));

CREATE OR REPLACE FUNCTION public.locacao_papel_definir(_user uuid, _papel text, _ativo boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária atribui papéis.' USING ERRCODE = '42501';
  END IF;
  IF _papel IS NULL OR _papel NOT IN ('gestora', 'contratos', 'vistoria', 'financeiro') OR _ativo IS NULL THEN
    RAISE EXCEPTION 'Papel inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
                  WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo AND p.ativo) THEN
    RAISE EXCEPTION 'Pessoa não pertence a esta imobiliária.' USING ERRCODE = '42501';
  END IF;
  IF _ativo THEN
    INSERT INTO public.locacao_papeis (organization_id, user_id, papel, criado_por) VALUES (_org, _user, _papel, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.locacao_papeis WHERE organization_id = _org AND user_id = _user AND papel = _papel;
  END IF;
  RETURN _ativo;
END $$;
REVOKE ALL ON FUNCTION public.locacao_papel_definir(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_papel_definir(uuid, text, boolean) TO authenticated;

-- A esteira (Fase 1) continua visível para quem tem papel da esteira; o papel 'financeiro' sozinho NÃO a vê.
CREATE OR REPLACE FUNCTION public.locacao_pode_ver(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_l.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL AND (
    _l.corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id AND p.user_id = auth.uid()
                AND p.papel IN ('gestora', 'contratos', 'vistoria'))
    OR public.locacao_eh_gerencia(auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['financeiro']::public.app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::public.app_role[])
        AND public.is_lead_of(auth.uid(), _l.corretor_id))), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_pode_ver(public.locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_contexto() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _uid uuid := auth.uid(); _c public.locacao_config;
BEGIN
  _c := public.locacao_cfg(_org);
  RETURN jsonb_build_object(
    'usuario_id', _uid,
    'papeis', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') FROM unnest(ARRAY['gestora', 'contratos', 'vistoria', 'financeiro']) x
                WHERE public.locacao_tem_papel(_uid, x)),
    'admin', public.has_any_role(_uid, ARRAY['admin', 'super_admin']::public.app_role[]),
    'gerencia', public.locacao_eh_gerencia(_uid),
    've_comissao', public.locacao_eh_gerencia(_uid) OR public.has_any_role(_uid, ARRAY['financeiro']::public.app_role[])
                   OR public.locacao_tem_papel(_uid, 'gestora'),
    'config', to_jsonb(_c) - 'organization_id' - 'atualizado_por',
    'pessoas', (SELECT coalesce(jsonb_object_agg(papel, nomes), '{}') FROM (
        SELECT p.papel, jsonb_agg(pr.nome ORDER BY pr.nome) AS nomes FROM public.locacao_papeis p
          JOIN public.profiles pr ON pr.id = p.user_id
         WHERE p.organization_id = _org AND pr.ativo GROUP BY p.papel) s));
END $$;
REVOKE ALL ON FUNCTION public.locacao_contexto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_contexto() TO authenticated;

-- 2) Tabelas (RLS ligada, nenhum grant a anon/authenticated; tudo pelas RPCs) -----------------------------------
-- Regras financeiras por imobiliária. Sem linha = valores de EXEMPLO da maquete (A CONFIRMAR).
CREATE TABLE public.locacao_fin_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  multa_pct numeric(5, 2) NOT NULL DEFAULT 10 CONSTRAINT locacao_fin_config_multa_check CHECK (multa_pct BETWEEN 0 AND 20),
  juros_pct_mes numeric(5, 2) NOT NULL DEFAULT 1 CONSTRAINT locacao_fin_config_juros_check CHECK (juros_pct_mes BETWEEN 0 AND 10),
  multa_sobre text NOT NULL DEFAULT 'aluguel' CONSTRAINT locacao_fin_config_sobre_check CHECK (multa_sobre IN ('aluguel', 'total')),
  multa_para text NOT NULL DEFAULT 'proprietario'
    CONSTRAINT locacao_fin_config_para_check CHECK (multa_para IN ('proprietario', 'metade', 'imobiliaria')),
  dias_repasse integer NOT NULL DEFAULT 5 CONSTRAINT locacao_fin_config_dias_check CHECK (dias_repasse BETWEEN 0 AND 60),
  condominio_no_boleto boolean NOT NULL DEFAULT true,
  iptu_no_boleto boolean NOT NULL DEFAULT true,
  iptu_repassa_proprietario boolean NOT NULL DEFAULT true,
  indice text NOT NULL DEFAULT 'IGP-M' CONSTRAINT locacao_fin_config_indice_check CHECK (indice IN ('IGP-M', 'IPCA', 'IVAR', 'INPC')),
  retem_primeiro_aluguel boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

CREATE SEQUENCE public.locacao_contratos_numero_seq;
CREATE TABLE public.locacao_contratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  numero bigint NOT NULL DEFAULT nextval('public.locacao_contratos_numero_seq'),
  situacao text NOT NULL DEFAULT 'a_completar'
    CONSTRAINT locacao_contratos_situacao_check CHECK (situacao IN ('a_completar', 'ativo', 'encerrado')),
  endereco text CONSTRAINT locacao_contratos_endereco_check CHECK (endereco IS NULL OR length(endereco) <= 300),
  inquilino_nome text CONSTRAINT locacao_contratos_inq_check CHECK (inquilino_nome IS NULL OR length(inquilino_nome) <= 200),
  proprietario_nome text CONSTRAINT locacao_contratos_prop_check CHECK (proprietario_nome IS NULL OR length(proprietario_nome) <= 200),
  proprietario_doc text CONSTRAINT locacao_contratos_doc_check CHECK (proprietario_doc IS NULL OR length(proprietario_doc) <= 30),
  dados_repasse text CONSTRAINT locacao_contratos_repasse_check CHECK (dados_repasse IS NULL OR length(dados_repasse) <= 300),
  garantia text NOT NULL CONSTRAINT locacao_contratos_garantia_check CHECK (garantia IN ('fiador', 'caucao', 'seguro_fianca')),
  aluguel numeric(12, 2) NOT NULL CONSTRAINT locacao_contratos_aluguel_check CHECK (aluguel > 0 AND aluguel < 10000000),
  taxa_adm numeric(5, 2) NOT NULL CONSTRAINT locacao_contratos_taxa_check CHECK (taxa_adm > 0 AND taxa_adm <= 30),
  condominio numeric(12, 2) NOT NULL DEFAULT 0 CONSTRAINT locacao_contratos_condo_check CHECK (condominio >= 0 AND condominio < 10000000),
  iptu numeric(12, 2) NOT NULL DEFAULT 0 CONSTRAINT locacao_contratos_iptu_check CHECK (iptu >= 0 AND iptu < 10000000),
  dia_vencimento integer NOT NULL CONSTRAINT locacao_contratos_dia_check CHECK (dia_vencimento BETWEEN 1 AND 28),
  inicio date NOT NULL,
  proximo_reajuste date NOT NULL,
  indice text NOT NULL CONSTRAINT locacao_contratos_indice_check CHECK (indice IN ('IGP-M', 'IPCA', 'IVAR', 'INPC')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ativado_em timestamptz,
  ativado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacao_contratos_locacao_unica UNIQUE (locacao_id),
  CONSTRAINT locacao_contratos_numero_unico UNIQUE (numero),
  CONSTRAINT locacao_contratos_reajuste_check CHECK (proximo_reajuste > inicio)
);
CREATE INDEX locacao_contratos_org_idx ON public.locacao_contratos (organization_id, situacao);

CREATE TABLE public.locacao_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.locacao_contratos(id) ON DELETE CASCADE,
  competencia date NOT NULL CONSTRAINT locacao_cobrancas_comp_check CHECK (extract(day FROM competencia) = 1),
  vencimento date NOT NULL,
  aluguel numeric(12, 2) NOT NULL CHECK (aluguel > 0),
  condominio numeric(12, 2) NOT NULL DEFAULT 0 CHECK (condominio >= 0),
  iptu numeric(12, 2) NOT NULL DEFAULT 0 CHECK (iptu >= 0),
  taxa_adm numeric(5, 2) NOT NULL CHECK (taxa_adm > 0 AND taxa_adm <= 30),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0),
  primeiro_aluguel boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'aberta' CONSTRAINT locacao_cobrancas_status_check CHECK (status IN ('aberta', 'paga', 'cancelada')),
  pago_em date,
  valor_pago numeric(12, 2) CHECK (valor_pago IS NULL OR valor_pago > 0),
  multa numeric(12, 2) NOT NULL DEFAULT 0 CHECK (multa >= 0),
  juros numeric(12, 2) NOT NULL DEFAULT 0 CHECK (juros >= 0),
  regra_encargos jsonb,
  obs text CHECK (obs IS NULL OR length(obs) <= 500),
  baixa_por uuid,
  baixa_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacao_cobrancas_unica UNIQUE (contrato_id, competencia),
  CONSTRAINT locacao_cobrancas_paga_check CHECK ((status = 'paga') = (pago_em IS NOT NULL AND valor_pago IS NOT NULL))
);
CREATE INDEX locacao_cobrancas_org_comp_idx ON public.locacao_cobrancas (organization_id, competencia);

CREATE TABLE public.locacao_fin_descontos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cobranca_id uuid NOT NULL REFERENCES public.locacao_cobrancas(id) ON DELETE CASCADE,
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 3 AND 200),
  valor numeric(12, 2) NOT NULL CHECK (valor > 0 AND valor < 10000000),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz
);
CREATE INDEX locacao_fin_descontos_cob_idx ON public.locacao_fin_descontos (cobranca_id);

CREATE TABLE public.locacao_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cobranca_id uuid NOT NULL REFERENCES public.locacao_cobrancas(id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES public.locacao_contratos(id) ON DELETE CASCADE,
  proprietario_nome text,
  valor numeric(12, 2) NOT NULL,
  linhas jsonb NOT NULL CHECK (jsonb_typeof(linhas) = 'array'),
  feito_em date NOT NULL,
  comprovante text CHECK (comprovante IS NULL OR length(comprovante) <= 120),
  feito_por uuid,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz,
  desfeito_por uuid,
  desfeito_motivo text
);
CREATE UNIQUE INDEX locacao_repasses_cob_ativo_idx ON public.locacao_repasses (cobranca_id) WHERE desfeito_em IS NULL;

CREATE TABLE public.locacao_fin_eventos (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES public.locacao_contratos(id) ON DELETE CASCADE,
  cobranca_id uuid REFERENCES public.locacao_cobrancas(id) ON DELETE CASCADE,
  acao text NOT NULL,
  descricao text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ator_id uuid,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locacao_fin_eventos_ct_idx ON public.locacao_fin_eventos (contrato_id, em);

-- Auditoria só cresce: alterar evento é proibido (apagar só junto da imobiliária/contrato, em cascata).
CREATE OR REPLACE FUNCTION public.locacao_fin_eventos_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'Histórico financeiro não pode ser alterado.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_eventos_imutavel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER locacao_fin_eventos_sem_update BEFORE UPDATE ON public.locacao_fin_eventos
  FOR EACH ROW EXECUTE FUNCTION public.locacao_fin_eventos_imutavel();

ALTER TABLE public.locacao_fin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_cobrancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_fin_descontos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_repasses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_fin_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_fin_config, public.locacao_contratos, public.locacao_cobrancas, public.locacao_fin_descontos,
  public.locacao_repasses, public.locacao_fin_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.locacao_contratos_numero_seq, public.locacao_fin_eventos_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_fin_config, public.locacao_contratos, public.locacao_cobrancas, public.locacao_fin_descontos,
  public.locacao_repasses, public.locacao_fin_eventos TO service_role;
GRANT USAGE ON SEQUENCE public.locacao_contratos_numero_seq, public.locacao_fin_eventos_id_seq TO service_role;

-- 3) Funções internas (sem grant) -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_fin_cfg(_org uuid) RETURNS public.locacao_fin_config
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_fin_config;
BEGIN
  SELECT * INTO _c FROM public.locacao_fin_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    -- Sem linha: exemplo da maquete (mesmos valores dos DEFAULT). A CONFIRMAR.
    _c.organization_id := _org; _c.multa_pct := 10; _c.juros_pct_mes := 1; _c.multa_sobre := 'aluguel';
    _c.multa_para := 'proprietario'; _c.dias_repasse := 5; _c.condominio_no_boleto := true; _c.iptu_no_boleto := true;
    _c.iptu_repassa_proprietario := true; _c.indice := 'IGP-M'; _c.retem_primeiro_aluguel := true;
  END IF;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_fin_hoje() RETURNS date
LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- R$ 1.234,56 para o histórico (independe do locale do banco).
CREATE OR REPLACE FUNCTION public.locacao_fin_brl(_v numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT 'R$ ' || translate(to_char(round(coalesce(_v, 0), 2), 'FM999,999,990.00'), ',.', '.,')
$$;

-- Financeiro da locação: módulo ligado + papel 'financeiro' (ou administrador/adm. principal).
CREATE OR REPLACE FUNCTION public.locacao_fin_ctx() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_tem_papel(auth.uid(), 'financeiro') THEN
    RAISE EXCEPTION 'Só o Financeiro da locação acessa esta área.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_fin_evento(_org uuid, _contrato uuid, _cobranca uuid, _acao text, _descricao text,
  _dados jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  INSERT INTO public.locacao_fin_eventos (organization_id, contrato_id, cobranca_id, acao, descricao, dados, ator_id)
  VALUES (_org, _contrato, _cobranca, _acao, left(_descricao, 500), coalesce(_dados, '{}'::jsonb), auth.uid())
$$;

-- Multa (uma vez) + juros pró-rata dia (% ao mês ÷ 30 × dias) sobre a base escolhida na regra.
CREATE OR REPLACE FUNCTION public.locacao_fin_encargos(_c public.locacao_cobrancas, _pago_em date, _cfg public.locacao_fin_config)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _dias integer := greatest(0, _pago_em - _c.vencimento); _base numeric;
BEGIN
  _base := CASE WHEN _cfg.multa_sobre = 'total' THEN _c.valor ELSE _c.aluguel END;
  IF _dias = 0 THEN
    RETURN jsonb_build_object('dias', 0, 'base', _base, 'multa', 0, 'juros', 0);
  END IF;
  RETURN jsonb_build_object('dias', _dias, 'base', _base,
    'multa', round(_base * _cfg.multa_pct / 100, 2),
    'juros', round(_base * _cfg.juros_pct_mes / 100 / 30 * _dias, 2),
    'multa_pct', _cfg.multa_pct, 'juros_pct_mes', _cfg.juros_pct_mes, 'multa_sobre', _cfg.multa_sobre);
END $$;

-- Cálculo do repasse de uma cobrança paga (linhas + total + data prevista). Sem pagamento = NULL.
CREATE OR REPLACE FUNCTION public.locacao_fin_repasse_calc(_c public.locacao_cobrancas) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cfg public.locacao_fin_config := public.locacao_fin_cfg(_c.organization_id); _l jsonb := '[]'::jsonb;
  _parte numeric; _total numeric; _d record;
BEGIN
  IF _c.status <> 'paga' THEN RETURN NULL; END IF;
  _l := _l || jsonb_build_array(jsonb_build_object('t', 'Aluguel recebido', 'v', _c.aluguel));
  IF _c.primeiro_aluguel AND _cfg.retem_primeiro_aluguel THEN
    _l := _l || jsonb_build_array(jsonb_build_object('t', 'Retenção do 1º aluguel (taxa de locação)', 'v', -_c.aluguel));
  ELSE
    _l := _l || jsonb_build_array(jsonb_build_object('t', 'Taxa de administração (' || trim(to_char(_c.taxa_adm, 'FM990.99')) || '%)',
      'v', -round(_c.aluguel * _c.taxa_adm / 100, 2)));
  END IF;
  _parte := CASE _cfg.multa_para WHEN 'proprietario' THEN 1 WHEN 'metade' THEN 0.5 ELSE 0 END;
  IF _parte > 0 AND (_c.multa + _c.juros) > 0 THEN
    _l := _l || jsonb_build_array(jsonb_build_object('t', 'Multa e juros pagos pelo inquilino'
      || CASE WHEN _parte = 1 THEN '' ELSE ' (50%)' END, 'v', round((_c.multa + _c.juros) * _parte, 2)));
  END IF;
  IF _c.iptu > 0 AND _cfg.iptu_repassa_proprietario THEN
    _l := _l || jsonb_build_array(jsonb_build_object('t', 'IPTU cobrado do inquilino', 'v', _c.iptu));
  END IF;
  FOR _d IN SELECT descricao, valor FROM public.locacao_fin_descontos
             WHERE cobranca_id = _c.id AND removido_em IS NULL ORDER BY criado_em LOOP
    _l := _l || jsonb_build_array(jsonb_build_object('t', 'Desconto: ' || _d.descricao, 'v', -_d.valor));
  END LOOP;
  SELECT coalesce(sum((x->>'v')::numeric), 0) INTO _total FROM jsonb_array_elements(_l) x;
  RETURN jsonb_build_object('linhas', _l, 'total', round(_total, 2), 'previsto', _c.pago_em + _cfg.dias_repasse,
    'retencao_primeiro', _c.primeiro_aluguel AND _cfg.retem_primeiro_aluguel);
END $$;

CREATE OR REPLACE FUNCTION public.locacao_fin_cob_json(_c public.locacao_cobrancas) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT to_jsonb(_c) - 'organization_id' - 'baixa_por' || jsonb_build_object(
    'situacao', CASE WHEN _c.status = 'aberta' AND _c.vencimento < public.locacao_fin_hoje() THEN 'atraso' ELSE _c.status END,
    'dias_atraso', CASE WHEN _c.status = 'aberta' THEN greatest(0, public.locacao_fin_hoje() - _c.vencimento) ELSE 0 END,
    'encargos_hoje', CASE WHEN _c.status = 'aberta'
      THEN public.locacao_fin_encargos(_c, public.locacao_fin_hoje(), public.locacao_fin_cfg(_c.organization_id)) END,
    'contrato_codigo', 'CT-' || lpad(ct.numero::text, 4, '0'),
    'inquilino_nome', ct.inquilino_nome, 'proprietario_nome', ct.proprietario_nome, 'endereco', ct.endereco,
    'baixa_por_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _c.baixa_por),
    'repasse_calc', public.locacao_fin_repasse_calc(_c),
    'repasse', (SELECT jsonb_build_object('id', r.id, 'valor', r.valor, 'feito_em', r.feito_em, 'comprovante', r.comprovante,
        'linhas', r.linhas) FROM public.locacao_repasses r WHERE r.cobranca_id = _c.id AND r.desfeito_em IS NULL),
    'descontos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'descricao', d.descricao, 'valor', d.valor)
        ORDER BY d.criado_em), '[]') FROM public.locacao_fin_descontos d WHERE d.cobranca_id = _c.id AND d.removido_em IS NULL))
  FROM public.locacao_contratos ct WHERE ct.id = _c.contrato_id
$$;

CREATE OR REPLACE FUNCTION public.locacao_fin_ct_json(_ct public.locacao_contratos) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT to_jsonb(_ct) - 'organization_id' - 'ativado_por' || jsonb_build_object(
    'codigo', 'CT-' || lpad(_ct.numero::text, 4, '0'),
    'locacao_codigo', (SELECT 'LOC-' || lpad(l.numero::text, 4, '0') FROM public.locacoes l WHERE l.id = _ct.locacao_id),
    'chave_em', (SELECT l.chave_em FROM public.locacoes l WHERE l.id = _ct.locacao_id))
$$;

CREATE OR REPLACE FUNCTION public.locacao_fin_pega_cob(_id uuid) RETURNS public.locacao_cobrancas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _c public.locacao_cobrancas;
BEGIN
  SELECT * INTO _c FROM public.locacao_cobrancas WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.' USING ERRCODE = '42501'; END IF;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_fin_pega_ct(_id uuid) RETURNS public.locacao_contratos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _ct public.locacao_contratos;
BEGIN
  SELECT * INTO _ct FROM public.locacao_contratos WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _ct.id IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE = '42501'; END IF;
  RETURN _ct;
END $$;

REVOKE ALL ON FUNCTION public.locacao_fin_cfg(uuid), public.locacao_fin_hoje(), public.locacao_fin_brl(numeric),
  public.locacao_fin_ctx(),
  public.locacao_fin_evento(uuid, uuid, uuid, text, text, jsonb),
  public.locacao_fin_encargos(public.locacao_cobrancas, date, public.locacao_fin_config),
  public.locacao_fin_repasse_calc(public.locacao_cobrancas), public.locacao_fin_cob_json(public.locacao_cobrancas),
  public.locacao_fin_ct_json(public.locacao_contratos), public.locacao_fin_pega_cob(uuid), public.locacao_fin_pega_ct(uuid)
  FROM PUBLIC, anon, authenticated;

-- 4) Contrato nasce na entrega das chaves (Fase 1) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_fin_criar_contrato(_l public.locacoes) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cfg public.locacao_fin_config := public.locacao_fin_cfg(_l.organization_id); _id uuid;
BEGIN
  IF _l.chave_em IS NULL OR _l.aluguel IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.locacao_contratos (organization_id, locacao_id, endereco, inquilino_nome, garantia, aluguel, taxa_adm,
    condominio, iptu, dia_vencimento, inicio, proximo_reajuste, indice)
  VALUES (_l.organization_id, _l.id, _l.endereco, nullif(btrim(coalesce(_l.candidato->>'nome', '')), ''), _l.garantia,
    _l.aluguel, _l.taxa_adm, _l.condominio, _l.iptu, least(28, extract(day FROM _l.chave_em)::integer), _l.chave_em,
    (_l.chave_em + interval '1 year')::date, _cfg.indice)
  ON CONFLICT (locacao_id) DO NOTHING RETURNING id INTO _id;
  IF _id IS NOT NULL THEN
    INSERT INTO public.locacao_fin_eventos (organization_id, contrato_id, acao, descricao, ator_id)
    VALUES (_l.organization_id, _id, 'contrato_criado', 'Contrato criado na entrega das chaves (' ||
      to_char(_l.chave_em, 'DD/MM/YYYY') || ') — aguardando o Financeiro completar e ativar', auth.uid());
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_criar_contrato(public.locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_trg_chaves() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  PERFORM public.locacao_fin_criar_contrato(NEW);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_trg_chaves() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER locacao_fin_contrato_na_chave AFTER UPDATE OF chave_em ON public.locacoes
  FOR EACH ROW WHEN (OLD.chave_em IS NULL AND NEW.chave_em IS NOT NULL) EXECUTE FUNCTION public.locacao_fin_trg_chaves();

-- Locações que já entregaram a chave antes desta migration (Fase 1 já publicada) também ganham contrato a completar.
SELECT public.locacao_fin_criar_contrato(l) FROM public.locacoes l WHERE l.chave_em IS NOT NULL AND l.situacao = 'ativa';

-- 5) RPCs do Financeiro -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_fin_painel(_competencia date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _comp date := date_trunc('month', coalesce(_competencia, public.locacao_fin_hoje()))::date;
BEGIN
  RETURN jsonb_build_object(
    'competencia', _comp, 'hoje', public.locacao_fin_hoje(),
    'config', to_jsonb(public.locacao_fin_cfg(_org)) - 'organization_id' - 'atualizado_por',
    'pode_regras', public.locacao_tem_papel(auth.uid(), 'financeiro') OR public.locacao_eh_gerencia(auth.uid()),
    'contratos', (SELECT coalesce(jsonb_agg(public.locacao_fin_ct_json(ct) ORDER BY ct.numero), '[]')
                    FROM public.locacao_contratos ct WHERE ct.organization_id = _org),
    'cobrancas', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.vencimento, c.id), '[]')
                    FROM public.locacao_cobrancas c WHERE c.organization_id = _org AND c.competencia = _comp),
    'atrasadas_antes', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.vencimento), '[]')
                    FROM public.locacao_cobrancas c WHERE c.organization_id = _org AND c.competencia < _comp
                     AND c.status = 'aberta' AND c.vencimento < public.locacao_fin_hoje()),
    'faltam_gerar', (SELECT count(*) FROM public.locacao_contratos ct WHERE ct.organization_id = _org AND ct.situacao = 'ativo'
                      AND date_trunc('month', ct.inicio) <= _comp
                      AND NOT EXISTS (SELECT 1 FROM public.locacao_cobrancas c WHERE c.contrato_id = ct.id AND c.competencia = _comp)));
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_painel(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_painel(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_contrato(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _ct public.locacao_contratos;
BEGIN
  SELECT * INTO _ct FROM public.locacao_contratos WHERE id = _id AND organization_id = _org;
  IF _ct.id IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado.' USING ERRCODE = '42501'; END IF;
  RETURN public.locacao_fin_ct_json(_ct) || jsonb_build_object(
    'cobrancas', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.competencia DESC), '[]')
                    FROM public.locacao_cobrancas c WHERE c.contrato_id = _ct.id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'acao', e.acao, 'descricao', e.descricao,
        'ator_nome', p.nome) ORDER BY e.em DESC, e.id DESC), '[]')
        FROM public.locacao_fin_eventos e LEFT JOIN public.profiles p ON p.id = e.ator_id WHERE e.contrato_id = _ct.id));
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_contrato(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_contrato_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ct public.locacao_contratos := public.locacao_fin_pega_ct(_id); _novo public.locacao_contratos; _mud jsonb;
BEGIN
  IF _ct.situacao = 'encerrado' THEN RAISE EXCEPTION 'Contrato encerrado.' USING ERRCODE = '22023'; END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('endereco', 'inquilino_nome', 'proprietario_nome', 'proprietario_doc', 'dados_repasse', 'garantia', 'aluguel', 'taxa_adm',
      'condominio', 'iptu', 'dia_vencimento', 'inicio', 'proximo_reajuste', 'indice')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(_dados) e WHERE jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacao_contratos SET
    endereco = CASE WHEN _dados ? 'endereco' THEN nullif(btrim(_dados->>'endereco'), '') ELSE endereco END,
    inquilino_nome = CASE WHEN _dados ? 'inquilino_nome' THEN nullif(btrim(_dados->>'inquilino_nome'), '') ELSE inquilino_nome END,
    proprietario_nome = CASE WHEN _dados ? 'proprietario_nome' THEN nullif(btrim(_dados->>'proprietario_nome'), '') ELSE proprietario_nome END,
    proprietario_doc = CASE WHEN _dados ? 'proprietario_doc' THEN nullif(btrim(_dados->>'proprietario_doc'), '') ELSE proprietario_doc END,
    dados_repasse = CASE WHEN _dados ? 'dados_repasse' THEN nullif(btrim(_dados->>'dados_repasse'), '') ELSE dados_repasse END,
    garantia = coalesce(_dados->>'garantia', garantia),
    aluguel = coalesce((_dados->>'aluguel')::numeric, aluguel), taxa_adm = coalesce((_dados->>'taxa_adm')::numeric, taxa_adm),
    condominio = coalesce((_dados->>'condominio')::numeric, condominio), iptu = coalesce((_dados->>'iptu')::numeric, iptu),
    dia_vencimento = coalesce((_dados->>'dia_vencimento')::integer, dia_vencimento),
    inicio = coalesce((_dados->>'inicio')::date, inicio),
    proximo_reajuste = coalesce((_dados->>'proximo_reajuste')::date, proximo_reajuste),
    indice = coalesce(_dados->>'indice', indice), atualizado_em = now()
   WHERE id = _id RETURNING * INTO _novo;
  SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value)), '{}') INTO _mud
    FROM jsonb_each(to_jsonb(_novo) - 'atualizado_em') n JOIN jsonb_each(to_jsonb(_ct)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value;
  IF _mud <> '{}'::jsonb THEN
    PERFORM public.locacao_fin_evento(_ct.organization_id, _ct.id, NULL, 'contrato_editado',
      'Contrato alterado: ' || (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(_mud) k), _mud);
  END IF;
  RETURN public.locacao_fin_ct_json(_novo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR invalid_datetime_format
  OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Valor inválido no contrato' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_contrato_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_contrato_salvar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_contrato_ativar(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ct public.locacao_contratos := public.locacao_fin_pega_ct(_id); _f text[] := ARRAY[]::text[];
BEGIN
  IF _ct.situacao <> 'a_completar' THEN RAISE EXCEPTION 'Contrato já ativado.' USING ERRCODE = '22023'; END IF;
  IF length(coalesce(_ct.proprietario_nome, '')) < 3 THEN _f := array_append(_f, 'nome do proprietário'); END IF;
  IF length(coalesce(_ct.inquilino_nome, '')) < 3 THEN _f := array_append(_f, 'nome do inquilino'); END IF;
  IF length(coalesce(_ct.dados_repasse, '')) < 5 THEN _f := array_append(_f, 'dados para repasse'); END IF;
  IF length(coalesce(_ct.endereco, '')) < 8 THEN _f := array_append(_f, 'endereço'); END IF;
  IF cardinality(_f) > 0 THEN RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023'; END IF;
  UPDATE public.locacao_contratos SET situacao = 'ativo', ativado_em = now(), ativado_por = auth.uid(), atualizado_em = now()
   WHERE id = _id RETURNING * INTO _ct;
  PERFORM public.locacao_fin_evento(_ct.organization_id, _ct.id, NULL, 'contrato_ativado',
    'Contrato ativado: aluguel ' || public.locacao_fin_brl(_ct.aluguel) || ', vence todo dia ' || _ct.dia_vencimento);
  RETURN public.locacao_fin_ct_json(_ct);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_contrato_ativar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_contrato_ativar(uuid) TO authenticated;

-- Gera as cobranças da competência para todos os contratos ativos (repetir não duplica).
CREATE OR REPLACE FUNCTION public.locacao_fin_gerar_cobrancas(_competencia date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _cfg public.locacao_fin_config := public.locacao_fin_cfg(_org);
  _comp date := date_trunc('month', _competencia)::date; _n integer := 0; _ct public.locacao_contratos; _id uuid;
  _cond numeric; _iptu numeric;
BEGIN
  IF _competencia IS NULL OR _comp > date_trunc('month', public.locacao_fin_hoje() + 45)::date
     OR _comp < date_trunc('month', public.locacao_fin_hoje())::date - interval '12 months' THEN
    RAISE EXCEPTION 'Competência fora do período permitido (até 12 meses atrás ou o próximo mês).' USING ERRCODE = '22023';
  END IF;
  FOR _ct IN SELECT * FROM public.locacao_contratos WHERE organization_id = _org AND situacao = 'ativo'
              AND date_trunc('month', inicio) <= _comp ORDER BY numero FOR UPDATE LOOP
    _cond := CASE WHEN _cfg.condominio_no_boleto THEN _ct.condominio ELSE 0 END;
    _iptu := CASE WHEN _cfg.iptu_no_boleto THEN _ct.iptu ELSE 0 END;
    INSERT INTO public.locacao_cobrancas (organization_id, contrato_id, competencia, vencimento, aluguel, condominio, iptu,
      taxa_adm, valor, primeiro_aluguel)
    VALUES (_org, _ct.id, _comp, make_date(extract(year FROM _comp)::integer, extract(month FROM _comp)::integer, _ct.dia_vencimento),
      _ct.aluguel, _cond, _iptu, _ct.taxa_adm, _ct.aluguel + _cond + _iptu, date_trunc('month', _ct.inicio)::date = _comp)
    ON CONFLICT (contrato_id, competencia) DO NOTHING RETURNING id INTO _id;
    IF _id IS NOT NULL THEN
      _n := _n + 1;
      PERFORM public.locacao_fin_evento(_org, _ct.id, _id, 'cobranca_gerada',
        'Cobrança ' || to_char(_comp, 'MM/YYYY') || ' gerada: ' || public.locacao_fin_brl(_ct.aluguel + _cond + _iptu));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('geradas', _n, 'competencia', _comp);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_gerar_cobrancas(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_gerar_cobrancas(date) TO authenticated;

-- Baixa manual: data e valor pago. Multa/juros calculados pela regra e gravados com a regra usada.
CREATE OR REPLACE FUNCTION public.locacao_fin_baixa(_cobranca uuid, _pago_em date, _valor_pago numeric, _obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_cobrancas := public.locacao_fin_pega_cob(_cobranca); _e jsonb; _devido numeric;
  _o text := nullif(btrim(coalesce(_obs, '')), '');
BEGIN
  IF _c.status <> 'aberta' THEN RAISE EXCEPTION 'Cobrança não está em aberto.' USING ERRCODE = '22023'; END IF;
  IF _pago_em IS NULL OR _pago_em > public.locacao_fin_hoje() OR _pago_em < _c.competencia - 60 THEN
    RAISE EXCEPTION 'Data de pagamento inválida.' USING ERRCODE = '22023';
  END IF;
  IF _valor_pago IS NULL OR _valor_pago <= 0 OR _valor_pago >= 10000000 THEN
    RAISE EXCEPTION 'Valor pago inválido.' USING ERRCODE = '22023';
  END IF;
  _e := public.locacao_fin_encargos(_c, _pago_em, public.locacao_fin_cfg(_c.organization_id));
  _devido := _c.valor + (_e->>'multa')::numeric + (_e->>'juros')::numeric;
  IF round(_valor_pago, 2) <> _devido AND (_o IS NULL OR length(_o) < 5) THEN
    RAISE EXCEPTION 'Valor pago (%) diferente do devido (%): explique na observação.', round(_valor_pago, 2), _devido
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacao_cobrancas SET status = 'paga', pago_em = _pago_em, valor_pago = round(_valor_pago, 2),
    multa = (_e->>'multa')::numeric, juros = (_e->>'juros')::numeric, regra_encargos = _e, obs = left(_o, 500),
    baixa_por = auth.uid(), baixa_em = now()
   WHERE id = _c.id RETURNING * INTO _c;
  PERFORM public.locacao_fin_evento(_c.organization_id, _c.contrato_id, _c.id, 'baixa',
    'Baixa manual ' || to_char(_c.competencia, 'MM/YYYY') || ': pago em ' || to_char(_pago_em, 'DD/MM/YYYY') || ', '
    || public.locacao_fin_brl(_c.valor_pago) || CASE WHEN (_e->>'dias')::integer > 0
      THEN ' (atraso ' || (_e->>'dias') || ' dia(s): multa ' || (_e->>'multa') || ' + juros ' || (_e->>'juros') || ')' ELSE '' END
    || coalesce(' — ' || _o, ''),
    jsonb_build_object('pago_em', _pago_em, 'valor_pago', _c.valor_pago, 'devido', _devido, 'encargos', _e));
  RETURN public.locacao_fin_cob_json(_c);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_baixa(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_baixa(uuid, date, numeric, text) TO authenticated;

-- Desfazer baixa (lançada por engano): exige motivo e repasse ainda não feito.
CREATE OR REPLACE FUNCTION public.locacao_fin_estornar(_cobranca uuid, _motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_cobrancas := public.locacao_fin_pega_cob(_cobranca); _m text := nullif(btrim(coalesce(_motivo, '')), '');
  _antes jsonb;
BEGIN
  IF _c.status <> 'paga' THEN RAISE EXCEPTION 'Cobrança não está paga.' USING ERRCODE = '22023'; END IF;
  IF _m IS NULL OR length(_m) < 5 THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_repasses WHERE cobranca_id = _c.id AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Repasse já feito: desfaça o repasse antes.' USING ERRCODE = '22023';
  END IF;
  _antes := jsonb_build_object('pago_em', _c.pago_em, 'valor_pago', _c.valor_pago, 'multa', _c.multa, 'juros', _c.juros);
  UPDATE public.locacao_cobrancas SET status = 'aberta', pago_em = NULL, valor_pago = NULL, multa = 0, juros = 0,
    regra_encargos = NULL, obs = NULL, baixa_por = NULL, baixa_em = NULL WHERE id = _c.id RETURNING * INTO _c;
  PERFORM public.locacao_fin_evento(_c.organization_id, _c.contrato_id, _c.id, 'estorno',
    'Baixa desfeita ' || to_char(_c.competencia, 'MM/YYYY') || ': ' || _m, _antes || jsonb_build_object('motivo', _m));
  RETURN public.locacao_fin_cob_json(_c);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_estornar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_estornar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_cancelar(_cobranca uuid, _motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_cobrancas := public.locacao_fin_pega_cob(_cobranca); _m text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  IF _c.status <> 'aberta' THEN RAISE EXCEPTION 'Só cobrança em aberto pode ser cancelada.' USING ERRCODE = '22023'; END IF;
  IF _m IS NULL OR length(_m) < 5 THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  UPDATE public.locacao_cobrancas SET status = 'cancelada', obs = left(_m, 500) WHERE id = _c.id RETURNING * INTO _c;
  PERFORM public.locacao_fin_evento(_c.organization_id, _c.contrato_id, _c.id, 'cobranca_cancelada',
    'Cobrança ' || to_char(_c.competencia, 'MM/YYYY') || ' cancelada: ' || _m);
  RETURN public.locacao_fin_cob_json(_c);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_cancelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_cancelar(uuid, text) TO authenticated;

-- Descontos do proprietário (manutenção etc.) — só antes de o repasse ser feito.
CREATE OR REPLACE FUNCTION public.locacao_fin_desconto(_cobranca uuid, _descricao text, _valor numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_cobrancas := public.locacao_fin_pega_cob(_cobranca); _d text := nullif(btrim(coalesce(_descricao, '')), '');
  _id uuid;
BEGIN
  IF _c.status = 'cancelada' THEN RAISE EXCEPTION 'Cobrança cancelada.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_repasses WHERE cobranca_id = _c.id AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Repasse já feito: não dá para lançar desconto.' USING ERRCODE = '22023';
  END IF;
  IF _d IS NULL OR length(_d) < 3 OR length(_d) > 200 THEN RAISE EXCEPTION 'Descreva o desconto.' USING ERRCODE = '22023'; END IF;
  IF _valor IS NULL OR _valor <= 0 OR _valor >= 10000000 THEN RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.locacao_fin_descontos (organization_id, cobranca_id, descricao, valor, criado_por)
  VALUES (_c.organization_id, _c.id, _d, round(_valor, 2), auth.uid()) RETURNING id INTO _id;
  PERFORM public.locacao_fin_evento(_c.organization_id, _c.contrato_id, _c.id, 'desconto',
    'Desconto lançado ' || to_char(_c.competencia, 'MM/YYYY') || ': ' || _d || ' — ' || public.locacao_fin_brl(_valor),
    jsonb_build_object('id', _id, 'valor', round(_valor, 2)));
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_desconto(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_desconto(uuid, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_desconto_remover(_desconto uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _d public.locacao_fin_descontos; _c public.locacao_cobrancas;
BEGIN
  SELECT * INTO _d FROM public.locacao_fin_descontos WHERE id = _desconto AND organization_id = _org AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Desconto não encontrado.' USING ERRCODE = '22023'; END IF;
  _c := public.locacao_fin_pega_cob(_d.cobranca_id);
  IF EXISTS (SELECT 1 FROM public.locacao_repasses WHERE cobranca_id = _c.id AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Repasse já feito: não dá para remover desconto.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacao_fin_descontos SET removido_em = now() WHERE id = _d.id;
  PERFORM public.locacao_fin_evento(_org, _c.contrato_id, _c.id, 'desconto_removido', 'Desconto removido: ' || _d.descricao,
    jsonb_build_object('id', _d.id, 'valor', _d.valor));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_desconto_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_desconto_remover(uuid) TO authenticated;

-- Repasse feito (registro manual de Pix/TED feito fora do sistema). Congela o cálculo do momento.
CREATE OR REPLACE FUNCTION public.locacao_fin_repasse_feito(_cobranca uuid, _feito_em date, _comprovante text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_cobrancas := public.locacao_fin_pega_cob(_cobranca); _calc jsonb; _id uuid; _ct public.locacao_contratos;
BEGIN
  IF _c.status <> 'paga' THEN RAISE EXCEPTION 'Só há repasse de cobrança paga.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_repasses WHERE cobranca_id = _c.id AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Repasse já registrado.' USING ERRCODE = '22023';
  END IF;
  IF _feito_em IS NULL OR _feito_em > public.locacao_fin_hoje() OR _feito_em < _c.pago_em THEN
    RAISE EXCEPTION 'Data do repasse inválida.' USING ERRCODE = '22023';
  END IF;
  _calc := public.locacao_fin_repasse_calc(_c);
  SELECT * INTO _ct FROM public.locacao_contratos WHERE id = _c.contrato_id;
  INSERT INTO public.locacao_repasses (organization_id, cobranca_id, contrato_id, proprietario_nome, valor, linhas, feito_em,
    comprovante, feito_por)
  VALUES (_c.organization_id, _c.id, _c.contrato_id, _ct.proprietario_nome, (_calc->>'total')::numeric, _calc->'linhas',
    _feito_em, left(nullif(btrim(coalesce(_comprovante, '')), ''), 120), auth.uid()) RETURNING id INTO _id;
  PERFORM public.locacao_fin_evento(_c.organization_id, _c.contrato_id, _c.id, 'repasse',
    'Repasse feito ' || to_char(_c.competencia, 'MM/YYYY') || ' a ' || coalesce(_ct.proprietario_nome, '(proprietário)') || ': '
    || public.locacao_fin_brl((_calc->>'total')::numeric) || ' em ' || to_char(_feito_em, 'DD/MM/YYYY'),
    jsonb_build_object('repasse_id', _id, 'calculo', _calc));
  RETURN jsonb_build_object('id', _id, 'valor', (_calc->>'total')::numeric);
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_repasse_feito(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_repasse_feito(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_fin_repasse_desfazer(_repasse uuid, _motivo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _r public.locacao_repasses; _m text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  SELECT * INTO _r FROM public.locacao_repasses WHERE id = _repasse AND organization_id = _org AND desfeito_em IS NULL FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Repasse não encontrado.' USING ERRCODE = '22023'; END IF;
  IF _m IS NULL OR length(_m) < 5 THEN RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = '22023'; END IF;
  UPDATE public.locacao_repasses SET desfeito_em = now(), desfeito_por = auth.uid(), desfeito_motivo = left(_m, 500)
   WHERE id = _r.id;
  PERFORM public.locacao_fin_evento(_org, _r.contrato_id, _r.cobranca_id, 'repasse_desfeito',
    'Registro de repasse desfeito (' || public.locacao_fin_brl(_r.valor) || '): ' || _m,
    jsonb_build_object('repasse_id', _r.id, 'motivo', _m));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_repasse_desfazer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_repasse_desfazer(uuid, text) TO authenticated;

-- Extrato por proprietário (todas as competências): créditos/débitos de cada cobrança paga e repasses feitos.
CREATE OR REPLACE FUNCTION public.locacao_fin_extrato(_proprietario text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _p text := lower(btrim(coalesce(_proprietario, '')));
BEGIN
  IF length(_p) < 3 THEN RAISE EXCEPTION 'Proprietário inválido.' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object(
    'proprietario', btrim(_proprietario),
    'contratos', (SELECT coalesce(jsonb_agg(public.locacao_fin_ct_json(ct) ORDER BY ct.numero), '[]')
                    FROM public.locacao_contratos ct WHERE ct.organization_id = _org AND lower(btrim(ct.proprietario_nome)) = _p),
    'cobrancas', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.pago_em, c.competencia), '[]')
                    FROM public.locacao_cobrancas c JOIN public.locacao_contratos ct ON ct.id = c.contrato_id
                   WHERE c.organization_id = _org AND lower(btrim(ct.proprietario_nome)) = _p AND c.status = 'paga'));
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_extrato(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_extrato(text) TO authenticated;

-- Regras financeiras (Financeiro da locação ou administração da imobiliária). Toda mudança fica no histórico.
CREATE OR REPLACE FUNCTION public.locacao_fin_config_salvar(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _antes public.locacao_fin_config; _c public.locacao_fin_config;
BEGIN
  IF NOT (public.locacao_tem_papel(auth.uid(), 'financeiro') OR public.locacao_eh_gerencia(auth.uid())) THEN
    RAISE EXCEPTION 'Só o Financeiro da locação ou a administração altera as regras financeiras.' USING ERRCODE = '42501';
  END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('multa_pct', 'juros_pct_mes', 'multa_sobre', 'multa_para', 'dias_repasse', 'condominio_no_boleto', 'iptu_no_boleto',
      'iptu_repassa_proprietario', 'indice', 'retem_primeiro_aluguel')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  _antes := public.locacao_fin_cfg(_org);
  INSERT INTO public.locacao_fin_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.locacao_fin_config SET
    multa_pct = coalesce((_dados->>'multa_pct')::numeric, multa_pct),
    juros_pct_mes = coalesce((_dados->>'juros_pct_mes')::numeric, juros_pct_mes),
    multa_sobre = coalesce(_dados->>'multa_sobre', multa_sobre), multa_para = coalesce(_dados->>'multa_para', multa_para),
    dias_repasse = coalesce((_dados->>'dias_repasse')::integer, dias_repasse),
    condominio_no_boleto = coalesce((_dados->>'condominio_no_boleto')::boolean, condominio_no_boleto),
    iptu_no_boleto = coalesce((_dados->>'iptu_no_boleto')::boolean, iptu_no_boleto),
    iptu_repassa_proprietario = coalesce((_dados->>'iptu_repassa_proprietario')::boolean, iptu_repassa_proprietario),
    indice = coalesce(_dados->>'indice', indice),
    retem_primeiro_aluguel = coalesce((_dados->>'retem_primeiro_aluguel')::boolean, retem_primeiro_aluguel),
    atualizado_em = now(), atualizado_por = auth.uid()
   WHERE organization_id = _org RETURNING * INTO _c;
  PERFORM public.locacao_fin_evento(_org, NULL, NULL, 'regras', 'Regras financeiras alteradas',
    jsonb_build_object('antes', to_jsonb(_antes) - 'organization_id' - 'atualizado_por' - 'atualizado_em',
                       'depois', to_jsonb(_c) - 'organization_id' - 'atualizado_por' - 'atualizado_em'));
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_fin_config_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_fin_config_salvar(jsonb) TO authenticated;

COMMIT;

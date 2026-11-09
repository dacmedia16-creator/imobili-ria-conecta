-- Módulo de Locação — Fase 1 (esteira + comissão). Cartão t_74426f94; maquete aprovada por Denis em 09/11/2026
-- (t_660d2262, tópico 6238). CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA. Rollback: supabase/rollback/20261110120000_locacao_fase1.sql
-- Teste: supabase/tests/run-locacao.sh (transação desfeita; nunca produção).
--
-- Esteira igual à da venda: o CORRETOR preenche e sobe tudo; nada é enviado ao cliente.
-- 9 etapas, cada uma com responsável e data (etapa_desde + histórico em locacao_eventos):
--   pre_analise (corretor) → aprovacao (gestora) → documentacao (corretor, trava de documentos) →
--   conferencia (gestora) → minuta (setor de contratos) → assinatura (setor de contratos) →
--   pos_assinatura (vistoria/seguro) → chaves (vistoria/seguro) → comissao (mês seguinte à entrega das chaves).
-- Reprovar/devolver exige motivo. Comissão: alerta de titularidade NÃO bloqueia.
-- Assinatura: registro MANUAL dos envelopes (administração, locação, vistoria). A integração Clicksign existente é
-- da venda/captação; ligá-la à locação fica como pendência (sem custo novo nesta fase).
--
-- Regras ainda NÃO confirmadas por Denis ficam em locacao_config (por imobiliária), com o padrão da maquete:
-- % do coordenador, se sai da parte do corretor, parceria, dia de pagamento, pré-análise reprovada (volta/encerra),
-- chave antes do laudo, seguro incêndio obrigatório, lista de documentos por garantia, tabela taxa → %.
--
-- Papéis novos (por imobiliária, atribuídos por admin/administrador principal/staff): gestora, contratos, vistoria.
-- Administrador e administrador principal podem agir em qualquer papel (mesma regra já usada na venda).
-- Arquivos: bucket PRIVADO 'locacao-documentos'. O navegador nunca grava direto: o servidor do ADM confere a
-- permissão no banco (RPC com o login de quem clicou) e só então gera URL assinada (upload ou leitura).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Chave do módulo (nasce DESLIGADO: nenhuma linha) ------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra',
                    'locacao'));

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
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra',
                                        'locacao')
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

CREATE OR REPLACE FUNCTION public.locacao_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'locacao'), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_modulo_ligado(uuid) TO service_role;

-- Para a tela: módulo ligado na imobiliária de quem está logado.
CREATE OR REPLACE FUNCTION public.locacao_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.locacao_modulo_ligado(public.current_org_id())
    AND NOT coalesce(public.eh_so_fotografo(auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_enabled() TO authenticated, service_role;

-- 2) Tabelas (RLS ligada e nenhum grant a anon/authenticated; tudo pelas RPCs) ------------------------------------
-- Lista inicial sugerida de documentos por garantia (a confirmar; editável por imobiliária).
CREATE OR REPLACE FUNCTION public.locacao_docs_padrao() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "seguro_fianca":["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"]
  }'::jsonb
$$;
REVOKE ALL ON FUNCTION public.locacao_docs_padrao() FROM PUBLIC, anon, authenticated;

-- Regras por imobiliária. Sem linha = padrão da maquete (mesmos defaults abaixo). Tudo aqui é "a confirmar".
CREATE TABLE public.locacao_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  pct_coordenador numeric(5, 2) NOT NULL DEFAULT 10 CONSTRAINT locacao_config_pct_coord_check
    CHECK (pct_coordenador BETWEEN 0 AND 100),
  coordenador_sai_do_corretor boolean NOT NULL DEFAULT true,
  parceria_divide_por_dois boolean NOT NULL DEFAULT true,
  coordenador_na_parceria boolean NOT NULL DEFAULT true,
  dia_pagamento_1a15 integer NOT NULL DEFAULT 8 CONSTRAINT locacao_config_dia1_check CHECK (dia_pagamento_1a15 BETWEEN 1 AND 28),
  dia_pagamento_16a31 integer NOT NULL DEFAULT 6 CONSTRAINT locacao_config_dia2_check CHECK (dia_pagamento_16a31 BETWEEN 1 AND 28),
  reprovada_volta_ao_corretor boolean NOT NULL DEFAULT true,
  chave_antes_do_laudo boolean NOT NULL DEFAULT true,
  seguro_incendio_obrigatorio boolean NOT NULL DEFAULT false,
  -- Taxa de administração (%) → % do 1º aluguel para o lado da casa. Padrão: 10→50, 9→45, 8→40, 7→35, 6→30.
  tabela_taxa jsonb NOT NULL DEFAULT '{"10":50,"9":45,"8":40,"7":35,"6":30}'::jsonb
    CONSTRAINT locacao_config_tabela_check CHECK (jsonb_typeof(tabela_taxa) = 'object'),
  documentos jsonb NOT NULL DEFAULT public.locacao_docs_padrao()
    CONSTRAINT locacao_config_documentos_check CHECK (jsonb_typeof(documentos) = 'object'),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

CREATE TABLE public.locacao_papeis (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  papel text NOT NULL CONSTRAINT locacao_papeis_papel_check CHECK (papel IN ('gestora', 'contratos', 'vistoria')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  PRIMARY KEY (organization_id, user_id, papel)
);

CREATE SEQUENCE public.locacoes_numero_seq;
CREATE TABLE public.locacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  numero bigint NOT NULL DEFAULT nextval('public.locacoes_numero_seq'),
  corretor_id uuid NOT NULL,
  etapa text NOT NULL DEFAULT 'pre_analise' CONSTRAINT locacoes_etapa_check CHECK (etapa IN
    ('pre_analise', 'aprovacao', 'documentacao', 'conferencia', 'minuta', 'assinatura', 'pos_assinatura', 'chaves', 'comissao')),
  situacao text NOT NULL DEFAULT 'ativa' CONSTRAINT locacoes_situacao_check CHECK (situacao IN ('ativa', 'encerrada')),
  devolvida boolean NOT NULL DEFAULT false,
  motivo_devolucao text,
  etapa_desde timestamptz NOT NULL DEFAULT now(),
  -- Pré-análise (sem documentos): candidato e imóvel.
  candidato jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacoes_candidato_check CHECK (jsonb_typeof(candidato) = 'object'),
  endereco text CONSTRAINT locacoes_endereco_check CHECK (endereco IS NULL OR length(endereco) <= 300),
  tipo text NOT NULL DEFAULT 'residencial' CONSTRAINT locacoes_tipo_check CHECK (tipo IN ('residencial', 'comercial')),
  garantia text NOT NULL DEFAULT 'fiador' CONSTRAINT locacoes_garantia_check CHECK (garantia IN ('fiador', 'caucao', 'seguro_fianca')),
  aluguel numeric(12, 2) CONSTRAINT locacoes_aluguel_check CHECK (aluguel > 0 AND aluguel < 10000000),
  condominio numeric(12, 2) NOT NULL DEFAULT 0 CONSTRAINT locacoes_condominio_check CHECK (condominio >= 0 AND condominio < 10000000),
  iptu numeric(12, 2) NOT NULL DEFAULT 0 CONSTRAINT locacoes_iptu_check CHECK (iptu >= 0 AND iptu < 10000000),
  taxa_adm numeric(5, 2) NOT NULL DEFAULT 10 CONSTRAINT locacoes_taxa_check CHECK (taxa_adm > 0 AND taxa_adm <= 30),
  parceria boolean NOT NULL DEFAULT false,
  -- Setor de contratos: estado da minuta (elaborando, pendencia, com_corretor, ajuste, aprovada) + externa (outra RE/MAX).
  minuta jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacoes_minuta_check CHECK (jsonb_typeof(minuta) = 'object'),
  -- Envelopes (registro manual): adm, loc, vist = nao | pendente | assinado; enviado_em; vist_junto.
  assinatura jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacoes_assinatura_check CHECK (jsonb_typeof(assinatura) = 'object'),
  -- Pós-assinatura: vistoria, seguro, condomínio, titularidades (cpfl/saae/gas com aplica + protocolo).
  pos jsonb NOT NULL DEFAULT '{"tit":{"cpfl":{"aplica":true},"saae":{"aplica":true},"gas":{"aplica":false}}}'::jsonb
    CONSTRAINT locacoes_pos_check CHECK (jsonb_typeof(pos) = 'object'),
  chave_em date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacoes_numero_unico UNIQUE (numero)
);
CREATE INDEX locacoes_org_etapa_idx ON public.locacoes (organization_id, etapa);
CREATE INDEX locacoes_corretor_idx ON public.locacoes (corretor_id);

CREATE TABLE public.locacao_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  item text NOT NULL CONSTRAINT locacao_documentos_item_check CHECK (length(item) BETWEEN 1 AND 200),
  storage_path text NOT NULL,
  nome_arquivo text NOT NULL CONSTRAINT locacao_documentos_nome_check CHECK (length(nome_arquivo) BETWEEN 1 AND 200),
  enviado_por uuid,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz
);
CREATE INDEX locacao_documentos_loc_idx ON public.locacao_documentos (locacao_id);

CREATE TABLE public.locacao_eventos (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  etapa text NOT NULL,
  papel text NOT NULL,
  descricao text NOT NULL,
  ator_id uuid,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locacao_eventos_loc_idx ON public.locacao_eventos (locacao_id, em);

ALTER TABLE public.locacao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_papeis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_config, public.locacao_papeis, public.locacoes, public.locacao_documentos,
  public.locacao_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.locacoes_numero_seq, public.locacao_eventos_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_config, public.locacao_papeis, public.locacoes, public.locacao_documentos,
  public.locacao_eventos TO service_role;
GRANT USAGE ON SEQUENCE public.locacoes_numero_seq, public.locacao_eventos_id_seq TO service_role;

-- Bucket privado dos documentos (sem política para authenticated: só URL assinada gerada pelo servidor).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('locacao-documentos', 'locacao-documentos', false, 16777216,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'locacao-documentos' AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket locacao-documentos deve ser privado'; END IF;
END $$;

-- 3) Funções internas (sem grant a ninguém) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_cfg(_org uuid) RETURNS public.locacao_config
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_config;
BEGIN
  SELECT * INTO _c FROM public.locacao_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    -- Sem linha: padrão da maquete (mesmos valores dos DEFAULT da tabela).
    _c.organization_id := _org; _c.pct_coordenador := 10; _c.coordenador_sai_do_corretor := true;
    _c.parceria_divide_por_dois := true; _c.coordenador_na_parceria := true; _c.dia_pagamento_1a15 := 8;
    _c.dia_pagamento_16a31 := 6; _c.reprovada_volta_ao_corretor := true; _c.chave_antes_do_laudo := true;
    _c.seguro_incendio_obrigatorio := false; _c.tabela_taxa := '{"10":50,"9":45,"8":40,"7":35,"6":30}'::jsonb;
    _c.documentos := public.locacao_docs_padrao();
  END IF;
  RETURN _c;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_eh_gerencia(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(public.has_any_role(_uid, ARRAY['admin', 'super_admin', 'staff']::public.app_role[]), false)
$$;

-- Age no papel: tem o papel de locação na imobiliária OU é administrador/administrador principal.
CREATE OR REPLACE FUNCTION public.locacao_tem_papel(_uid uuid, _papel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_uid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = public.current_org_id()
             AND p.user_id = _uid AND p.papel = _papel)
    OR public.has_any_role(_uid, ARRAY['admin', 'super_admin']::public.app_role[])), false)
$$;

CREATE OR REPLACE FUNCTION public.locacao_ctx() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(auth.uid()), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.locacao_enabled() THEN
    RAISE EXCEPTION 'Locação desligada nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;

-- Ver: corretor dono; quem tem papel de locação; gerência; financeiro; gestor/líder do corretor.
CREATE OR REPLACE FUNCTION public.locacao_pode_ver(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_l.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL AND (
    _l.corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id AND p.user_id = auth.uid())
    OR public.locacao_eh_gerencia(auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['financeiro']::public.app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::public.app_role[])
        AND public.is_lead_of(auth.uid(), _l.corretor_id))), false)
$$;

CREATE OR REPLACE FUNCTION public.locacao_pega(_id uuid) RETURNS public.locacoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  IF _l.situacao <> 'ativa' THEN
    RAISE EXCEPTION 'Locação encerrada.' USING ERRCODE = '22023';
  END IF;
  RETURN _l;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_exige(_l public.locacoes, _etapas text[], _papel text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT (_l.etapa = ANY (_etapas)) THEN
    RAISE EXCEPTION 'Ação não disponível nesta etapa.' USING ERRCODE = '22023';
  END IF;
  IF _papel = 'corretor' THEN
    IF _l.corretor_id <> auth.uid() AND NOT public.has_any_role(auth.uid(), ARRAY['admin', 'super_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Só o corretor da locação faz esta ação.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.locacao_tem_papel(auth.uid(), _papel) THEN
    RAISE EXCEPTION 'Sem o papel necessário (%).', _papel USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_evento(_l public.locacoes, _papel text, _descricao text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  INSERT INTO public.locacao_eventos (organization_id, locacao_id, etapa, papel, descricao, ator_id)
  VALUES (_l.organization_id, _l.id, _l.etapa, _papel, left(_descricao, 500), auth.uid())
$$;

-- Muda de etapa: data e responsável ficam no histórico.
CREATE OR REPLACE FUNCTION public.locacao_mover(_id uuid, _etapa text, _devolvida boolean, _motivo text)
RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  UPDATE public.locacoes SET etapa = _etapa, etapa_desde = now(), devolvida = _devolvida,
    motivo_devolucao = CASE WHEN _devolvida THEN _motivo END, atualizado_em = now()
   WHERE id = _id RETURNING *
$$;

CREATE OR REPLACE FUNCTION public.locacao_checklist(_org uuid, _garantia text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH d AS (SELECT (public.locacao_cfg(_org)).documentos AS j)
  SELECT coalesce(array_agg(x ORDER BY g, n), ARRAY[]::text[]) FROM d,
    LATERAL (SELECT 1 AS g, value AS x, ordinality AS n FROM jsonb_array_elements_text(coalesce(d.j->'locatario', '[]')) WITH ORDINALITY
             UNION ALL SELECT 2, value, ordinality FROM jsonb_array_elements_text(coalesce(d.j->_garantia, '[]')) WITH ORDINALITY
             UNION ALL SELECT 3, value, ordinality FROM jsonb_array_elements_text(coalesce(d.j->'proprietario', '[]')) WITH ORDINALITY) i
$$;

CREATE OR REPLACE FUNCTION public.locacao_docs_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(i ORDER BY n), ARRAY[]::text[])
    FROM unnest(public.locacao_checklist(_l.organization_id, _l.garantia)) WITH ORDINALITY AS t(i, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = t.i
                        AND d.removido_em IS NULL)
$$;

REVOKE ALL ON FUNCTION public.locacao_cfg(uuid), public.locacao_eh_gerencia(uuid), public.locacao_tem_papel(uuid, text),
  public.locacao_ctx(), public.locacao_pode_ver(public.locacoes), public.locacao_pega(uuid),
  public.locacao_exige(public.locacoes, text[], text), public.locacao_evento(public.locacoes, text, text),
  public.locacao_mover(uuid, text, boolean, text), public.locacao_checklist(uuid, text),
  public.locacao_docs_faltando(public.locacoes) FROM PUBLIC, anon, authenticated;

-- 4) Leitura -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_json(_l public.locacoes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT to_jsonb(_l) || jsonb_build_object(
    'codigo', 'LOC-' || lpad(_l.numero::text, 4, '0'),
    'corretor_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _l.corretor_id),
    'coordenador_nome', (SELECT p.nome FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        JOIN public.profiles p ON p.id = t.lider_id
       WHERE tm.membro_id = _l.corretor_id AND t.organization_id = _l.organization_id
       ORDER BY tm.created_at DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.locacao_json(public.locacoes) FROM PUBLIC, anon, authenticated;

-- Quem sou na locação + regras da imobiliária + pessoas de cada papel.
CREATE OR REPLACE FUNCTION public.locacao_contexto() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _uid uuid := auth.uid(); _c public.locacao_config;
BEGIN
  _c := public.locacao_cfg(_org);
  RETURN jsonb_build_object(
    'usuario_id', _uid,
    'papeis', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') FROM unnest(ARRAY['gestora', 'contratos', 'vistoria']) x
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

CREATE OR REPLACE FUNCTION public.locacao_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(public.locacao_json(l) ORDER BY l.etapa_desde), '[]')
            FROM public.locacoes l WHERE l.organization_id = _org AND public.locacao_pode_ver(l));
END $$;
REVOKE ALL ON FUNCTION public.locacao_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  RETURN public.locacao_json(_l) || jsonb_build_object(
    'checklist', to_jsonb(public.locacao_checklist(_org, _l.garantia)),
    'faltando', to_jsonb(public.locacao_docs_faltando(_l)),
    'documentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'item', d.item, 'nome_arquivo', d.nome_arquivo,
        'enviado_em', d.enviado_em) ORDER BY d.enviado_em), '[]')
        FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.removido_em IS NULL),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;
REVOKE ALL ON FUNCTION public.locacao_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_detalhe(uuid) TO authenticated;

-- 5) Regras e papéis (administração da imobiliária) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_config_salvar(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _c public.locacao_config; _k text; _v jsonb;
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária altera as regras.' USING ERRCODE = '42501';
  END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('pct_coordenador', 'coordenador_sai_do_corretor', 'parceria_divide_por_dois', 'coordenador_na_parceria',
      'dia_pagamento_1a15', 'dia_pagamento_16a31', 'reprovada_volta_ao_corretor', 'chave_antes_do_laudo',
      'seguro_incendio_obrigatorio', 'tabela_taxa', 'documentos')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  IF _dados ? 'tabela_taxa' THEN
    IF jsonb_typeof(_dados->'tabela_taxa') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'tabela_taxa') e
       WHERE e.key !~ '^[0-9]{1,2}$' OR jsonb_typeof(e.value) <> 'number' OR (e.value)::text::numeric NOT BETWEEN 0 AND 100) THEN
      RAISE EXCEPTION 'Tabela de taxa inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF _dados ? 'documentos' THEN
    IF jsonb_typeof(_dados->'documentos') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'documentos') e
       WHERE e.key NOT IN ('locatario', 'fiador', 'caucao', 'seguro_fianca', 'proprietario') OR jsonb_typeof(e.value) <> 'array'
          OR jsonb_array_length(e.value) > 30 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) x
             WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 2 AND 200)) THEN
      RAISE EXCEPTION 'Lista de documentos inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.locacao_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.locacao_config SET
    pct_coordenador = coalesce((_dados->>'pct_coordenador')::numeric, pct_coordenador),
    coordenador_sai_do_corretor = coalesce((_dados->>'coordenador_sai_do_corretor')::boolean, coordenador_sai_do_corretor),
    parceria_divide_por_dois = coalesce((_dados->>'parceria_divide_por_dois')::boolean, parceria_divide_por_dois),
    coordenador_na_parceria = coalesce((_dados->>'coordenador_na_parceria')::boolean, coordenador_na_parceria),
    dia_pagamento_1a15 = coalesce((_dados->>'dia_pagamento_1a15')::integer, dia_pagamento_1a15),
    dia_pagamento_16a31 = coalesce((_dados->>'dia_pagamento_16a31')::integer, dia_pagamento_16a31),
    reprovada_volta_ao_corretor = coalesce((_dados->>'reprovada_volta_ao_corretor')::boolean, reprovada_volta_ao_corretor),
    chave_antes_do_laudo = coalesce((_dados->>'chave_antes_do_laudo')::boolean, chave_antes_do_laudo),
    seguro_incendio_obrigatorio = coalesce((_dados->>'seguro_incendio_obrigatorio')::boolean, seguro_incendio_obrigatorio),
    tabela_taxa = coalesce(_dados->'tabela_taxa', tabela_taxa),
    documentos = coalesce(_dados->'documentos', documentos),
    atualizado_em = now(), atualizado_por = auth.uid()
   WHERE organization_id = _org RETURNING * INTO _c;
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_config_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_config_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_papeis_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária atribui papéis.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'nome', p.nome,
      'papeis', (SELECT coalesce(jsonb_agg(x.papel ORDER BY x.papel), '[]') FROM public.locacao_papeis x
                  WHERE x.organization_id = _org AND x.user_id = p.id)) ORDER BY p.nome), '[]')
    FROM public.profiles p JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
   WHERE p.ativo AND NOT coalesce(public.eh_so_fotografo(p.id), false));
END $$;
REVOKE ALL ON FUNCTION public.locacao_papeis_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_papeis_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_papel_definir(_user uuid, _papel text, _ativo boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária atribui papéis.' USING ERRCODE = '42501';
  END IF;
  IF _papel IS NULL OR _papel NOT IN ('gestora', 'contratos', 'vistoria') OR _ativo IS NULL THEN
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

-- 6) Etapas 1–4: corretor e gestora ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_criar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['corretor', 'gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só corretores criam locações.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.locacoes (organization_id, corretor_id) VALUES (_org, auth.uid()) RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise iniciada');
  RETURN jsonb_build_object('id', _l.id);
END $$;
REVOKE ALL ON FUNCTION public.locacao_criar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_criar() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_salvar_pre(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _cand jsonb;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('candidato', 'endereco', 'tipo', 'garantia', 'aluguel', 'condominio', 'iptu', 'taxa_adm', 'parceria')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  _cand := coalesce(_dados->'candidato', _l.candidato);
  IF jsonb_typeof(_cand) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_cand) e
     WHERE e.key NOT IN ('cpf', 'nome', 'nascimento', 'telefone', 'email') OR jsonb_typeof(e.value) NOT IN ('string', 'null')
        OR length(coalesce(e.value #>> '{}', '')) > 200) THEN
    RAISE EXCEPTION 'Dados do candidato inválidos' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET candidato = _cand,
    endereco = CASE WHEN _dados ? 'endereco' THEN nullif(btrim(_dados->>'endereco'), '') ELSE endereco END,
    tipo = coalesce(_dados->>'tipo', tipo), garantia = coalesce(_dados->>'garantia', garantia),
    aluguel = CASE WHEN _dados ? 'aluguel' THEN nullif((_dados->>'aluguel')::numeric, 0) ELSE aluguel END,
    condominio = coalesce((_dados->>'condominio')::numeric, condominio), iptu = coalesce((_dados->>'iptu')::numeric, iptu),
    taxa_adm = coalesce((_dados->>'taxa_adm')::numeric, taxa_adm), parceria = coalesce((_dados->>'parceria')::boolean, parceria),
    atualizado_em = now()
   WHERE id = _id RETURNING * INTO _l;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido na pré-análise' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_salvar_pre(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_salvar_pre(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_enviar_pre(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF coalesce(_l.candidato->>'cpf', '') !~ '^[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}$' THEN _f := array_append(_f, 'CPF'); END IF;
  IF length(btrim(coalesce(_l.candidato->>'nome', ''))) < 5 THEN _f := array_append(_f, 'nome completo'); END IF;
  IF coalesce(_l.candidato->>'nascimento', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN _f := array_append(_f, 'data de nascimento'); END IF;
  IF length(regexp_replace(coalesce(_l.candidato->>'telefone', ''), '[^0-9]', '', 'g')) < 10 THEN _f := array_append(_f, 'telefone'); END IF;
  IF coalesce(_l.candidato->>'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN _f := array_append(_f, 'e-mail'); END IF;
  IF length(coalesce(_l.endereco, '')) < 8 THEN _f := array_append(_f, 'endereço do imóvel'); END IF;
  IF _l.aluguel IS NULL THEN _f := array_append(_f, 'aluguel'); END IF;
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'aprovacao', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise enviada à gestora');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;
REVOKE ALL ON FUNCTION public.locacao_enviar_pre(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_enviar_pre(uuid) TO authenticated;

-- Gestora: aprova ou reprova (pré-análise) / dá ok ou devolve (conferência). Reprovar/devolver exige motivo.
CREATE OR REPLACE FUNCTION public.locacao_gestora_decidir(_id uuid, _aprovar boolean, _motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m text := nullif(btrim(coalesce(_motivo, '')), '');
  _c public.locacao_config;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['aprovacao', 'conferencia'], 'gestora');
  IF _aprovar IS NULL THEN RAISE EXCEPTION 'Decisão inválida' USING ERRCODE = '22023'; END IF;
  IF NOT _aprovar AND (_m IS NULL OR length(_m) < 5) THEN
    RAISE EXCEPTION 'Informe o motivo para reprovar ou devolver.' USING ERRCODE = '22023';
  END IF;
  IF _l.etapa = 'aprovacao' THEN
    IF _aprovar THEN
      _l := public.locacao_mover(_id, 'documentacao', false, NULL);
      PERFORM public.locacao_evento(_l, 'gestora', 'Pré-análise APROVADA');
    ELSE
      _c := public.locacao_cfg(_l.organization_id);
      IF _c.reprovada_volta_ao_corretor THEN
        _l := public.locacao_mover(_id, 'pre_analise', true, left(_m, 500));
        PERFORM public.locacao_evento(_l, 'gestora', 'Pré-análise REPROVADA: ' || _m);
      ELSE
        UPDATE public.locacoes SET situacao = 'encerrada', motivo_devolucao = left(_m, 500), atualizado_em = now()
         WHERE id = _id RETURNING * INTO _l;
        PERFORM public.locacao_evento(_l, 'gestora', 'Pré-análise REPROVADA e locação encerrada: ' || _m);
      END IF;
    END IF;
  ELSE
    IF _aprovar THEN
      IF cardinality(public.locacao_docs_faltando(_l)) > 0 THEN
        RAISE EXCEPTION 'Ainda há documento pendente.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.locacoes SET minuta = jsonb_build_object('estado', 'elaborando', 'externa', false) WHERE id = _id;
      _l := public.locacao_mover(_id, 'minuta', false, NULL);
      PERFORM public.locacao_evento(_l, 'gestora', 'Documentação conferida — enviada ao setor de contratos');
    ELSE
      _l := public.locacao_mover(_id, 'documentacao', true, left(_m, 500));
      PERFORM public.locacao_evento(_l, 'gestora', 'Documentação DEVOLVIDA: ' || _m);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa, 'situacao', _l.situacao);
END $$;
REVOKE ALL ON FUNCTION public.locacao_gestora_decidir(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_gestora_decidir(uuid, boolean, text) TO authenticated;

-- Documentos: o servidor pede o caminho (confere permissão), sobe por URL assinada e depois registra.
CREATE OR REPLACE FUNCTION public.locacao_documento_preparar(_id uuid, _item text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist(_l.organization_id, _l.garantia))) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Tipo de arquivo não aceito (PDF ou imagem).' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/' || gen_random_uuid()::text || '.' || _ext);
END $$;
REVOKE ALL ON FUNCTION public.locacao_documento_preparar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_documento_preparar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_documento_registrar(_id uuid, _item text, _path text, _nome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist(_l.organization_id, _l.garantia))) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_documentos WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo, enviado_por)
  VALUES (_l.organization_id, _l.id, _item, _path, left(coalesce(nullif(btrim(_nome), ''), 'arquivo'), 200), auth.uid())
  RETURNING id INTO _d;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento anexado: ' || _item);
  RETURN jsonb_build_object('id', _d);
END $$;
REVOKE ALL ON FUNCTION public.locacao_documento_registrar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_documento_registrar(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_documento_remover(_doc uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  _l := public.locacao_pega(_d.locacao_id);
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  UPDATE public.locacao_documentos SET removido_em = now() WHERE id = _doc;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento removido: ' || _d.item);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.locacao_documento_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_documento_remover(uuid) TO authenticated;

-- Abrir documento: devolve o caminho só para quem vê a locação (o servidor gera a URL assinada curta).
CREATE OR REPLACE FUNCTION public.locacao_documento_ver(_doc uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND organization_id = _org AND removido_em IS NULL;
  SELECT * INTO _l FROM public.locacoes WHERE id = _d.locacao_id;
  IF _d.id IS NULL OR _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a este documento.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('path', _d.storage_path, 'nome', _d.nome_arquivo);
END $$;
REVOKE ALL ON FUNCTION public.locacao_documento_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_documento_ver(uuid) TO authenticated;

-- Trava: não envia à gestora com documento pendente.
CREATE OR REPLACE FUNCTION public.locacao_enviar_documentacao(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  _f := public.locacao_docs_faltando(_l);
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Faltam % documento(s): %', cardinality(_f), array_to_string(_f, '; ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'conferencia', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Documentação completa enviada para conferência');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;
REVOKE ALL ON FUNCTION public.locacao_enviar_documentacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_enviar_documentacao(uuid) TO authenticated;

-- 7) Etapas 5–6: setor de contratos e corretor na minuta ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _a jsonb; _t text; _doc text;
BEGIN
  _m := _l.minuta; _a := _l.assinatura; _dados := coalesce(_dados, '{}'::jsonb);
  _t := nullif(btrim(coalesce(_dados->>'texto', '')), '');
  IF _acao IN ('cobrar_pendencia', 'enviar_minuta', 'marcar_ajuste', 'minuta_externa', 'preparar_assinatura') THEN
    PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  ELSIF _acao IN ('registrar_envio', 'marcar_assinado') THEN
    PERFORM public.locacao_exige(_l, ARRAY['assinatura'], 'contratos');
  ELSE
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;

  IF _acao = 'cobrar_pendencia' THEN
    IF _t IS NULL OR length(_t) < 5 THEN RAISE EXCEPTION 'Descreva a pendência.' USING ERRCODE = '22023'; END IF;
    _m := _m || jsonb_build_object('estado', 'pendencia', 'pendencia', left(_t, 500));
    PERFORM public.locacao_evento(_l, 'contratos', 'Contratos cobrou pendência do corretor: ' || _t);
  ELSIF _acao = 'minuta_externa' THEN
    _m := _m || jsonb_build_object('externa', coalesce((_dados->>'externa')::boolean, true));
    PERFORM public.locacao_evento(_l, 'contratos', CASE WHEN (_m->>'externa')::boolean
      THEN 'Atalho: minuta pronta de outra RE/MAX' ELSE 'Atalho de minuta externa desmarcado' END);
  ELSIF _acao = 'enviar_minuta' THEN
    _m := _m || jsonb_build_object('estado', 'com_corretor',
      'modelo', CASE WHEN _l.tipo = 'comercial' THEN 'Comercial' ELSE 'Residencial' END || ' — ' ||
        CASE _l.garantia WHEN 'fiador' THEN 'Fiador' WHEN 'caucao' THEN 'Caução' ELSE 'Seguro-fiança' END);
    PERFORM public.locacao_evento(_l, 'contratos', CASE WHEN coalesce((_m->>'externa')::boolean, false)
      THEN 'Minuta externa (outra RE/MAX) enviada ao corretor' ELSE 'Minuta enviada ao corretor (' || (_m->>'modelo') || ')' END);
  ELSIF _acao = 'marcar_ajuste' THEN
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', coalesce(left(_t, 500), 'Pedido do proprietário'));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta EM AJUSTE: ' || coalesce(_t, 'pedido do proprietário'));
  ELSIF _acao = 'preparar_assinatura' THEN
    IF coalesce(_m->>'estado', '') <> 'aprovada' AND NOT coalesce((_m->>'externa')::boolean, false) THEN
      RAISE EXCEPTION 'A minuta ainda não foi aprovada pelo corretor/proprietário.' USING ERRCODE = '22023';
    END IF;
    _m := _m || jsonb_build_object('estado', 'aprovada');
    UPDATE public.locacoes SET minuta = _m, assinatura = jsonb_build_object('adm', 'nao', 'loc', 'nao', 'vist', 'nao',
      'vist_junto', false, 'modo', 'manual') WHERE id = _id;
    _l := public.locacao_mover(_id, 'assinatura', false, NULL);
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta aprovada — preparando assinatura');
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'registrar_envio' THEN
    IF _a->>'enviado_em' IS NOT NULL THEN RAISE EXCEPTION 'Envio já registrado.' USING ERRCODE = '22023'; END IF;
    _a := _a || jsonb_build_object('enviado_em', (now() AT TIME ZONE 'America/Sao_Paulo')::date, 'adm', 'pendente', 'loc', 'pendente',
      'vist_junto', coalesce((_dados->>'vist_junto')::boolean, false),
      'vist', CASE WHEN coalesce((_dados->>'vist_junto')::boolean, false) THEN 'pendente' ELSE 'nao' END);
    UPDATE public.locacoes SET assinatura = _a, atualizado_em = now() WHERE id = _id;
    PERFORM public.locacao_evento(_l, 'contratos', 'Envio para assinatura registrado (Clicksign, manual)'
      || CASE WHEN (_a->>'vist_junto')::boolean THEN ' com vistoria junto' ELSE '' END);
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'marcar_assinado' THEN
    _doc := _dados->>'documento';
    IF _doc IS NULL OR _doc NOT IN ('adm', 'loc', 'vist') OR coalesce(_a->>_doc, 'nao') <> 'pendente' THEN
      RAISE EXCEPTION 'Envelope inválido ou não enviado.' USING ERRCODE = '22023';
    END IF;
    _a := _a || jsonb_build_object(_doc, 'assinado');
    UPDATE public.locacoes SET assinatura = _a, atualizado_em = now(),
      pos = CASE WHEN _doc = 'vist' THEN pos || jsonb_build_object('laudo_em', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
        'vist_junto', true) ELSE pos END
     WHERE id = _id RETURNING * INTO _l;
    PERFORM public.locacao_evento(_l, 'contratos', CASE _doc WHEN 'adm' THEN 'Contrato de administração assinado'
      WHEN 'loc' THEN 'Contrato de locação assinado' ELSE 'Laudo de vistoria assinado' END);
    IF _a->>'adm' = 'assinado' AND _a->>'loc' = 'assinado' THEN
      _l := public.locacao_mover(_id, 'pos_assinatura', false, NULL);
      PERFORM public.locacao_evento(_l, 'contratos', 'Contratos assinados — segue para pós-assinatura');
    END IF;
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  END IF;
  UPDATE public.locacoes SET minuta = _m, etapa_desde = now(), atualizado_em = now() WHERE id = _id;
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_contratos_acao(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_contratos_acao(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_corretor_minuta(_id uuid, _acao text, _texto text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _t text := nullif(btrim(coalesce(_texto, '')), '');
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'corretor');
  _m := _l.minuta;
  IF _acao = 'resolver_pendencia' AND _m->>'estado' = 'pendencia' THEN
    _m := _m || jsonb_build_object('estado', 'elaborando', 'pendencia', NULL);
    PERFORM public.locacao_evento(_l, 'corretor', 'Pendência resolvida' || coalesce(': ' || _t, ''));
  ELSIF _acao = 'de_acordo' AND _m->>'estado' = 'com_corretor' THEN
    _m := _m || jsonb_build_object('estado', 'aprovada');
    PERFORM public.locacao_evento(_l, 'corretor', 'Corretor/proprietário de acordo com a minuta');
  ELSIF _acao = 'pedir_ajuste' AND _m->>'estado' = 'com_corretor' THEN
    IF _t IS NULL OR length(_t) < 5 THEN RAISE EXCEPTION 'Descreva o ajuste pedido.' USING ERRCODE = '22023'; END IF;
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', left(_t, 500));
    PERFORM public.locacao_evento(_l, 'corretor', 'Minuta EM AJUSTE (pedido do proprietário): ' || _t);
  ELSE
    RAISE EXCEPTION 'Ação não disponível agora.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET minuta = _m, etapa_desde = now(), atualizado_em = now() WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.locacao_corretor_minuta(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_corretor_minuta(uuid, text, text) TO authenticated;

-- 8) Etapas 7–9: pós-assinatura, chaves, protocolos ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_pos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _p jsonb; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _c public.locacao_config; _data date; _alerta text; _desc text; _s text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves'], 'vistoria');
  _p := _l.pos; _dados := coalesce(_dados, '{}'::jsonb);
  IF _acao = 'vistoria_pedida' THEN _p := _p || jsonb_build_object('vistoria_pedida', _hoje); _desc := 'Vistoria pedida';
  ELSIF _acao = 'laudo_assinado' THEN
    IF _p->>'vistoria_pedida' IS NULL AND NOT coalesce((_p->>'vist_junto')::boolean, false) THEN
      RAISE EXCEPTION 'Registre antes o pedido de vistoria.' USING ERRCODE = '22023';
    END IF;
    _p := _p || jsonb_build_object('laudo_em', _hoje); _desc := 'Laudo de vistoria assinado';
  ELSIF _acao = 'contestacao' THEN _p := _p || jsonb_build_object('contestacao_em', _hoje); _desc := 'Contestação de vistoria registrada';
  ELSIF _acao = 'seguro' THEN
    _p := _p || jsonb_build_object('seguro_em', _hoje, 'apolice', left(nullif(btrim(coalesce(_dados->>'apolice', '')), ''), 60));
    _desc := 'Seguro contratado' || coalesce(' — apólice ' || nullif(btrim(coalesce(_dados->>'apolice', '')), ''), '');
  ELSIF _acao = 'condominio_aviso' THEN _p := _p || jsonb_build_object('condominio_aviso', _hoje); _desc := 'Condomínio avisado';
  ELSIF _acao = 'sem_condominio' THEN _p := _p || jsonb_build_object('sem_condominio', true); _desc := 'Imóvel sem condomínio';
  ELSIF _acao = 'mudanca' THEN
    _data := (_dados->>'data')::date;
    IF _data IS NULL THEN RAISE EXCEPTION 'Informe a data da mudança.' USING ERRCODE = '22023'; END IF;
    _p := _p || jsonb_build_object('mudanca', _data); _desc := 'Mudança agendada para ' || to_char(_data, 'DD/MM/YYYY');
  ELSIF _acao = 'titularidade_aplica' THEN
    _s := _dados->>'servico';
    IF _s IS NULL OR _s NOT IN ('cpfl', 'saae', 'gas') THEN RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = '22023'; END IF;
    _p := jsonb_set(_p, ARRAY['tit', _s, 'aplica'], to_jsonb(coalesce((_dados->>'aplica')::boolean, true)), true);
    _desc := upper(_s) || CASE WHEN coalesce((_dados->>'aplica')::boolean, true) THEN ' se aplica' ELSE ' não se aplica' END;
  ELSIF _acao = 'pronto_para_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    IF _l.etapa <> 'pos_assinatura' THEN RAISE EXCEPTION 'Ação não disponível nesta etapa.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.locacoes SET pos = _p WHERE id = _id;
    _l := public.locacao_mover(_id, 'chaves', false, NULL);
    PERFORM public.locacao_evento(_l, 'vistoria', 'Pós-assinatura concluída — aguardando entrega das chaves');
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'entregar_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    _data := coalesce((_dados->>'data')::date, _hoje);
    IF _data > _hoje + 1 OR _data < _hoje - 120 THEN RAISE EXCEPTION 'Data de entrega inválida.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    IF _p->>'laudo_em' IS NULL THEN
      IF NOT _c.chave_antes_do_laudo THEN
        RAISE EXCEPTION 'Laudo de vistoria ainda não assinado: entrega da chave bloqueada nesta imobiliária.' USING ERRCODE = '22023';
      END IF;
      _alerta := ' (ALERTA: laudo de vistoria ainda não assinado)';
    END IF;
    UPDATE public.locacoes SET pos = _p, chave_em = _data WHERE id = _id;
    _l := public.locacao_mover(_id, 'comissao', false, NULL);
    UPDATE public.locacoes SET etapa_desde = _data::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE id = _id RETURNING * INTO _l;
    PERFORM public.locacao_evento(_l, 'vistoria', 'Chaves entregues em ' || to_char(_data, 'DD/MM/YYYY') || coalesce(_alerta, ''));
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa, 'alerta', _alerta IS NOT NULL);
  ELSE
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET pos = _p, atualizado_em = now() WHERE id = _id RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'vistoria', _desc);
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_pos_acao(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_pos_acao(uuid, text, jsonb) TO authenticated;

-- Corretor envia os protocolos de titularidade (não trava nada; falta só gera alerta na comissão).
CREATE OR REPLACE FUNCTION public.locacao_protocolo(_id uuid, _servico text, _protocolo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _t text := left(nullif(btrim(coalesce(_protocolo, '')), ''), 60);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves', 'comissao'], 'corretor');
  IF _servico IS NULL OR _servico NOT IN ('cpfl', 'saae', 'gas') THEN RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = '22023'; END IF;
  UPDATE public.locacoes SET pos = jsonb_set(pos, ARRAY['tit', _servico, 'protocolo'], coalesce(to_jsonb(_t), 'null'::jsonb), true),
    atualizado_em = now() WHERE id = _id RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Protocolo ' || upper(_servico) || CASE WHEN _t IS NULL THEN ' removido' ELSE ' enviado: ' || _t END);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.locacao_protocolo(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_protocolo(uuid, text, text) TO authenticated;

COMMIT;

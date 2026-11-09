-- Proposta de compra com assinatura por link + código no WhatsApp 1/3 (cartão t_4cff61a6; pedido de Denis em
-- 09/11/2026, tópico 6238). CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA. Rollback: supabase/rollback/20261109120000_proposta_compra.sql
-- Teste: supabase/tests/run-proposta-compra.sh (transação desfeita; nunca produção).
--
-- Regra principal: NÃO DUPLICAR.
-- * A proposta nasce da captação (exclusive_captures): imóvel, matrícula e vendedores (exclusive_owner_list).
--   O comprador vem do lead do CRM (leads + clientes) quando informado.
-- * O aceite NÃO cria venda sozinho. "Criar venda em rascunho" (proposta_criar_venda, só por clique) chama a
--   função que já existe (exclusive_virar_venda: sales em 'rascunho' + sale_parties) e completa comprador,
--   cônjuges, valor e pagamento. Nenhum status novo de venda; fluxo de status intocado.
-- * O lead vai para a etapa 'proposta' que já existe, pela função do CRM (lead_mudar_etapa).
-- * Link sem login no mesmo desenho do link de acompanhamento: token = HMAC(id, chave do Vault); a tabela guarda
--   só o SHA-256 do token. O código de 6 dígitos também é HMAC(id do código, chave) e a tabela guarda só o hash.
--   O código nunca volta para o navegador do corretor: só o servidor do ADM (service_role) o lê para enviar.
--
-- Decisões de Denis (09/11): validade padrão 5 dias CORRIDOS (D9); assinatura = link + código de 6 dígitos pelo
-- WhatsApp, sem camada extra (D8); D7 REVISTA (09/11, t_b4e7c368): tipo de sinal como na Campolim — arras
-- confirmatórias (padrão) ou penitenciais, gravado em sinal_tipo. Texto oficial (Campolim ajustado) montado pela tela
-- (src/lib/proposta-compra-texto.ts) a partir das colunas + termos; ainda depende de aprovação do advogado.
-- Data do documento: gravada com o PDF (documento_data = hoje); a validade conta dela (validade_ate = data + dias) e o
-- envio exige PDF do mesmo dia. Dados da imobiliária (nome, razão social, CNPJ, CRECI, endereço) e CRECI do corretor
-- vêm do cadastro e ficam retratados em `cadastro` quando o PDF é gerado (o texto assinado não muda depois).
--
-- Situações gravadas: rascunho, aguardando_assinaturas, aceita, recusada, contraproposta.
-- "vencida" é calculada na leitura (aguardando_assinaturas com validade_ate < hoje em São Paulo); sem cron novo.
-- "aceita" = todas as partes da proposta assinaram a versão atual. Partes obrigatórias: comprador; cônjuge do
-- comprador se casado/união estável; cada vendedor e o cônjuge de quem é casado/união estável; corretor do negócio.
-- Mudou o conteúdo depois do envio → nova versão: assinaturas e códigos anteriores invalidados, PDF precisa ser
-- gerado de novo, proposta volta a rascunho (registrado no histórico).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Chave do módulo (nasce DESLIGADO: nenhuma linha) ------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra'));

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
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra')
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

CREATE OR REPLACE FUNCTION public.proposta_compra_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'proposta_compra'), false)
$$;
REVOKE ALL ON FUNCTION public.proposta_compra_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_compra_modulo_ligado(uuid) TO service_role;

-- Para a tela: módulo ligado na imobiliária de quem está logado.
CREATE OR REPLACE FUNCTION public.proposta_compra_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.proposta_compra_modulo_ligado(public.current_org_id())
    AND NOT coalesce(public.eh_so_fotografo(auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.proposta_compra_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_compra_enabled() TO authenticated, service_role;

-- 1b) Endereço da imobiliária no cadastro (t_b4e7c368): o texto oficial da proposta usa nome, razão social, CNPJ,
-- CRECI-J e endereço do cadastro do ADM MAX; o cadastro não tinha endereço. Coluna aditiva, vazia para todas;
-- o admin preenche em "Dados da imobiliária" (agency_profile_save ganha a chave 'endereco').
ALTER TABLE public.organizations ADD COLUMN endereco text
  CONSTRAINT organizations_endereco_check CHECK (endereco IS NULL OR length(btrim(endereco)) BETWEEN 5 AND 200);

CREATE OR REPLACE FUNCTION public.agency_profile_save(_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.agency_can_edit() THEN
    RAISE EXCEPTION 'Sem permissão para editar dados da imobiliária' USING ERRCODE='42501';
  END IF;
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' OR
    EXISTS (SELECT 1 FROM jsonb_object_keys(_data) k WHERE k NOT IN
      ('razao_social','creci','cidade','uf','cor_primaria','cor_secundaria','logo_path','endereco')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE='22023';
  END IF;
  IF _data ? 'logo_path' AND nullif(_data->>'logo_path','') IS NOT NULL
    AND (_data->>'logo_path' !~ ('^' || _org::text || '/logo-[A-Za-z0-9-]+[.](png|jpg|webp)$')) THEN
    RAISE EXCEPTION 'Logo deve pertencer à imobiliária' USING ERRCODE='42501';
  END IF;
  UPDATE public.organizations SET
    razao_social = CASE WHEN _data ? 'razao_social' THEN nullif(btrim(_data->>'razao_social'),'') ELSE razao_social END,
    creci = CASE WHEN _data ? 'creci' THEN nullif(btrim(_data->>'creci'),'') ELSE creci END,
    cidade = CASE WHEN _data ? 'cidade' THEN nullif(btrim(_data->>'cidade'),'') ELSE cidade END,
    uf = CASE WHEN _data ? 'uf' THEN nullif(upper(btrim(_data->>'uf')),'') ELSE uf END,
    cor_primaria = CASE WHEN _data ? 'cor_primaria' THEN nullif(lower(btrim(_data->>'cor_primaria')),'') ELSE cor_primaria END,
    cor_secundaria = CASE WHEN _data ? 'cor_secundaria' THEN nullif(lower(btrim(_data->>'cor_secundaria')),'') ELSE cor_secundaria END,
    logo_path = CASE WHEN _data ? 'logo_path' THEN nullif(_data->>'logo_path','') ELSE logo_path END,
    endereco = CASE WHEN _data ? 'endereco' THEN nullif(btrim(_data->>'endereco'),'') ELSE endereco END
  WHERE id=_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliária não encontrada' USING ERRCODE='42501'; END IF;
END $$;

-- 2) Tabelas (sem acesso direto: RLS ligada e nenhum grant a anon/authenticated; tudo pelas RPCs) ------------------
CREATE TABLE public.propostas_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL,
  lead_id uuid,
  corretor_id uuid,
  -- Contraproposta: a proposta nova aponta para a anterior (que fica no histórico como 'contraproposta').
  origem_id uuid REFERENCES public.propostas_compra(id) ON DELETE SET NULL,
  versao integer NOT NULL DEFAULT 1 CONSTRAINT propostas_compra_versao_check CHECK (versao >= 1),
  situacao text NOT NULL DEFAULT 'rascunho' CONSTRAINT propostas_compra_situacao_check
    CHECK (situacao IN ('rascunho', 'aguardando_assinaturas', 'aceita', 'recusada', 'contraproposta')),
  -- Retrato do imóvel tirado da captação na criação (o texto assinado não muda se a captação mudar depois).
  imovel jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT propostas_compra_imovel_check CHECK (jsonb_typeof(imovel) = 'object'),
  valor_oferta numeric(14, 2) CONSTRAINT propostas_compra_oferta_check CHECK (valor_oferta > 0),
  forma_pagamento text CONSTRAINT propostas_compra_forma_check
    CHECK (forma_pagamento IN ('a_vista', 'sinal_financiamento', 'sinal_parcelas')),
  sinal_valor numeric(14, 2) CONSTRAINT propostas_compra_sinal_check CHECK (sinal_valor >= 0),
  sinal_prazo_dias integer CONSTRAINT propostas_compra_sinal_prazo_check CHECK (sinal_prazo_dias BETWEEN 0 AND 365),
  -- D7 revista (Denis 09/11): como na Campolim, confirmatórias (padrão) ou penitenciais (direito de arrependimento).
  sinal_tipo text NOT NULL DEFAULT 'confirmatorias' CONSTRAINT propostas_compra_sinal_tipo_check
    CHECK (sinal_tipo IN ('confirmatorias', 'penitenciais')),
  -- Campos do texto oficial que não têm coluna própria (lista fechada, limpa por proposta_termos_limpar).
  termos jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT propostas_compra_termos_check CHECK (jsonb_typeof(termos) = 'object'),
  -- Data do documento (= dia em que o PDF da versão foi gerado) e retrato do cadastro da imobiliária/corretor.
  documento_data date,
  cadastro jsonb CONSTRAINT propostas_compra_cadastro_check CHECK (cadastro IS NULL OR jsonb_typeof(cadastro) = 'object'),
  financiamento_banco text CONSTRAINT propostas_compra_banco_check CHECK (char_length(financiamento_banco) <= 80),
  financiamento_valor numeric(14, 2) CONSTRAINT propostas_compra_financiado_check CHECK (financiamento_valor >= 0),
  -- D9: dias corridos, padrão 5. validade_ate = data do envio (São Paulo) + validade_dias.
  validade_dias integer NOT NULL DEFAULT 5 CONSTRAINT propostas_compra_validade_check CHECK (validade_dias BETWEEN 1 AND 30),
  validade_ate date,
  prazo_contrato_dias integer CONSTRAINT propostas_compra_prazo_contrato_check CHECK (prazo_contrato_dias BETWEEN 1 AND 365),
  certidoes text CONSTRAINT propostas_compra_certidoes_check CHECK (certidoes IN ('vendedor_apresenta', 'dispensadas')),
  observacoes text CONSTRAINT propostas_compra_obs_check CHECK (char_length(observacoes) <= 2000),
  -- SHA-256 do PDF da versão atual (gerado pela tela com o PDF que já existe); vai para cada assinatura.
  pdf_hash text CONSTRAINT propostas_compra_pdf_hash_check CHECK (pdf_hash ~ '^[0-9a-f]{64}$'),
  enviada_em timestamptz,
  aceita_em timestamptz,
  recusada_em timestamptz,
  recusa_motivo text CONSTRAINT propostas_compra_motivo_check CHECK (char_length(recusa_motivo) BETWEEN 3 AND 1000),
  venda_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  venda_criada_em timestamptz,
  venda_criada_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT propostas_compra_recusa_tem_motivo CHECK (situacao <> 'recusada' OR recusa_motivo IS NOT NULL),
  -- Captação, lead e corretor da MESMA imobiliária (FKs compostas).
  CONSTRAINT propostas_compra_capture_org_fk FOREIGN KEY (capture_id, organization_id)
    REFERENCES public.exclusive_captures(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT propostas_compra_lead_org_fk FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.leads(id, organization_id) ON DELETE SET NULL (lead_id),
  CONSTRAINT propostas_compra_corretor_org_fk FOREIGN KEY (corretor_id, organization_id)
    REFERENCES public.profiles(id, organization_id) ON DELETE SET NULL (corretor_id)
);
CREATE INDEX propostas_compra_capture_idx ON public.propostas_compra (capture_id, criado_em DESC);
CREATE INDEX propostas_compra_corretor_idx ON public.propostas_compra (organization_id, corretor_id, situacao);
CREATE INDEX propostas_compra_lead_idx ON public.propostas_compra (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE public.proposta_partes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  proposta_id uuid NOT NULL,
  papel text NOT NULL CONSTRAINT proposta_partes_papel_check
    CHECK (papel IN ('comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge', 'corretor')),
  -- Cônjuge pareia com a parte de mesma ordem (vendedor 2 ↔ vendedor_conjuge 2).
  ordem smallint NOT NULL DEFAULT 1 CONSTRAINT proposta_partes_ordem_check CHECK (ordem BETWEEN 1 AND 60),
  tipo_pessoa text NOT NULL DEFAULT 'fisica' CONSTRAINT proposta_partes_tipo_check CHECK (tipo_pessoa IN ('fisica', 'juridica')),
  nome text CONSTRAINT proposta_partes_nome_check CHECK (char_length(nome) BETWEEN 1 AND 160),
  cpf_cnpj text CONSTRAINT proposta_partes_doc_check CHECK (cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$'),
  estado_civil text CONSTRAINT proposta_partes_ec_check
    CHECK (estado_civil IN ('solteiro', 'casado', 'uniao_estavel', 'divorciado', 'viuvo', 'separado')),
  telefone text CONSTRAINT proposta_partes_tel_check CHECK (telefone ~ '^[0-9]{10,13}$'),
  email text CONSTRAINT proposta_partes_email_check CHECK (char_length(email) <= 160 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  profile_id uuid,
  origem text NOT NULL DEFAULT 'manual' CONSTRAINT proposta_partes_origem_check
    CHECK (origem IN ('captacao', 'lead', 'perfil', 'manual')),
  token_hash text NOT NULL UNIQUE CONSTRAINT proposta_partes_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT proposta_partes_papel_ordem_uniq UNIQUE (proposta_id, papel, ordem),
  CONSTRAINT proposta_partes_proposta_org_fk FOREIGN KEY (proposta_id, organization_id)
    REFERENCES public.propostas_compra(id, organization_id) ON DELETE CASCADE
);

-- Códigos de 6 dígitos: só o hash. Código novo a cada envio/reenvio (o anterior é invalidado).
CREATE TABLE public.proposta_codigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  proposta_id uuid NOT NULL,
  parte_id uuid NOT NULL,
  versao integer NOT NULL,
  codigo_hash text NOT NULL CONSTRAINT proposta_codigos_hash_check CHECK (codigo_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL,
  tentativas smallint NOT NULL DEFAULT 0 CONSTRAINT proposta_codigos_tentativas_check CHECK (tentativas BETWEEN 0 AND 5),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  enviado_em timestamptz,
  envio_erro text CONSTRAINT proposta_codigos_erro_check CHECK (char_length(envio_erro) <= 200),
  usado_em timestamptz,
  invalidado_em timestamptz,
  CONSTRAINT proposta_codigos_parte_org_fk FOREIGN KEY (parte_id, organization_id)
    REFERENCES public.proposta_partes(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT proposta_codigos_proposta_org_fk FOREIGN KEY (proposta_id, organization_id)
    REFERENCES public.propostas_compra(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX proposta_codigos_parte_idx ON public.proposta_codigos (parte_id, criado_em DESC);

-- Assinaturas: nome, telefone, data/hora, IP, aparelho/navegador, hash do conteúdo e do PDF assinados.
CREATE TABLE public.proposta_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  proposta_id uuid NOT NULL,
  parte_id uuid NOT NULL,
  codigo_id uuid REFERENCES public.proposta_codigos(id) ON DELETE SET NULL,
  versao integer NOT NULL,
  papel text NOT NULL,
  ordem smallint NOT NULL,
  nome text,
  telefone text,
  ip text CONSTRAINT proposta_assinaturas_ip_check CHECK (char_length(ip) <= 64),
  user_agent text CONSTRAINT proposta_assinaturas_ua_check CHECK (char_length(user_agent) <= 500),
  conteudo_hash text NOT NULL CONSTRAINT proposta_assinaturas_conteudo_check CHECK (conteudo_hash ~ '^[0-9a-f]{64}$'),
  pdf_hash text NOT NULL CONSTRAINT proposta_assinaturas_pdf_check CHECK (pdf_hash ~ '^[0-9a-f]{64}$'),
  assinado_em timestamptz NOT NULL DEFAULT now(),
  invalidada_em timestamptz,
  invalidada_motivo text CONSTRAINT proposta_assinaturas_motivo_check CHECK (char_length(invalidada_motivo) <= 200),
  CONSTRAINT proposta_assinaturas_parte_org_fk FOREIGN KEY (parte_id, organization_id)
    REFERENCES public.proposta_partes(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT proposta_assinaturas_proposta_org_fk FOREIGN KEY (proposta_id, organization_id)
    REFERENCES public.propostas_compra(id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX proposta_assinaturas_valida_uniq ON public.proposta_assinaturas (parte_id) WHERE invalidada_em IS NULL;
CREATE INDEX proposta_assinaturas_proposta_idx ON public.proposta_assinaturas (proposta_id);

-- Histórico da proposta (versões, envios, assinaturas, recusa, contraproposta, venda).
CREATE TABLE public.proposta_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  proposta_id uuid NOT NULL,
  tipo text NOT NULL CONSTRAINT proposta_eventos_tipo_check CHECK (tipo ~ '^[a-z_]{3,40}$'),
  versao integer,
  detalhe text CONSTRAINT proposta_eventos_detalhe_check CHECK (char_length(detalhe) <= 1000),
  autor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposta_eventos_proposta_org_fk FOREIGN KEY (proposta_id, organization_id)
    REFERENCES public.propostas_compra(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX proposta_eventos_proposta_idx ON public.proposta_eventos (proposta_id, criado_em);

-- Tokens errados na página pública (só o hash do IP, nunca o IP).
CREATE TABLE public.proposta_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CONSTRAINT proposta_tentativas_ip_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposta_tentativas_idx ON public.proposta_tentativas (ip_hash, created_at);

ALTER TABLE public.propostas_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_partes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_codigos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposta_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.propostas_compra, public.proposta_partes, public.proposta_codigos, public.proposta_assinaturas,
  public.proposta_eventos, public.proposta_tentativas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.propostas_compra, public.proposta_partes, public.proposta_codigos, public.proposta_assinaturas,
  public.proposta_eventos, public.proposta_tentativas TO service_role;

-- Chave do HMAC no Vault (gerada aqui, nunca sai do banco).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'proposta_compra_chave') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'proposta_compra_chave',
      'Chave HMAC dos links e códigos da proposta de compra (t_4cff61a6)');
  END IF;
END $$;

-- 3) Funções internas (sem grant a ninguém) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proposta_hoje() RETURNS date
LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.proposta_sha(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$ SELECT encode(extensions.digest(_t, 'sha256'), 'hex') $$;

CREATE OR REPLACE FUNCTION public.proposta_hmac(_msg text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k text;
BEGIN
  SELECT decrypted_secret INTO _k FROM vault.decrypted_secrets WHERE name = 'proposta_compra_chave';
  IF _k IS NULL OR _msg IS NULL THEN
    RAISE EXCEPTION 'Chave da proposta de compra ausente' USING ERRCODE = '55000';
  END IF;
  RETURN extensions.hmac(_msg, _k, 'sha256');
END $$;

-- Token do link de cada parte (43 caracteres base64url).
CREATE OR REPLACE FUNCTION public.proposta_token(_parte_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT translate(encode(public.proposta_hmac('parte:' || _parte_id::text), 'base64'), '+/=', '-_')
$$;

-- Código de 6 dígitos de um envio (só o banco consegue recalcular; a tabela guarda o hash).
CREATE OR REPLACE FUNCTION public.proposta_codigo_texto(_codigo_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT lpad((('x' || substr(encode(public.proposta_hmac('codigo:' || _codigo_id::text), 'hex'), 1, 8))::bit(32)::bigint
               % 1000000)::text, 6, '0')
$$;

CREATE OR REPLACE FUNCTION public.proposta_codigo_hash(_codigo_id uuid, _codigo text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT public.proposta_sha('codigo:' || _codigo_id::text || ':' || coalesce(_codigo, ''))
$$;

-- "Casado(a)", "CASADA", "união estável" ... → valor da lista. Desconhecido = NULL (o corretor escolhe).
CREATE OR REPLACE FUNCTION public.proposta_estado_civil(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN _t IS NULL OR btrim(_t) = '' THEN NULL
    WHEN lower(_t) ~ 'uni[aã]o|convivente|companheir' THEN 'uniao_estavel'
    WHEN lower(_t) ~ 'divorc' THEN 'divorciado'
    WHEN lower(_t) ~ 'separad' THEN 'separado'
    WHEN lower(_t) ~ 'vi[uú]v' THEN 'viuvo'
    WHEN lower(_t) ~ 'casad' THEN 'casado'
    WHEN lower(_t) ~ 'solteir' THEN 'solteiro'
  END
$$;

-- Telefone só com dígitos (10 a 13); inválido = NULL.
CREATE OR REPLACE FUNCTION public.proposta_fone(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN regexp_replace(coalesce(_t, ''), '[^0-9]', '', 'g') ~ '^[0-9]{10,13}$'
              THEN regexp_replace(_t, '[^0-9]', '', 'g') END
$$;

CREATE OR REPLACE FUNCTION public.proposta_doc(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN regexp_replace(coalesce(_t, ''), '[^0-9]', '', 'g') ~ '^([0-9]{11}|[0-9]{14})$'
              THEN regexp_replace(_t, '[^0-9]', '', 'g') END
$$;

CREATE OR REPLACE FUNCTION public.proposta_precisa_conjuge(_ec text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$ SELECT coalesce(_ec IN ('casado', 'uniao_estavel'), false) $$;

-- Situação que a tela e o link mostram: vencida é calculada na leitura.
CREATE OR REPLACE FUNCTION public.proposta_situacao(_situacao text, _validade_ate date) RETURNS text
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _situacao = 'aguardando_assinaturas' AND _validade_ate IS NOT NULL
                   AND _validade_ate < public.proposta_hoje() THEN 'vencida' ELSE _situacao END
$$;

CREATE OR REPLACE FUNCTION public.proposta_codigo_documento(_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$ SELECT 'PC-' || upper(left(replace(_id::text, '-', ''), 8)) $$;

-- Campos do texto oficial sem coluna própria (t_b4e7c368): lista fechada; vazio sai; chave desconhecida = erro.
CREATE OR REPLACE FUNCTION public.proposta_termos_limpar(_t jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _k text; _v jsonb; _s text; _max int; _out jsonb := '{}'::jsonb;
BEGIN
  IF _t IS NULL OR jsonb_typeof(_t) = 'null' THEN RETURN _out; END IF;
  IF jsonb_typeof(_t) <> 'object' THEN RAISE EXCEPTION 'Termos inválidos' USING ERRCODE = '22023'; END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(_t) LOOP
    CONTINUE WHEN jsonb_typeof(_v) = 'null' OR btrim(_v #>> '{}') = '';
    _s := btrim(_v #>> '{}');
    _max := CASE _k WHEN 'comprador_rg' THEN 40 WHEN 'comprador_nacionalidade' THEN 60 WHEN 'comprador_profissao' THEN 80
      WHEN 'comprador_endereco' THEN 300 WHEN 'comprador_representante' THEN 160 WHEN 'comprador_cargo' THEN 80
      WHEN 'vendedor_conta' THEN 200 WHEN 'imovel_descricao' THEN 300
      WHEN 'proprios_quando' THEN 200 WHEN 'permuta_descricao' THEN 300 WHEN 'parcelas' THEN 900
      WHEN 'pagamento_obs' THEN 900 WHEN 'itens' THEN 900 WHEN 'posse' THEN 300 WHEN 'local' THEN 80 END;
    IF _max IS NOT NULL THEN
      IF char_length(_s) > _max THEN RAISE EXCEPTION 'Texto longo demais (%)', _k USING ERRCODE = '22023'; END IF;
      _out := _out || jsonb_build_object(_k, _s);
    ELSIF _k IN ('proprios_valor', 'fgts_valor', 'permuta_valor') THEN
      IF _s !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Valor inválido (%)', _k USING ERRCODE = '22023'; END IF;
      IF _s::numeric > 0 THEN _out := _out || jsonb_build_object(_k, _s::numeric); END IF;
    ELSIF _k = 'fin_prazo_dias' THEN
      IF _s !~ '^[0-9]{1,3}$' OR _s::int NOT BETWEEN 1 AND 365 THEN
        RAISE EXCEPTION 'Prazo de aprovação inválido' USING ERRCODE = '22023';
      END IF;
      _out := _out || jsonb_build_object(_k, _s::int);
    ELSIF _k = 'comprador_representante_cpf' THEN
      _s := regexp_replace(_s, '[^0-9]', '', 'g');
      IF _s !~ '^[0-9]{11}$' THEN RAISE EXCEPTION 'CPF do representante inválido' USING ERRCODE = '22023'; END IF;
      _out := _out || jsonb_build_object(_k, _s);
    ELSIF (_k = 'comprador_regime' AND _s IN ('comunhão parcial de bens', 'comunhão universal de bens',
             'separação total de bens', 'participação final nos aquestos'))
       OR (_k = 'sinal_forma' AND _s IN ('PIX', 'transferência bancária (TED)', 'cheque', 'dinheiro'))
       OR (_k = 'comissao_quem' AND _s IN ('vendedor(a)', 'comprador(a)', 'conforme a autorização de venda')) THEN
      _out := _out || jsonb_build_object(_k, _s);
    ELSE
      RAISE EXCEPTION 'Campo inválido (%)', _k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN _out;
END $$;

-- Retrato do cadastro para o texto (t_b4e7c368): imobiliária (nome, razão social, CNPJ, CRECI, endereço, cidade/UF)
-- e CRECI do corretor do negócio. Sem dado no cadastro = chave ausente (a tela avisa; nada é inventado).
CREATE OR REPLACE FUNCTION public.proposta_cadastro(_org uuid, _corretor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'nome', nullif(btrim(o.nome), ''), 'razao_social', nullif(btrim(o.razao_social), ''),
    'cnpj', CASE WHEN regexp_replace(coalesce(o.cnpj, ''), '[^0-9]', '', 'g') ~ '^[0-9]{14}$'
                 THEN regexp_replace(o.cnpj, '[^0-9]', '', 'g') END,
    'creci', public.creci_real(o.creci), 'endereco', nullif(btrim(o.endereco), ''),
    'cidade', nullif(btrim(o.cidade), ''), 'uf', nullif(btrim(o.uf), ''),
    'corretor_creci', (SELECT public.creci_real(pr.creci) FROM public.profiles pr WHERE pr.id = _corretor)))
  FROM public.organizations o WHERE o.id = _org
$$;

-- Conteúdo assinável da versão (tudo o que vai no texto/PDF, inclusive celular e e-mail, que aparecem na
-- qualificação e na tabela de signatários). O hash deste JSON é gravado em cada assinatura.
CREATE OR REPLACE FUNCTION public.proposta_conteudo(_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object(
    'documento', public.proposta_codigo_documento(p.id), 'versao', p.versao, 'imovel', p.imovel,
    'valor_oferta', p.valor_oferta, 'forma_pagamento', p.forma_pagamento, 'sinal_valor', p.sinal_valor,
    'sinal_prazo_dias', p.sinal_prazo_dias, 'sinal_tipo', p.sinal_tipo, 'financiamento_banco', p.financiamento_banco,
    'financiamento_valor', p.financiamento_valor, 'validade_dias', p.validade_dias,
    'prazo_contrato_dias', p.prazo_contrato_dias, 'certidoes', p.certidoes, 'observacoes', p.observacoes,
    'termos', p.termos, 'documento_data', p.documento_data, 'cadastro', p.cadastro,
    'partes', coalesce((SELECT jsonb_agg(jsonb_build_object('papel', x.papel, 'ordem', x.ordem, 'tipo_pessoa', x.tipo_pessoa,
                 'nome', x.nome, 'cpf_cnpj', x.cpf_cnpj, 'estado_civil', x.estado_civil, 'telefone', x.telefone,
                 'email', x.email) ORDER BY x.papel, x.ordem)
               FROM public.proposta_partes x WHERE x.proposta_id = p.id), '[]'::jsonb))
  FROM public.propostas_compra p WHERE p.id = _id
$$;

CREATE OR REPLACE FUNCTION public.proposta_conteudo_hash(_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.proposta_sha(public.proposta_conteudo(_id)::text)
$$;

CREATE OR REPLACE FUNCTION public.proposta_evento(_p public.propostas_compra, _tipo text, _detalhe text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  INSERT INTO public.proposta_eventos (organization_id, proposta_id, tipo, versao, detalhe, autor_id)
  VALUES (_p.organization_id, _p.id, _tipo, _p.versao, left(_detalhe, 1000), auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.proposta_parte_inserir(_org uuid, _prop uuid, _papel text, _ordem integer,
  _tipo text, _nome text, _doc text, _ec text, _tel text, _email text, _profile uuid, _origem text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.proposta_partes (id, organization_id, proposta_id, papel, ordem, tipo_pessoa, nome, cpf_cnpj,
    estado_civil, telefone, email, profile_id, origem, token_hash)
  VALUES (_id, _org, _prop, _papel, _ordem, coalesce(_tipo, 'fisica'), nullif(left(btrim(coalesce(_nome, '')), 160), ''),
    public.proposta_doc(_doc), CASE WHEN coalesce(_tipo, 'fisica') = 'fisica' THEN public.proposta_estado_civil(_ec) END,
    public.proposta_fone(_tel),
    CASE WHEN lower(btrim(coalesce(_email, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(btrim(_email)) <= 160
         THEN lower(btrim(_email)) END,
    _profile, _origem, public.proposta_sha(public.proposta_token(_id)));
  RETURN _id;
END $$;

-- Invalida assinaturas e códigos em aberto (nova versão, recusa, contraproposta).
CREATE OR REPLACE FUNCTION public.proposta_invalidar(_id uuid, _motivo text, _assinaturas boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  UPDATE public.proposta_codigos SET invalidado_em = now()
   WHERE proposta_id = _id AND usado_em IS NULL AND invalidado_em IS NULL;
  IF _assinaturas THEN
    UPDATE public.proposta_assinaturas SET invalidada_em = now(), invalidada_motivo = _motivo
     WHERE proposta_id = _id AND invalidada_em IS NULL;
  END IF;
END $$;

-- Contexto das RPCs internas: logado, ativo, módulo ligado. Devolve a imobiliária.
CREATE OR REPLACE FUNCTION public.proposta_ctx() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(auth.uid()), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.proposta_compra_enabled() THEN
    RAISE EXCEPTION 'Proposta de compra desligada nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;

-- Ver: corretor da proposta ou quem já vê a captação (captador, admin, gestor/líder do captador).
CREATE OR REPLACE FUNCTION public.proposta_pode_ver(_p public.propostas_compra) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_p.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL
    AND (_p.corretor_id = auth.uid() OR public.exclusive_can_view(_p.capture_id, auth.uid())), false)
$$;

-- Operar (editar, enviar, recusar, contraproposta, criar venda): corretor da proposta ou quem pode transformar a
-- captação em venda (mesma regra do "Virou venda": captador, corretores e gestor da mesma equipe).
CREATE OR REPLACE FUNCTION public.proposta_pode_operar(_p public.propostas_compra) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_p.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL
    AND public.is_active_user(auth.uid())
    AND (_p.corretor_id = auth.uid() OR public.exclusive_pode_virar_venda(_p.capture_id, auth.uid())), false)
$$;

CREATE OR REPLACE FUNCTION public.proposta_pega(_id uuid) RETURNS public.propostas_compra
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.proposta_ctx(); _p public.propostas_compra;
BEGIN
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _p.id IS NULL OR NOT public.proposta_pode_operar(_p) THEN
    RAISE EXCEPTION 'Sem acesso a esta proposta.' USING ERRCODE = '42501';
  END IF;
  RETURN _p;
END $$;

-- O que falta para enviar (vazio = pode enviar).
CREATE OR REPLACE FUNCTION public.proposta_pendencias_envio(_id uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _f text[] := ARRAY[]::text[]; _x record; _rot text;
BEGIN
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id;
  IF _p.valor_oferta IS NULL THEN _f := array_append(_f, 'valor da oferta'); END IF;
  IF _p.forma_pagamento IS NULL THEN _f := array_append(_f, 'forma de pagamento'); END IF;
  IF _p.forma_pagamento IN ('sinal_financiamento', 'sinal_parcelas')
     AND (coalesce(_p.sinal_valor, 0) <= 0 OR _p.sinal_prazo_dias IS NULL) THEN
    _f := array_append(_f, 'valor e prazo do sinal');
  END IF;
  IF _p.forma_pagamento = 'sinal_financiamento'
     AND (nullif(btrim(coalesce(_p.financiamento_banco, '')), '') IS NULL OR coalesce(_p.financiamento_valor, 0) <= 0) THEN
    _f := array_append(_f, 'banco e valor financiado');
  END IF;
  IF _p.prazo_contrato_dias IS NULL THEN _f := array_append(_f, 'prazo para o contrato'); END IF;
  IF _p.certidoes IS NULL THEN _f := array_append(_f, 'certidões'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proposta_partes WHERE proposta_id = _id AND papel = 'comprador') THEN
    _f := array_append(_f, 'comprador');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proposta_partes WHERE proposta_id = _id AND papel = 'vendedor') THEN
    _f := array_append(_f, 'vendedor');
  END IF;
  FOR _x IN SELECT * FROM public.proposta_partes WHERE proposta_id = _id ORDER BY papel, ordem LOOP
    _rot := CASE _x.papel WHEN 'comprador' THEN 'comprador' WHEN 'comprador_conjuge' THEN 'cônjuge do comprador'
              WHEN 'vendedor' THEN 'vendedor ' || _x.ordem WHEN 'vendedor_conjuge' THEN 'cônjuge do vendedor ' || _x.ordem
              ELSE 'corretor' END;
    IF _x.nome IS NULL THEN _f := array_append(_f, 'nome do ' || _rot); END IF;
    IF _x.telefone IS NULL THEN _f := array_append(_f, 'celular do ' || _rot); END IF;
    IF _x.papel <> 'corretor' AND _x.cpf_cnpj IS NULL THEN _f := array_append(_f, 'CPF/CNPJ do ' || _rot); END IF;
    IF _x.papel IN ('comprador', 'vendedor') AND _x.tipo_pessoa = 'fisica' AND _x.estado_civil IS NULL THEN
      _f := array_append(_f, ('estado civil do ' || _rot));
    END IF;
    IF _x.papel IN ('comprador', 'vendedor') AND _x.tipo_pessoa = 'fisica'
       AND public.proposta_precisa_conjuge(_x.estado_civil)
       AND NOT EXISTS (SELECT 1 FROM public.proposta_partes c WHERE c.proposta_id = _id
                        AND c.papel = _x.papel || '_conjuge' AND c.ordem = _x.ordem) THEN
      _f := array_append(_f, ('cônjuge do ' || _rot));
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.proposta_partes WHERE proposta_id = _id AND papel = 'corretor') THEN
    _f := array_append(_f, 'corretor');
  END IF;
  -- O PDF leva a data do documento e a data-limite da validade: só vale o PDF gerado hoje.
  IF _p.pdf_hash IS NULL OR _p.documento_data IS DISTINCT FROM public.proposta_hoje() THEN
    _f := array_append(_f, 'PDF da proposta (gere a prévia)');
  END IF;
  RETURN _f;
END $$;

-- Lead → etapa "Proposta" pela função do CRM (mesmo caminho do crm_mover). Não trava o envio se não der.
CREATE OR REPLACE FUNCTION public.proposta_lead_para_proposta(_p public.propostas_compra) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _etapa text; _funil text;
BEGIN
  IF _p.lead_id IS NULL THEN RETURN NULL; END IF;
  SELECT etapa, funil INTO _etapa, _funil FROM public.leads WHERE id = _p.lead_id AND organization_id = _p.organization_id;
  IF _etapa = 'proposta' THEN RETURN true; END IF;
  IF _etapa IS NULL OR _funil IS DISTINCT FROM 'venda' OR _etapa NOT IN ('novo', 'em_atendimento', 'visita_agendada') THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM set_config('app.crm_mover', 'on', true);
    PERFORM public.lead_mudar_etapa(_p.lead_id, 'proposta', NULL, 'Proposta de compra enviada (' ||
      public.proposta_codigo_documento(_p.id) || ')');
    PERFORM set_config('app.crm_mover', 'off', true);
    PERFORM public.proposta_evento(_p, 'lead_proposta', NULL);
    RETURN true;
  EXCEPTION WHEN others THEN
    PERFORM public.proposta_evento(_p, 'lead_nao_movido', left(SQLERRM, 200));
    RETURN false;
  END;
END $$;

REVOKE ALL ON FUNCTION public.proposta_hoje(), public.proposta_sha(text), public.proposta_hmac(text),
  public.proposta_token(uuid), public.proposta_codigo_texto(uuid), public.proposta_codigo_hash(uuid, text),
  public.proposta_estado_civil(text), public.proposta_fone(text), public.proposta_doc(text),
  public.proposta_precisa_conjuge(text), public.proposta_situacao(text, date), public.proposta_codigo_documento(uuid),
  public.proposta_conteudo(uuid), public.proposta_conteudo_hash(uuid),
  public.proposta_termos_limpar(jsonb), public.proposta_cadastro(uuid, uuid),
  public.proposta_evento(public.propostas_compra, text, text),
  public.proposta_parte_inserir(uuid, uuid, text, integer, text, text, text, text, text, text, uuid, text),
  public.proposta_invalidar(uuid, text, boolean), public.proposta_ctx(), public.proposta_pode_ver(public.propostas_compra),
  public.proposta_pode_operar(public.propostas_compra), public.proposta_pega(uuid), public.proposta_pendencias_envio(uuid),
  public.proposta_lead_para_proposta(public.propostas_compra)
  FROM PUBLIC, anon, authenticated, service_role;

-- 4) Leitura para as telas (authenticated) -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proposta_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.proposta_ctx(); _p public.propostas_compra;
BEGIN
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id AND organization_id = _org;
  IF _p.id IS NULL OR NOT public.proposta_pode_ver(_p) THEN
    RAISE EXCEPTION 'Sem acesso a esta proposta.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'id', _p.id, 'documento', public.proposta_codigo_documento(_p.id), 'capture_id', _p.capture_id,
    'lead_id', _p.lead_id, 'origem_id', _p.origem_id, 'versao', _p.versao,
    'situacao', public.proposta_situacao(_p.situacao, _p.validade_ate),
    'imovel', _p.imovel, 'valor_oferta', _p.valor_oferta, 'forma_pagamento', _p.forma_pagamento,
    'sinal_valor', _p.sinal_valor, 'sinal_prazo_dias', _p.sinal_prazo_dias, 'sinal_tipo', _p.sinal_tipo,
    'financiamento_banco', _p.financiamento_banco, 'financiamento_valor', _p.financiamento_valor,
    'validade_dias', _p.validade_dias, 'validade_ate', _p.validade_ate, 'prazo_contrato_dias', _p.prazo_contrato_dias,
    'certidoes', _p.certidoes, 'observacoes', _p.observacoes, 'pdf_hash', _p.pdf_hash,
    'termos', _p.termos, 'documento_data', _p.documento_data, 'cadastro', _p.cadastro,
    -- Cadastro de agora (para o aviso de dado faltando antes de gerar o PDF).
    'cadastro_atual', public.proposta_cadastro(_p.organization_id, _p.corretor_id),
    'conteudo_hash', public.proposta_conteudo_hash(_p.id),
    'enviada_em', _p.enviada_em, 'aceita_em', _p.aceita_em, 'recusada_em', _p.recusada_em,
    'recusa_motivo', _p.recusa_motivo, 'venda_id', _p.venda_id, 'criado_em', _p.criado_em,
    'corretor_id', _p.corretor_id,
    'corretor_nome', (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = _p.corretor_id),
    'pode_operar', public.proposta_pode_operar(_p),
    'pendencias_envio', to_jsonb(public.proposta_pendencias_envio(_p.id)),
    'partes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'papel', x.papel, 'ordem', x.ordem, 'tipo_pessoa', x.tipo_pessoa, 'nome', x.nome,
        'cpf_cnpj', x.cpf_cnpj, 'estado_civil', x.estado_civil, 'telefone', x.telefone, 'email', x.email,
        'origem', x.origem,
        'assinado_em', (SELECT a.assinado_em FROM public.proposta_assinaturas a
                         WHERE a.parte_id = x.id AND a.invalidada_em IS NULL),
        'codigo', (SELECT jsonb_build_object('criado_em', c.criado_em, 'enviado_em', c.enviado_em,
                     'expira_em', c.expira_em, 'tentativas', c.tentativas, 'envio_erro', c.envio_erro,
                     'ativo', c.usado_em IS NULL AND c.invalidado_em IS NULL AND c.expira_em > now() AND c.tentativas < 5)
                     FROM public.proposta_codigos c WHERE c.parte_id = x.id ORDER BY c.criado_em DESC LIMIT 1))
        ORDER BY array_position(ARRAY['comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge', 'corretor'], x.papel), x.ordem)
      FROM public.proposta_partes x WHERE x.proposta_id = _p.id), '[]'::jsonb),
    'eventos', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', e.tipo, 'versao', e.versao, 'detalhe', e.detalhe,
        'criado_em', e.criado_em, 'autor', (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = e.autor_id))
        ORDER BY e.criado_em, e.id)
      FROM public.proposta_eventos e WHERE e.proposta_id = _p.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.proposta_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_detalhe(uuid) TO authenticated;

-- Aba "Propostas" da captação: data, comprador, valor, corretor, situação, validade.
CREATE OR REPLACE FUNCTION public.proposta_lista_captacao(_capture_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.proposta_ctx();
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'documento', public.proposta_codigo_documento(p.id), 'criado_em', p.criado_em, 'versao', p.versao,
      'comprador', (SELECT x.nome FROM public.proposta_partes x WHERE x.proposta_id = p.id AND x.papel = 'comprador'
                     ORDER BY x.ordem LIMIT 1),
      'valor_oferta', p.valor_oferta,
      'corretor', (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = p.corretor_id),
      'situacao', public.proposta_situacao(p.situacao, p.validade_ate), 'validade_ate', p.validade_ate,
      'origem_id', p.origem_id, 'venda_id', p.venda_id) ORDER BY p.criado_em DESC)
    FROM public.propostas_compra p
   WHERE p.capture_id = _capture_id AND p.organization_id = _org AND public.proposta_pode_ver(p)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.proposta_lista_captacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_lista_captacao(uuid) TO authenticated;

-- "O que fazer hoje" do corretor: proposta vencendo em até 2 dias e parte que ainda não assinou.
CREATE OR REPLACE FUNCTION public.proposta_pendencias()
RETURNS TABLE(kind text, proposta_id uuid, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _hoje date := public.proposta_hoje();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.proposta_compra_enabled(), false) THEN RETURN; END IF;
  RETURN QUERY
  WITH ab AS (
    SELECT p.*, nullif(concat_ws(' — ', nullif(btrim(p.imovel->>'tipo'), ''), nullif(btrim(p.imovel->>'bairro'), '')), '') AS im
      FROM public.propostas_compra p
     WHERE p.organization_id = _org AND p.corretor_id = _me AND p.situacao = 'aguardando_assinaturas'
       AND p.validade_ate >= _hoje)
  SELECT 'proposta_vencendo'::text, ab.id, ab.capture_id, ab.im,
         CASE WHEN ab.validade_ate = _hoje THEN 'Proposta vence hoje' ELSE 'Proposta vence em ' || (ab.validade_ate - _hoje) || ' dia(s)' END,
         ab.validade_ate, (ab.validade_ate - _hoje)
    FROM ab WHERE ab.validade_ate - _hoje <= 2
  UNION ALL
  SELECT 'proposta_falta_assinar', ab.id, ab.capture_id, ab.im,
         'Falta assinar: ' || string_agg(coalesce(x.nome, x.papel), ', ' ORDER BY x.papel, x.ordem),
         ab.validade_ate, (ab.validade_ate - _hoje)
    FROM ab JOIN public.proposta_partes x ON x.proposta_id = ab.id
   WHERE NOT EXISTS (SELECT 1 FROM public.proposta_assinaturas a WHERE a.parte_id = x.id AND a.invalidada_em IS NULL)
   GROUP BY ab.id, ab.capture_id, ab.im, ab.validade_ate;
END $$;
REVOKE ALL ON FUNCTION public.proposta_pendencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_pendencias() TO authenticated;

-- Página "Comprovação das assinaturas" do PDF final (t_da0dac53): só quem vê a proposta; só as assinaturas
-- válidas da versão atual (nome, telefone, data/hora, IP, aparelho e hashes). A tela mascara telefone e IP.
CREATE OR REPLACE FUNCTION public.proposta_comprovacao(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.proposta_ctx(); _p public.propostas_compra;
BEGIN
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id AND organization_id = _org;
  IF _p.id IS NULL OR NOT public.proposta_pode_ver(_p) THEN
    RAISE EXCEPTION 'Sem acesso a esta proposta.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'documento', public.proposta_codigo_documento(_p.id), 'versao', _p.versao,
    'situacao', public.proposta_situacao(_p.situacao, _p.validade_ate), 'pdf_hash', _p.pdf_hash,
    'conteudo_hash', public.proposta_conteudo_hash(_p.id), 'aceita_em', _p.aceita_em,
    'assinaturas', coalesce((SELECT jsonb_agg(jsonb_build_object('papel', a.papel, 'ordem', a.ordem, 'nome', a.nome,
        'telefone', a.telefone, 'assinado_em', a.assinado_em, 'ip', a.ip, 'user_agent', a.user_agent,
        'conteudo_hash', a.conteudo_hash, 'pdf_hash', a.pdf_hash)
        ORDER BY array_position(ARRAY['comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge', 'corretor'], a.papel), a.ordem)
      FROM public.proposta_assinaturas a
     WHERE a.proposta_id = _p.id AND a.invalidada_em IS NULL AND a.versao = _p.versao), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.proposta_comprovacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_comprovacao(uuid) TO authenticated;

-- 5) Rascunho ----------------------------------------------------------------------------------------------------
-- Cria o rascunho a partir da captação (imóvel + vendedores) e, se houver, do lead (comprador).
CREATE OR REPLACE FUNCTION public.proposta_criar(_capture_id uuid, _lead_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.proposta_ctx(); _me uuid := auth.uid(); _c public.exclusive_captures;
        _l public.leads; _cli public.clientes; _id uuid := gen_random_uuid(); _im jsonb; _o record; _ec text;
        _uf text; _p public.propostas_compra;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture_id AND organization_id = _org;
  IF _c.id IS NULL OR NOT public.exclusive_pode_virar_venda(_capture_id, _me) THEN
    RAISE EXCEPTION 'Só o captador, corretores e o gestor da mesma equipe fazem proposta nesta captação (aprovada).'
      USING ERRCODE = '42501';
  END IF;
  IF _lead_id IS NOT NULL THEN
    SELECT * INTO _l FROM public.leads WHERE id = _lead_id AND organization_id = _org;
    IF _l.id IS NULL OR NOT coalesce(public.leads_enabled(), false)
       OR NOT coalesce(public.leads_gestor() OR _l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis()), false) THEN
      RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF _l.cliente_id IS NOT NULL THEN
      SELECT * INTO _cli FROM public.clientes WHERE id = _l.cliente_id AND organization_id = _org;
    END IF;
  END IF;

  _im := CASE WHEN jsonb_typeof(_c.form_data->'imovel') = 'object' THEN _c.form_data->'imovel' ELSE '{}'::jsonb END;
  _uf := upper(btrim(coalesce(_im->>'estado', '')));
  -- Padrões do texto oficial (t_b4e7c368): contrato em 15 dias, proteção das certidões marcada, sinal em 2 dias úteis.
  INSERT INTO public.propostas_compra (id, organization_id, capture_id, lead_id, corretor_id, prazo_contrato_dias,
    certidoes, sinal_prazo_dias, imovel, criado_por)
  VALUES (_id, _org, _c.id, _l.id, _me, 15, 'vendedor_apresenta', 2, jsonb_strip_nulls(jsonb_build_object(
      'codigo', upper(left(replace(_c.id::text, '-', ''), 8)),
      'tipo', nullif(btrim(_im->>'tipo_imovel'), ''), 'endereco', nullif(btrim(_im->>'endereco'), ''),
      'complemento', nullif(btrim(_im->>'complemento'), ''), 'bairro', nullif(btrim(_im->>'bairro'), ''),
      'cidade', nullif(btrim(_im->>'municipio'), ''), 'uf', CASE WHEN _uf ~ '^[A-Z]{2}$' THEN _uf ELSE nullif(btrim(_im->>'estado'), '') END,
      'matricula', nullif(btrim(_im->>'numero_matricula'), ''), 'cartorio', nullif(btrim(_im->>'cartorio_registro'), ''),
      'iptu', nullif(btrim(_im->>'classificacao_fiscal_iptu'), ''), 'valor_anunciado', nullif(btrim(_im->>'valor_imovel'), ''))),
    _me);

  -- Comprador: do lead (nome, celular, e-mail) + cadastro do cliente (CPF/CNPJ, tipo) quando houver.
  PERFORM public.proposta_parte_inserir(_org, _id, 'comprador', 1,
    CASE WHEN _cli.tipo_pessoa IN ('fisica', 'juridica') THEN _cli.tipo_pessoa ELSE 'fisica' END,
    coalesce(nullif(btrim(_cli.razao_social), ''), nullif(btrim(_cli.nome), ''), _l.nome),
    coalesce(_cli.cpf_cnpj, _cli.cnpj), NULL, coalesce(_l.telefone, _cli.telefone), coalesce(_l.email, _cli.email),
    NULL, CASE WHEN _l.id IS NOT NULL THEN 'lead' ELSE 'manual' END);

  -- Vendedores: todos os proprietários da captação (1º sempre; demais com nome), como no "Virou venda".
  FOR _o IN SELECT l.o, l.n FROM jsonb_array_elements(public.exclusive_owner_list(_c.form_data)) WITH ORDINALITY l(o, n)
             WHERE l.n = 1 OR nullif(btrim(coalesce(l.o->>'nome_completo', '')), '') IS NOT NULL LOOP
    _ec := public.proposta_estado_civil(_o.o->>'estado_civil');
    PERFORM public.proposta_parte_inserir(_org, _id, 'vendedor', _o.n::int, 'fisica', _o.o->>'nome_completo',
      _o.o->>'cpf', _ec, _o.o->>'telefone_1', _o.o->>'email', NULL, 'captacao');
    IF public.proposta_precisa_conjuge(_ec) THEN
      PERFORM public.proposta_parte_inserir(_org, _id, 'vendedor_conjuge', _o.n::int, 'fisica', NULL, NULL, NULL,
        NULL, NULL, NULL, 'manual');
    END IF;
  END LOOP;

  -- Corretor do negócio (quem cria): nome e celular do perfil.
  PERFORM public.proposta_parte_inserir(_org, _id, 'corretor', 1, 'fisica', pr.nome, NULL, NULL, pr.telefone, NULL,
    _me, 'perfil') FROM public.profiles pr WHERE pr.id = _me;

  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id;
  PERFORM public.proposta_evento(_p, 'criada', CASE WHEN _l.id IS NOT NULL THEN 'com lead do CRM' END);
  RETURN public.proposta_detalhe(_id);
END $$;
REVOKE ALL ON FUNCTION public.proposta_criar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_criar(uuid, uuid) TO authenticated;

-- Salvar o rascunho. Chaves ausentes em _dados não mudam. 'partes' (se vier) substitui comprador/cônjuges/vendedores
-- (o corretor vem do perfil e não é editável aqui). Conteúdo mudou depois do envio → nova versão.
CREATE OR REPLACE FUNCTION public.proposta_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _antes text; _depois text; _x jsonb; _papel text; _ordem int; _tipo text;
        _keys text[] := ARRAY[]::text[]; _pid uuid; _d jsonb := coalesce(_dados, '{}'::jsonb);
BEGIN
  _p := public.proposta_pega(_id);
  IF jsonb_typeof(_d) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  IF _p.situacao NOT IN ('rascunho', 'aguardando_assinaturas') THEN
    RAISE EXCEPTION 'Esta proposta não pode mais ser alterada.' USING ERRCODE = '22023';
  END IF;
  IF public.proposta_situacao(_p.situacao, _p.validade_ate) = 'vencida' THEN
    RAISE EXCEPTION 'Proposta vencida: faça uma contraproposta.' USING ERRCODE = '22023';
  END IF;
  _antes := public.proposta_conteudo_hash(_id);

  UPDATE public.propostas_compra SET
    valor_oferta = CASE WHEN _d ? 'valor_oferta' THEN (_d->>'valor_oferta')::numeric ELSE valor_oferta END,
    forma_pagamento = CASE WHEN _d ? 'forma_pagamento' THEN _d->>'forma_pagamento' ELSE forma_pagamento END,
    sinal_valor = CASE WHEN _d ? 'sinal_valor' THEN (_d->>'sinal_valor')::numeric ELSE sinal_valor END,
    sinal_prazo_dias = CASE WHEN _d ? 'sinal_prazo_dias' THEN (_d->>'sinal_prazo_dias')::int ELSE sinal_prazo_dias END,
    -- Tipo de sinal (D7 revista): vazio = padrão confirmatórias; outro valor cai no CHECK.
    sinal_tipo = CASE WHEN _d ? 'sinal_tipo' THEN coalesce(nullif(btrim(_d->>'sinal_tipo'), ''), 'confirmatorias') ELSE sinal_tipo END,
    termos = CASE WHEN _d ? 'termos' THEN public.proposta_termos_limpar(_d->'termos') ELSE termos END,
    financiamento_banco = CASE WHEN _d ? 'financiamento_banco' THEN nullif(btrim(_d->>'financiamento_banco'), '') ELSE financiamento_banco END,
    financiamento_valor = CASE WHEN _d ? 'financiamento_valor' THEN (_d->>'financiamento_valor')::numeric ELSE financiamento_valor END,
    validade_dias = CASE WHEN _d ? 'validade_dias' THEN coalesce((_d->>'validade_dias')::int, 5) ELSE validade_dias END,
    prazo_contrato_dias = CASE WHEN _d ? 'prazo_contrato_dias' THEN (_d->>'prazo_contrato_dias')::int ELSE prazo_contrato_dias END,
    certidoes = CASE WHEN _d ? 'certidoes' THEN _d->>'certidoes' ELSE certidoes END,
    observacoes = CASE WHEN _d ? 'observacoes' THEN nullif(btrim(_d->>'observacoes'), '') ELSE observacoes END,
    atualizado_em = now()
  WHERE id = _id;

  IF _d ? 'partes' THEN
    IF jsonb_typeof(_d->'partes') <> 'array' OR jsonb_array_length(_d->'partes') > 60 THEN
      RAISE EXCEPTION 'Partes inválidas' USING ERRCODE = '22023';
    END IF;
    FOR _x IN SELECT e FROM jsonb_array_elements(_d->'partes') e LOOP
      _papel := _x->>'papel'; _ordem := coalesce((_x->>'ordem')::int, 1);
      _tipo := coalesce(_x->>'tipo_pessoa', 'fisica');
      IF _papel IS NULL OR _papel NOT IN ('comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge')
         OR _tipo NOT IN ('fisica', 'juridica') OR (_papel LIKE 'comprador%' AND _ordem <> 1)
         OR (_papel LIKE '%_conjuge' AND _tipo <> 'fisica') THEN
        RAISE EXCEPTION 'Parte inválida' USING ERRCODE = '22023';
      END IF;
      IF (_papel || ':' || _ordem) = ANY (_keys) THEN RAISE EXCEPTION 'Parte repetida' USING ERRCODE = '22023'; END IF;
      _keys := _keys || (_papel || ':' || _ordem);
      SELECT id INTO _pid FROM public.proposta_partes WHERE proposta_id = _id AND papel = _papel AND ordem = _ordem;
      IF _pid IS NULL THEN
        PERFORM public.proposta_parte_inserir(_p.organization_id, _id, _papel, _ordem, _tipo, _x->>'nome',
          _x->>'cpf_cnpj', _x->>'estado_civil', _x->>'telefone', _x->>'email', NULL, 'manual');
      ELSE
        UPDATE public.proposta_partes SET tipo_pessoa = _tipo,
          nome = nullif(left(btrim(coalesce(_x->>'nome', '')), 160), ''),
          cpf_cnpj = public.proposta_doc(_x->>'cpf_cnpj'),
          estado_civil = CASE WHEN _tipo = 'fisica' THEN public.proposta_estado_civil(_x->>'estado_civil') END,
          telefone = public.proposta_fone(_x->>'telefone'),
          email = CASE WHEN lower(btrim(coalesce(_x->>'email', ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                        AND char_length(btrim(_x->>'email')) <= 160 THEN lower(btrim(_x->>'email')) END,
          atualizado_em = now()
         WHERE id = _pid;
      END IF;
    END LOOP;
    DELETE FROM public.proposta_partes WHERE proposta_id = _id AND papel <> 'corretor'
       AND NOT ((papel || ':' || ordem) = ANY (_keys));
  END IF;

  _depois := public.proposta_conteudo_hash(_id);
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id;
  IF _depois IS DISTINCT FROM _antes THEN
    IF _p.situacao = 'aguardando_assinaturas' THEN
      -- Mudou o texto depois do envio: nova versão, assinaturas e códigos anteriores deixam de valer.
      PERFORM public.proposta_invalidar(_id, 'nova_versao', true);
      UPDATE public.propostas_compra SET versao = versao + 1, situacao = 'rascunho', pdf_hash = NULL,
             documento_data = NULL, cadastro = NULL, validade_ate = NULL, atualizado_em = now()
       WHERE id = _id RETURNING * INTO _p;
      PERFORM public.proposta_evento(_p, 'nova_versao', 'Texto ou valores alterados: assinaturas anteriores invalidadas');
    ELSE
      UPDATE public.propostas_compra SET pdf_hash = NULL, documento_data = NULL, cadastro = NULL
       WHERE id = _id RETURNING * INTO _p;
      PERFORM public.proposta_evento(_p, 'editada', NULL);
    END IF;
  END IF;
  RETURN public.proposta_detalhe(_id);
END $$;
REVOKE ALL ON FUNCTION public.proposta_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_salvar(uuid, jsonb) TO authenticated;

-- Antes de gerar o PDF (t_b4e7c368): no rascunho, fixa a data do documento (hoje, São Paulo) e o retrato do cadastro
-- da imobiliária/corretor que vão no texto. Se algo mudou, o PDF anterior deixa de valer. Fora do rascunho não muda nada.
CREATE OR REPLACE FUNCTION public.proposta_preparar_pdf(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _cad jsonb;
BEGIN
  _p := public.proposta_pega(_id);
  IF _p.situacao = 'rascunho' THEN
    _cad := public.proposta_cadastro(_p.organization_id, _p.corretor_id);
    IF _p.documento_data IS DISTINCT FROM public.proposta_hoje() OR _p.cadastro IS DISTINCT FROM _cad THEN
      UPDATE public.propostas_compra SET documento_data = public.proposta_hoje(), cadastro = _cad, pdf_hash = NULL,
             atualizado_em = now() WHERE id = _id;
    END IF;
  END IF;
  RETURN public.proposta_detalhe(_id);
END $$;
REVOKE ALL ON FUNCTION public.proposta_preparar_pdf(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_preparar_pdf(uuid) TO authenticated;

-- PDF da versão (gerado pela tela com o PDF que já existe). Só antes do envio; depois, alterar os dados gera versão nova.
CREATE OR REPLACE FUNCTION public.proposta_registrar_pdf(_id uuid, _versao integer, _pdf_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra;
BEGIN
  _p := public.proposta_pega(_id);
  IF _pdf_hash IS NULL OR _pdf_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Hash do PDF inválido' USING ERRCODE = '22023'; END IF;
  IF _versao IS DISTINCT FROM _p.versao THEN
    RAISE EXCEPTION 'A proposta mudou: gere o PDF de novo.' USING ERRCODE = '40001';
  END IF;
  IF _p.situacao <> 'rascunho' THEN
    IF _p.pdf_hash = _pdf_hash THEN RETURN public.proposta_detalhe(_id); END IF;
    RAISE EXCEPTION 'Proposta já enviada: para trocar o PDF, altere os dados (nova versão).' USING ERRCODE = '22023';
  END IF;
  -- Data e cadastro do texto fixados hoje por proposta_preparar_pdf (e não alterados desde então).
  IF _p.documento_data IS DISTINCT FROM public.proposta_hoje() OR _p.cadastro IS NULL THEN
    RAISE EXCEPTION 'A proposta mudou: gere o PDF de novo.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.propostas_compra SET pdf_hash = _pdf_hash, atualizado_em = now() WHERE id = _id RETURNING * INTO _p;
  PERFORM public.proposta_evento(_p, 'pdf', NULL);
  RETURN public.proposta_detalhe(_id);
END $$;
REVOKE ALL ON FUNCTION public.proposta_registrar_pdf(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_registrar_pdf(uuid, integer, text) TO authenticated;

-- 6) Envio (clique do corretor em "Enviar" / "Reenviar para quem falta") -------------------------------------------
-- Gera um código NOVO por parte (o anterior morre). Devolve só ids: o código nunca vai ao navegador; o servidor do
-- ADM lê o código com proposta_envio_dados (service_role) e manda o WhatsApp. _partes NULL = todas que faltam.
CREATE OR REPLACE FUNCTION public.proposta_envio_preparar(_id uuid, _partes uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _f text[]; _x public.proposta_partes; _cid uuid;
        _cod jsonb := '[]'::jsonb; _sem jsonb := '[]'::jsonb; _esp jsonb := '[]'::jsonb; _lead boolean;
BEGIN
  _p := public.proposta_pega(_id);
  IF public.proposta_situacao(_p.situacao, _p.validade_ate) = 'vencida' THEN
    RAISE EXCEPTION 'Proposta vencida: faça uma contraproposta.' USING ERRCODE = '22023';
  END IF;
  IF _p.situacao = 'rascunho' THEN
    _f := public.proposta_pendencias_envio(_id);
    IF cardinality(_f) > 0 THEN
      RAISE EXCEPTION 'Falta preencher: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
    END IF;
    UPDATE public.propostas_compra SET situacao = 'aguardando_assinaturas', enviada_em = now(),
           validade_ate = documento_data + validade_dias, atualizado_em = now()
     WHERE id = _id RETURNING * INTO _p;
    PERFORM public.proposta_evento(_p, 'enviada', 'Válida até ' || to_char(_p.validade_ate, 'DD/MM/YYYY'));
    _lead := public.proposta_lead_para_proposta(_p);
  ELSIF _p.situacao <> 'aguardando_assinaturas' THEN
    RAISE EXCEPTION 'Esta proposta não está aguardando assinaturas.' USING ERRCODE = '22023';
  END IF;

  FOR _x IN SELECT * FROM public.proposta_partes x WHERE x.proposta_id = _id
              AND (_partes IS NULL OR x.id = ANY (_partes))
              AND NOT EXISTS (SELECT 1 FROM public.proposta_assinaturas a WHERE a.parte_id = x.id AND a.invalidada_em IS NULL)
            ORDER BY array_position(ARRAY['comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge', 'corretor'], x.papel), x.ordem LOOP
    IF _x.telefone IS NULL THEN _sem := _sem || to_jsonb(_x.id); CONTINUE; END IF;
    -- Sem disparo repetido: 1 código por parte a cada 60 s e no máximo 10 por dia.
    IF EXISTS (SELECT 1 FROM public.proposta_codigos c WHERE c.parte_id = _x.id AND c.criado_em > now() - interval '60 seconds')
       OR (SELECT count(*) FROM public.proposta_codigos c WHERE c.parte_id = _x.id AND c.criado_em > now() - interval '1 day') >= 10 THEN
      _esp := _esp || to_jsonb(_x.id); CONTINUE;
    END IF;
    UPDATE public.proposta_codigos SET invalidado_em = now()
     WHERE parte_id = _x.id AND usado_em IS NULL AND invalidado_em IS NULL;
    _cid := gen_random_uuid();
    INSERT INTO public.proposta_codigos (id, organization_id, proposta_id, parte_id, versao, codigo_hash, expira_em, criado_por)
    VALUES (_cid, _p.organization_id, _id, _x.id, _p.versao,
            public.proposta_codigo_hash(_cid, public.proposta_codigo_texto(_cid)), now() + interval '24 hours', auth.uid());
    _cod := _cod || jsonb_build_object('codigo_id', _cid, 'parte_id', _x.id);
  END LOOP;
  IF jsonb_array_length(_cod) > 0 THEN
    PERFORM public.proposta_evento(_p, 'codigo_gerado', jsonb_array_length(_cod) || ' parte(s)');
  END IF;
  RETURN jsonb_build_object('codigos', _cod, 'sem_telefone', _sem, 'aguarde', _esp, 'lead_movido', _lead,
    'situacao', public.proposta_situacao(_p.situacao, _p.validade_ate), 'validade_ate', _p.validade_ate);
END $$;
REVOKE ALL ON FUNCTION public.proposta_envio_preparar(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_envio_preparar(uuid, uuid[]) TO authenticated;

-- Só o servidor do ADM: dados de cada mensagem individual (código em texto só aqui, por 10 minutos e uma vez).
CREATE OR REPLACE FUNCTION public.proposta_envio_dados(_codigo_ids uuid[]) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'codigo_id', c.id, 'codigo', public.proposta_codigo_texto(c.id), 'telefone', x.telefone,
      'token', public.proposta_token(x.id), 'parte_nome', x.nome, 'papel', x.papel, 'ordem', x.ordem,
      'imobiliaria', o.nome,
      'endereco', nullif(concat_ws(', ', nullif(p.imovel->>'endereco', ''), nullif(p.imovel->>'complemento', ''),
                                   nullif(p.imovel->>'bairro', ''),
                                   nullif(concat_ws('/', nullif(p.imovel->>'cidade', ''), nullif(p.imovel->>'uf', '')), '')), ''),
      'corretor_nome', nullif(btrim(pr.nome), ''), 'corretor_telefone', public.proposta_fone(pr.telefone),
      'documento', public.proposta_codigo_documento(p.id)) ORDER BY c.criado_em), '[]'::jsonb)
    FROM public.proposta_codigos c
    JOIN public.proposta_partes x ON x.id = c.parte_id
    JOIN public.propostas_compra p ON p.id = c.proposta_id AND p.organization_id = c.organization_id
    JOIN public.organizations o ON o.id = p.organization_id AND o.status = 'ativa'
    LEFT JOIN public.profiles pr ON pr.id = p.corretor_id
   WHERE c.id = ANY (_codigo_ids) AND c.enviado_em IS NULL AND c.envio_erro IS NULL AND c.usado_em IS NULL
     AND c.invalidado_em IS NULL AND c.criado_em > now() - interval '10 minutes' AND c.versao = p.versao
     AND p.situacao = 'aguardando_assinaturas' AND public.proposta_compra_modulo_ligado(p.organization_id)
$$;
REVOKE ALL ON FUNCTION public.proposta_envio_dados(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_envio_dados(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.proposta_envio_resultado(_codigo_id uuid, _ok boolean, _erro text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.proposta_codigos; _p public.propostas_compra;
BEGIN
  UPDATE public.proposta_codigos SET enviado_em = CASE WHEN _ok THEN now() END,
         envio_erro = CASE WHEN _ok THEN NULL ELSE left(coalesce(nullif(btrim(_erro), ''), 'falha no envio'), 200) END
   WHERE id = _codigo_id AND enviado_em IS NULL AND envio_erro IS NULL RETURNING * INTO _c;
  IF _c.id IS NULL THEN RETURN; END IF;
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _c.proposta_id;
  INSERT INTO public.proposta_eventos (organization_id, proposta_id, tipo, versao, detalhe)
  VALUES (_p.organization_id, _p.id, CASE WHEN _ok THEN 'codigo_enviado' ELSE 'codigo_falhou' END, _c.versao,
          (SELECT x.papel || ' ' || x.ordem FROM public.proposta_partes x WHERE x.id = _c.parte_id));
END $$;
REVOKE ALL ON FUNCTION public.proposta_envio_resultado(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_envio_resultado(uuid, boolean, text) TO service_role;

-- 7) Recusa, contraproposta e venda ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proposta_recusar(_id uuid, _motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _m text := btrim(coalesce(_motivo, ''));
BEGIN
  _p := public.proposta_pega(_id);
  IF char_length(_m) < 3 OR char_length(_m) > 1000 THEN
    RAISE EXCEPTION 'Informe o motivo da recusa.' USING ERRCODE = '22023';
  END IF;
  IF _p.situacao <> 'aguardando_assinaturas' THEN
    RAISE EXCEPTION 'Só proposta aguardando assinaturas pode ser recusada.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.proposta_invalidar(_id, 'recusada', false);
  UPDATE public.propostas_compra SET situacao = 'recusada', recusada_em = now(), recusa_motivo = _m, atualizado_em = now()
   WHERE id = _id RETURNING * INTO _p;
  PERFORM public.proposta_evento(_p, 'recusada', _m);
  RETURN public.proposta_detalhe(_id);
END $$;
REVOKE ALL ON FUNCTION public.proposta_recusar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_recusar(uuid, text) TO authenticated;

-- Contraproposta: a atual fica no histórico ('contraproposta') e nasce outra já preenchida, em rascunho.
CREATE OR REPLACE FUNCTION public.proposta_contraproposta(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _n uuid := gen_random_uuid(); _x public.proposta_partes; _np public.propostas_compra;
BEGIN
  _p := public.proposta_pega(_id);
  IF public.proposta_situacao(_p.situacao, _p.validade_ate) NOT IN ('aguardando_assinaturas', 'recusada', 'vencida') THEN
    RAISE EXCEPTION 'Contraproposta só de proposta enviada, recusada ou vencida.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.proposta_invalidar(_id, 'contraproposta', false);
  UPDATE public.propostas_compra SET situacao = 'contraproposta', atualizado_em = now() WHERE id = _id RETURNING * INTO _p;
  INSERT INTO public.propostas_compra (id, organization_id, capture_id, lead_id, corretor_id, origem_id, imovel,
    valor_oferta, forma_pagamento, sinal_valor, sinal_prazo_dias, sinal_tipo, termos, financiamento_banco,
    financiamento_valor, validade_dias, prazo_contrato_dias, certidoes, observacoes, criado_por)
  SELECT _n, organization_id, capture_id, lead_id, corretor_id, id, imovel, valor_oferta, forma_pagamento, sinal_valor,
    sinal_prazo_dias, sinal_tipo, termos, financiamento_banco, financiamento_valor, validade_dias, prazo_contrato_dias,
    certidoes, observacoes, auth.uid()
    FROM public.propostas_compra WHERE id = _id;
  FOR _x IN SELECT * FROM public.proposta_partes WHERE proposta_id = _id LOOP
    PERFORM public.proposta_parte_inserir(_x.organization_id, _n, _x.papel, _x.ordem, _x.tipo_pessoa, _x.nome,
      _x.cpf_cnpj, _x.estado_civil, _x.telefone, _x.email, _x.profile_id, _x.origem);
  END LOOP;
  PERFORM public.proposta_evento(_p, 'contraproposta', public.proposta_codigo_documento(_n));
  SELECT * INTO _np FROM public.propostas_compra WHERE id = _n;
  PERFORM public.proposta_evento(_np, 'criada', 'Contraproposta de ' || public.proposta_codigo_documento(_id));
  RETURN public.proposta_detalhe(_n);
END $$;
REVOKE ALL ON FUNCTION public.proposta_contraproposta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_contraproposta(uuid) TO authenticated;

-- "Criar venda em rascunho": SÓ por clique. Usa exclusive_virar_venda (venda em 'rascunho' + vendedores da
-- captação) e completa comprador, cônjuges, valor negociado e pagamento. Nunca liga a uma venda já existente.
CREATE OR REPLACE FUNCTION public.proposta_criar_venda(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.propostas_compra; _r jsonb; _sale uuid; _c public.proposta_partes; _cc public.proposta_partes;
        _v record;
BEGIN
  _p := public.proposta_pega(_id);
  IF _p.venda_id IS NOT NULL THEN
    RETURN jsonb_build_object('criada', false, 'venda_id', _p.venda_id);
  END IF;
  IF _p.situacao <> 'aceita' THEN
    RAISE EXCEPTION 'Só proposta aceita (todas as partes assinaram) vira venda.' USING ERRCODE = '22023';
  END IF;
  _r := public.exclusive_virar_venda(_p.capture_id);
  IF NOT coalesce((_r->>'criada')::boolean, false) THEN
    RAISE EXCEPTION 'Já existe uma venda aberta para este imóvel (código %). Abra a venda existente.',
      _r->'venda'->>'codigo' USING ERRCODE = '22023';
  END IF;
  _sale := (_r->'venda'->>'id')::uuid;

  UPDATE public.sales SET valor_negociado = _p.valor_oferta,
         forma_pagamento = CASE _p.forma_pagamento WHEN 'a_vista' THEN 'À vista'
           WHEN 'sinal_financiamento' THEN 'Sinal + financiamento' WHEN 'sinal_parcelas' THEN 'Sinal + parcelas' END
   WHERE id = _sale;

  SELECT * INTO _c FROM public.proposta_partes WHERE proposta_id = _id AND papel = 'comprador' AND ordem = 1;
  SELECT * INTO _cc FROM public.proposta_partes WHERE proposta_id = _id AND papel = 'comprador_conjuge' AND ordem = 1;
  UPDATE public.sale_parties SET tipo_pessoa = _c.tipo_pessoa, nome = _c.nome,
         razao_social = CASE WHEN _c.tipo_pessoa = 'juridica' THEN _c.nome END,
         cpf_cnpj = _c.cpf_cnpj, cnpj = CASE WHEN _c.tipo_pessoa = 'juridica' THEN _c.cpf_cnpj END,
         email = _c.email, telefone = _c.telefone,
         estado_civil = CASE _c.estado_civil WHEN 'casado' THEN 'Casado(a)' WHEN 'uniao_estavel' THEN 'União estável'
           WHEN 'solteiro' THEN 'Solteiro(a)' WHEN 'divorciado' THEN 'Divorciado(a)' WHEN 'viuvo' THEN 'Viúvo(a)'
           WHEN 'separado' THEN 'Separado(a)' END,
         conjuge_nome = _cc.nome, conjuge_cpf = _cc.cpf_cnpj
   WHERE sale_id = _sale AND papel = 'comprador_1';

  -- Vendedores: completa o que veio da captação com o que foi conferido na proposta (cônjuge, contato).
  FOR _v IN SELECT x.*, cj.nome AS cj_nome, cj.cpf_cnpj AS cj_doc FROM public.proposta_partes x
              LEFT JOIN public.proposta_partes cj ON cj.proposta_id = x.proposta_id AND cj.papel = 'vendedor_conjuge' AND cj.ordem = x.ordem
             WHERE x.proposta_id = _id AND x.papel = 'vendedor' LOOP
    UPDATE public.sale_parties SET nome = coalesce(_v.nome, nome), cpf_cnpj = coalesce(_v.cpf_cnpj, cpf_cnpj),
           telefone = coalesce(_v.telefone, telefone), email = coalesce(_v.email, email),
           conjuge_nome = coalesce(_v.cj_nome, conjuge_nome), conjuge_cpf = coalesce(_v.cj_doc, conjuge_cpf)
     WHERE sale_id = _sale AND papel = 'vendedor_' || _v.ordem;
  END LOOP;

  INSERT INTO public.sale_payment (sale_id, organization_id, tipo_pagamento, entrada_valor, financiamento,
    financiamento_banco, financiamento_valor, observacoes)
  VALUES (_sale, _p.organization_id, CASE WHEN _p.forma_pagamento = 'sinal_financiamento' THEN 'financiamento' ELSE 'vista' END,
    CASE WHEN _p.forma_pagamento <> 'a_vista' THEN _p.sinal_valor END, _p.forma_pagamento = 'sinal_financiamento',
    CASE WHEN _p.forma_pagamento = 'sinal_financiamento' THEN _p.financiamento_banco END,
    CASE WHEN _p.forma_pagamento = 'sinal_financiamento' THEN _p.financiamento_valor END,
    left('Da proposta ' || public.proposta_codigo_documento(_p.id) || ' v' || _p.versao ||
         coalesce(' (sinal em até ' || _p.sinal_prazo_dias || ' dias úteis, arras ' ||
           CASE _p.sinal_tipo WHEN 'penitenciais' THEN 'penitenciais' ELSE 'confirmatórias' END || ')', '') ||
         coalesce('. ' || _p.observacoes, ''), 2000))
  ON CONFLICT (sale_id) DO NOTHING;

  UPDATE public.propostas_compra SET venda_id = _sale, venda_criada_em = now(), venda_criada_por = auth.uid(),
         atualizado_em = now() WHERE id = _id RETURNING * INTO _p;
  PERFORM public.proposta_evento(_p, 'venda_criada', _r->'venda'->>'codigo');
  RETURN jsonb_build_object('criada', true, 'venda_id', _sale, 'venda', _r->'venda');
END $$;
REVOKE ALL ON FUNCTION public.proposta_criar_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposta_criar_venda(uuid) TO authenticated;

-- 8) Página pública do link (só o servidor do ADM, service_role) ----------------------------------------------------
-- Conta token errado por IP (hash). Devolve a parte do link ou NULL.
CREATE OR REPLACE FUNCTION public.proposta_publica_parte(_token text, _ip_hash text) RETURNS public.proposta_partes
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _x public.proposta_partes;
BEGIN
  IF _token IS NOT NULL AND _token ~ '^[A-Za-z0-9_-]{43}$' THEN
    SELECT * INTO _x FROM public.proposta_partes WHERE token_hash = public.proposta_sha(_token);
  END IF;
  IF _x.id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('proposta_ip:' || _ip_hash, 0));
    INSERT INTO public.proposta_tentativas (ip_hash) VALUES (_ip_hash);
    DELETE FROM public.proposta_tentativas WHERE created_at < now() - interval '1 day';
  END IF;
  RETURN _x;
END $$;
REVOKE ALL ON FUNCTION public.proposta_publica_parte(text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.proposta_ip_bloqueado(_ip_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT (SELECT count(*) FROM public.proposta_tentativas
           WHERE ip_hash = _ip_hash AND created_at > now() - interval '15 minutes') >= 10
$$;
REVOKE ALL ON FUNCTION public.proposta_ip_bloqueado(text) FROM PUBLIC, anon, authenticated, service_role;

-- Leitura: SÓ a proposta (imóvel, valores, condições, nomes e papéis das partes, situação) + a própria parte.
-- Nada de CPF/telefone/e-mail de outras partes, dados internos da captação, comissão ou observação interna.
CREATE OR REPLACE FUNCTION public.proposta_publica_ler(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _x public.proposta_partes; _p public.propostas_compra; _org text; _cor public.profiles;
BEGIN
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'erro', 'invalido'); END IF;
  IF public.proposta_ip_bloqueado(_ip_hash)
     AND NOT EXISTS (SELECT 1 FROM public.proposta_partes WHERE _token ~ '^[A-Za-z0-9_-]{43}$'
                      AND token_hash = public.proposta_sha(_token)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite');
  END IF;
  _x := public.proposta_publica_parte(_token, _ip_hash);
  IF _x.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel'); END IF;
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _x.proposta_id AND organization_id = _x.organization_id;
  SELECT o.nome INTO _org FROM public.organizations o WHERE o.id = _p.organization_id AND o.status = 'ativa';
  IF _p.id IS NULL OR _org IS NULL OR NOT public.proposta_compra_modulo_ligado(_p.organization_id)
     OR _p.situacao = 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel');
  END IF;
  SELECT * INTO _cor FROM public.profiles WHERE id = _p.corretor_id;
  RETURN jsonb_build_object(
    'ok', true, 'imobiliaria', _org, 'documento', public.proposta_codigo_documento(_p.id), 'versao', _p.versao,
    'situacao', public.proposta_situacao(_p.situacao, _p.validade_ate), 'validade_ate', _p.validade_ate,
    'conteudo_hash', public.proposta_conteudo_hash(_p.id),
    'voce', jsonb_build_object('papel', _x.papel, 'ordem', _x.ordem, 'nome', _x.nome,
      'documento_final', right(_x.cpf_cnpj, 2),
      'assinado_em', (SELECT a.assinado_em FROM public.proposta_assinaturas a WHERE a.parte_id = _x.id AND a.invalidada_em IS NULL)),
    'imovel', jsonb_build_object('tipo', _p.imovel->>'tipo', 'endereco', _p.imovel->>'endereco',
      'complemento', _p.imovel->>'complemento', 'bairro', _p.imovel->>'bairro', 'cidade', _p.imovel->>'cidade',
      'uf', _p.imovel->>'uf', 'matricula', _p.imovel->>'matricula', 'cartorio', _p.imovel->>'cartorio',
      'iptu', _p.imovel->>'iptu', 'codigo', _p.imovel->>'codigo'),
    'valores', jsonb_build_object('oferta', _p.valor_oferta, 'forma_pagamento', _p.forma_pagamento,
      'sinal', _p.sinal_valor, 'sinal_prazo_dias', _p.sinal_prazo_dias, 'sinal_tipo', _p.sinal_tipo,
      'financiamento_banco', _p.financiamento_banco, 'financiamento_valor', _p.financiamento_valor),
    'condicoes', jsonb_build_object('validade_dias', _p.validade_dias, 'prazo_contrato_dias', _p.prazo_contrato_dias,
      'certidoes', _p.certidoes, 'observacoes', _p.observacoes),
    -- Texto oficial (t_b4e7c368): termos SEM dado pessoal/bancário (RG, endereço, CPF do representante e conta do
    -- vendedor ficam só no PDF), data do documento e o cadastro público da imobiliária.
    'termos', _p.termos - ARRAY['comprador_rg', 'comprador_endereco', 'comprador_representante_cpf', 'vendedor_conta'],
    'documento_data', _p.documento_data, 'cadastro', _p.cadastro,
    'partes', coalesce((SELECT jsonb_agg(jsonb_build_object('papel', y.papel, 'ordem', y.ordem, 'nome', y.nome,
        'tipo_pessoa', y.tipo_pessoa, 'estado_civil', y.estado_civil,
        'assinou', EXISTS (SELECT 1 FROM public.proposta_assinaturas a WHERE a.parte_id = y.id AND a.invalidada_em IS NULL))
        ORDER BY array_position(ARRAY['comprador', 'comprador_conjuge', 'vendedor', 'vendedor_conjuge', 'corretor'], y.papel), y.ordem)
      FROM public.proposta_partes y WHERE y.proposta_id = _p.id), '[]'::jsonb),
    'corretor', jsonb_build_object('nome', nullif(btrim(_cor.nome), ''), 'telefone', public.proposta_fone(_cor.telefone)));
END $$;
REVOKE ALL ON FUNCTION public.proposta_publica_ler(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_publica_ler(text, text) TO service_role;

-- Assinar: código certo + "Li e concordo" + mesma versão que a pessoa leu (conteudo_hash).
-- Resultados: assinado | codigo_errado (restantes) | limite | codigo_vencido | sem_codigo | versao_mudou |
-- aceite_obrigatorio | ja_assinado | indisponivel | vencida | invalido.
CREATE OR REPLACE FUNCTION public.proposta_publica_assinar(_token text, _codigo text, _conteudo_hash text,
  _aceite boolean, _ip text, _user_agent text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _x public.proposta_partes; _p public.propostas_compra; _c public.proposta_codigos; _sit text; _falta int;
BEGIN
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'erro', 'invalido'); END IF;
  _x := public.proposta_publica_parte(_token, _ip_hash);
  IF _x.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', CASE WHEN public.proposta_ip_bloqueado(_ip_hash) THEN 'limite' ELSE 'indisponivel' END);
  END IF;
  -- Uma assinatura por vez por proposta (a última parte decide a aceitação sem corrida).
  SELECT * INTO _p FROM public.propostas_compra WHERE id = _x.proposta_id FOR UPDATE;
  IF _p.id IS NULL OR NOT public.proposta_compra_modulo_ligado(_p.organization_id)
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _p.organization_id AND o.status = 'ativa') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel');
  END IF;
  _sit := public.proposta_situacao(_p.situacao, _p.validade_ate);
  IF _sit = 'vencida' THEN RETURN jsonb_build_object('ok', false, 'erro', 'vencida'); END IF;
  IF _sit <> 'aguardando_assinaturas' THEN RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel', 'situacao', _sit); END IF;
  IF EXISTS (SELECT 1 FROM public.proposta_assinaturas WHERE parte_id = _x.id AND invalidada_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_assinado');
  END IF;
  IF _conteudo_hash IS DISTINCT FROM public.proposta_conteudo_hash(_p.id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'versao_mudou');
  END IF;
  IF _aceite IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'aceite_obrigatorio'); END IF;

  SELECT * INTO _c FROM public.proposta_codigos
   WHERE parte_id = _x.id AND usado_em IS NULL AND invalidado_em IS NULL AND versao = _p.versao
   ORDER BY criado_em DESC LIMIT 1 FOR UPDATE;
  IF _c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_codigo'); END IF;
  IF _c.tentativas >= 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'limite'); END IF;
  IF _c.expira_em <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'codigo_vencido'); END IF;
  IF _codigo IS NULL OR _codigo !~ '^[0-9]{6}$' OR public.proposta_codigo_hash(_c.id, _codigo) <> _c.codigo_hash THEN
    UPDATE public.proposta_codigos SET tentativas = tentativas + 1 WHERE id = _c.id RETURNING * INTO _c;
    INSERT INTO public.proposta_eventos (organization_id, proposta_id, tipo, versao, detalhe)
    VALUES (_p.organization_id, _p.id, 'codigo_errado', _p.versao, _x.papel || ' ' || _x.ordem);
    IF _c.tentativas >= 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'limite'); END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'codigo_errado', 'restantes', 5 - _c.tentativas);
  END IF;

  UPDATE public.proposta_codigos SET usado_em = now() WHERE id = _c.id;
  INSERT INTO public.proposta_assinaturas (organization_id, proposta_id, parte_id, codigo_id, versao, papel, ordem, nome,
    telefone, ip, user_agent, conteudo_hash, pdf_hash)
  VALUES (_p.organization_id, _p.id, _x.id, _c.id, _p.versao, _x.papel, _x.ordem, _x.nome, _x.telefone,
    left(nullif(btrim(coalesce(_ip, '')), ''), 64), left(nullif(btrim(coalesce(_user_agent, '')), ''), 500),
    _conteudo_hash, _p.pdf_hash);
  INSERT INTO public.proposta_eventos (organization_id, proposta_id, tipo, versao, detalhe)
  VALUES (_p.organization_id, _p.id, 'assinada', _p.versao, _x.papel || ' ' || _x.ordem);

  SELECT count(*) INTO _falta FROM public.proposta_partes y WHERE y.proposta_id = _p.id
     AND NOT EXISTS (SELECT 1 FROM public.proposta_assinaturas a WHERE a.parte_id = y.id AND a.invalidada_em IS NULL);
  IF _falta = 0 THEN
    UPDATE public.propostas_compra SET situacao = 'aceita', aceita_em = now(), atualizado_em = now()
     WHERE id = _p.id RETURNING * INTO _p;
    INSERT INTO public.proposta_eventos (organization_id, proposta_id, tipo, versao, detalhe)
    VALUES (_p.organization_id, _p.id, 'aceita', _p.versao, 'Todas as partes assinaram');
  END IF;
  RETURN jsonb_build_object('ok', true, 'resultado', 'assinado', 'situacao', public.proposta_situacao(_p.situacao, _p.validade_ate),
    'faltam', _falta);
END $$;
REVOKE ALL ON FUNCTION public.proposta_publica_assinar(text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proposta_publica_assinar(text, text, text, boolean, text, text, text) TO service_role;

COMMIT;

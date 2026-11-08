-- Link de acompanhamento do negócio 1/2 (cartão t_54c79bdc; pedido de Denis em 08/11/2026, tópico 6238).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA. Rollback: supabase/rollback/20261108200000_link_acompanhamento.sql
-- Teste: supabase/tests/run-link-acompanhamento.sh (transação desfeita; nunca produção).
--
-- Regra principal: NÃO DUPLICAR. O link nasce dentro da venda (sales, sale_parties, sale_status_history) e só
-- LÊ o status atual e o histórico. Nenhum status novo, nenhuma mudança no fluxo de status, nenhuma venda alterada.
-- 1) Módulo 'link_acompanhamento' em organization_modules. Nasce DESLIGADO (nenhuma linha). Só o super-admin
--    da plataforma liga/desliga (platform_set_organization_module, mesma função, lista + 1).
-- 2) organizations.google_avaliacao_url (campo "Link de avaliação no Google"), gravado só por
--    agency_google_avaliacao_salvar (mesma permissão de agency_can_edit; não mexe nos outros campos).
-- 3) sale_acompanhamento_links: um link ATIVO por lado (comprador/vendedor) por venda. Guarda só o hash
--    SHA-256 do token. O token = HMAC-SHA256(id do link, chave do Vault), então só o banco consegue mostrá-lo de
--    novo para quem já vê a venda ("Copiar link"); a tabela sozinha não revela nenhum token.
--    Sem acesso direto (RLS ligada, sem grants a anon/authenticated).
-- 4) RPCs internas (authenticated): acompanhamento_links (lista e cria o que faltar) e
--    acompanhamento_link_regenerar (desliga o atual e gera outro; o antigo para de abrir na hora).
--    Quem pode: exatamente quem já lê a venda pelas políticas SELECT de sales (acompanhamento_pode_ver_venda).
-- 5) RPC pública acompanhamento_publico(token, ip_hash): só service_role (o servidor do ADM). Devolve SOMENTE
--    imobiliária, endereço, nomes das partes e do corretor, etapa (1-3) com datas, data da última atualização e o
--    link do Google (só no contrato assinado com o campo preenchido). Nada de valor, CPF, telefone, e-mail,
--    documento, comentário, ocorrência ou nome interno de status. Cancelada/arquivada = indisponível.
--    Limite: depois de 10 tokens errados por IP (hash) em 15 min, aquele IP só recebe "limite" para tokens
--    errados (o token certo sempre abre: o cliente que divide IP com quem errou não é bloqueado; adivinhar
--    256 bits é inviável de qualquer forma).
BEGIN;
-- Não segurar organizations/organization_modules se houver transação longa: falha em 5 s e tenta de novo.
SELECT set_config('lock_timeout', '5s', true);

-- 1) Chave do módulo -------------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento'));

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
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento')
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

CREATE OR REPLACE FUNCTION public.link_acompanhamento_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'link_acompanhamento'), false)
$$;
REVOKE ALL ON FUNCTION public.link_acompanhamento_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_acompanhamento_modulo_ligado(uuid) TO service_role;

-- Para a tela: módulo ligado na imobiliária de quem está logado.
CREATE OR REPLACE FUNCTION public.link_acompanhamento_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.link_acompanhamento_modulo_ligado(public.current_org_id())
$$;
REVOKE ALL ON FUNCTION public.link_acompanhamento_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_acompanhamento_enabled() TO authenticated, service_role;

-- 2) Link de avaliação no Google (cadastro da imobiliária) ----------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN google_avaliacao_url text
  CONSTRAINT organizations_google_avaliacao_url_check
  CHECK (google_avaliacao_url IS NULL OR (char_length(google_avaliacao_url) <= 500 AND google_avaliacao_url ~ '^https://[^\s<>"'']{3,}$'));

CREATE OR REPLACE FUNCTION public.agency_google_avaliacao_salvar(_url text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id(); _v text := nullif(btrim(coalesce(_url, '')), ''); _now text;
BEGIN
  IF NOT coalesce(public.agency_can_edit(), false)
     OR NOT coalesce(public.exclusive_actor_active(auth.uid()), false) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta configuração' USING ERRCODE = '42501';
  END IF;
  IF _v IS NOT NULL AND (char_length(_v) > 500 OR _v !~ '^https://[^\s<>"'']{3,}$') THEN
    RAISE EXCEPTION 'Link inválido: use o endereço completo começando com https://' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organizations SET google_avaliacao_url = _v WHERE id = _org RETURNING google_avaliacao_url INTO _now;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliária não encontrada' USING ERRCODE = '42501'; END IF;
  RETURN _now;
END $$;
REVOKE ALL ON FUNCTION public.agency_google_avaliacao_salvar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_google_avaliacao_salvar(text) TO authenticated;

-- 3) Tabelas ------------------------------------------------------------------------------------------------
CREATE TABLE public.sale_acompanhamento_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  lado text NOT NULL CONSTRAINT sale_acompanhamento_links_lado_check CHECK (lado IN ('comprador', 'vendedor')),
  token_hash text NOT NULL UNIQUE CONSTRAINT sale_acompanhamento_links_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ativo boolean NOT NULL DEFAULT true,
  aberturas integer NOT NULL DEFAULT 0 CONSTRAINT sale_acompanhamento_links_aberturas_check CHECK (aberturas >= 0),
  ultima_abertura timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  desligado_em timestamptz,
  desligado_por uuid
);
CREATE UNIQUE INDEX sale_acompanhamento_links_ativo_uniq ON public.sale_acompanhamento_links (sale_id, lado) WHERE ativo;
CREATE INDEX sale_acompanhamento_links_sale_idx ON public.sale_acompanhamento_links (sale_id);
ALTER TABLE public.sale_acompanhamento_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_acompanhamento_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sale_acompanhamento_links TO service_role;

-- Tentativas erradas na página pública (só o hash do IP, nunca o IP).
CREATE TABLE public.sale_acompanhamento_tentativas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CONSTRAINT sale_acompanhamento_tentativas_ip_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_acompanhamento_tentativas_idx ON public.sale_acompanhamento_tentativas (ip_hash, created_at);
CREATE INDEX sale_acompanhamento_tentativas_data_idx ON public.sale_acompanhamento_tentativas (created_at);
ALTER TABLE public.sale_acompanhamento_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_acompanhamento_tentativas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sale_acompanhamento_tentativas TO service_role;

-- Chave do HMAC no Vault (gerada aqui, nunca sai do banco).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'acompanhamento_link_chave') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'acompanhamento_link_chave',
      'Chave HMAC dos links de acompanhamento da venda (t_54c79bdc)');
  END IF;
END $$;

-- 4) Regras -----------------------------------------------------------------------------------------------
-- Etapa que o cliente vê. 1 = Preparando o contrato, 2 = Aguardando assinatura, 3 = Contrato assinado
-- (ocorrências são internas: continuam 3), 0 = cancelada/arquivada (link indisponível).
-- Status fora desta lista => NULL => link indisponível (não inventa etapa; os testes falham).
CREATE OR REPLACE FUNCTION public.acompanhamento_etapa(_status public.sale_status) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE _status::text
    WHEN 'rascunho' THEN 1 WHEN 'enviada_revisao' THEN 1 WHEN 'devolvida_ajuste' THEN 1
    WHEN 'aprovada_gestor' THEN 1 WHEN 'enviada_juridico' THEN 1 WHEN 'em_elaboracao_contrato' THEN 1
    WHEN 'contrato_conferencia_gestor' THEN 1 WHEN 'contrato_conferencia_corretor' THEN 1
    WHEN 'contrato_ok_corretor' THEN 1
    WHEN 'aguardando_assinatura' THEN 2
    WHEN 'contrato_assinado' THEN 3 WHEN 'ocorrencia_pendente' THEN 3 WHEN 'ocorrencia_analise_financeiro' THEN 3
    WHEN 'ocorrencia_devolvida_gestor' THEN 3 WHEN 'ocorrencia_concluida' THEN 3
    WHEN 'cancelada' THEN 0 WHEN 'arquivada' THEN 0
  END
$$;
REVOKE ALL ON FUNCTION public.acompanhamento_etapa(public.sale_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acompanhamento_etapa(public.sale_status) TO authenticated, service_role;

-- Token do link = HMAC-SHA256(id, chave do Vault) em base64url (43 caracteres). Só uso interno.
CREATE OR REPLACE FUNCTION public.acompanhamento_token(_link_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k text;
BEGIN
  SELECT decrypted_secret INTO _k FROM vault.decrypted_secrets WHERE name = 'acompanhamento_link_chave';
  IF _k IS NULL OR _link_id IS NULL THEN
    RAISE EXCEPTION 'Chave do link de acompanhamento ausente' USING ERRCODE = '55000';
  END IF;
  RETURN translate(encode(extensions.hmac(_link_id::text, _k, 'sha256'), 'base64'), '+/=', '-_');
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_token(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acompanhamento_hash(_token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT encode(extensions.digest(_token, 'sha256'), 'hex')
$$;
REVOKE ALL ON FUNCTION public.acompanhamento_hash(text) FROM PUBLIC, anon, authenticated, service_role;

-- Quem já lê a venda: o MESMO conjunto das políticas SELECT de sales (sales_select, co-líder, jurídico),
-- com as restritivas org_isolation (current_org_id) e zz_fotografo_fora. Nada novo é liberado.
CREATE OR REPLACE FUNCTION public.acompanhamento_pode_ver_venda(_sale_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(
    (SELECT auth.uid()) IS NOT NULL
    AND NOT coalesce(public.eh_so_fotografo((SELECT auth.uid())), false)
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND s.organization_id = public.current_org_id())
    AND (
      _sale_id IN (SELECT public.vendas_visiveis_ids())
      OR _sale_id IN (SELECT public.vendas_coleader_leitura_ids())
      OR _sale_id IN (SELECT public.vendas_juridico_certidao_ids())
      OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id
                   AND (SELECT auth.uid()) IN (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id)
                   AND public.is_active_user((SELECT auth.uid())))
    ), false)
$$;
REVOKE ALL ON FUNCTION public.acompanhamento_pode_ver_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acompanhamento_pode_ver_venda(uuid) TO authenticated;

-- Checagens comuns das RPCs internas. Devolve a venda.
CREATE OR REPLACE FUNCTION public.acompanhamento_venda_checada(_sale_id uuid)
RETURNS TABLE (organization_id uuid, etapa integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _st public.sale_status; _mod text;
BEGIN
  IF NOT coalesce(public.link_acompanhamento_enabled(), false) THEN
    RAISE EXCEPTION 'Link de acompanhamento desligado nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  IF _sale_id IS NULL OR NOT public.acompanhamento_pode_ver_venda(_sale_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta venda.' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id, s.status, s.modalidade INTO _org, _st, _mod FROM public.sales s WHERE s.id = _sale_id;
  IF _mod IS DISTINCT FROM 'padrao' THEN
    RAISE EXCEPTION 'O link de acompanhamento é só para vendas (não lançamentos).' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT _org, public.acompanhamento_etapa(_st);
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_venda_checada(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acompanhamento_links_json(_sale_id uuid, _etapa integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object(
    'disponivel', coalesce(_etapa, 0) > 0,
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'lado', l.lado, 'token', public.acompanhamento_token(l.id), 'aberturas', l.aberturas,
        'ultima_abertura', l.ultima_abertura, 'criado_em', l.criado_em) ORDER BY l.lado)
      FROM public.sale_acompanhamento_links l WHERE l.sale_id = _sale_id AND l.ativo), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.acompanhamento_links_json(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acompanhamento_link_criar(_org uuid, _sale_id uuid, _lado text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.sale_acompanhamento_links (id, organization_id, sale_id, lado, token_hash, criado_por)
  VALUES (_id, _org, _sale_id, _lado, public.acompanhamento_hash(public.acompanhamento_token(_id)), auth.uid())
  ON CONFLICT (sale_id, lado) WHERE ativo DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_link_criar(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- Bloco da venda: lista os links (e cria o do lado que ainda não tem). Venda cancelada/arquivada não cria.
CREATE OR REPLACE FUNCTION public.acompanhamento_links(_sale_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _etapa integer;
BEGIN
  SELECT c.organization_id, c.etapa INTO _org, _etapa FROM public.acompanhamento_venda_checada(_sale_id) c;
  IF coalesce(_etapa, 0) > 0 THEN
    PERFORM public.acompanhamento_link_criar(_org, _sale_id, 'comprador');
    PERFORM public.acompanhamento_link_criar(_org, _sale_id, 'vendedor');
  END IF;
  RETURN public.acompanhamento_links_json(_sale_id, _etapa);
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acompanhamento_links(uuid) TO authenticated;

-- "Desligar e gerar outro": o link atual daquele lado para de abrir na hora e nasce outro.
CREATE OR REPLACE FUNCTION public.acompanhamento_link_regenerar(_sale_id uuid, _lado text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _etapa integer;
BEGIN
  IF _lado IS NULL OR _lado NOT IN ('comprador', 'vendedor') THEN
    RAISE EXCEPTION 'Lado inválido' USING ERRCODE = '22023';
  END IF;
  SELECT c.organization_id, c.etapa INTO _org, _etapa FROM public.acompanhamento_venda_checada(_sale_id) c;
  IF coalesce(_etapa, 0) = 0 THEN
    RAISE EXCEPTION 'Venda cancelada ou arquivada: o link não abre mais.' USING ERRCODE = '22023';
  END IF;
  -- Dois cliques ao mesmo tempo: um de cada vez (o segundo desliga o link que o primeiro criou).
  PERFORM pg_advisory_xact_lock(hashtextextended('acompanhamento:' || _sale_id::text || ':' || _lado, 0));
  UPDATE public.sale_acompanhamento_links SET ativo = false, desligado_em = now(), desligado_por = auth.uid()
   WHERE sale_id = _sale_id AND lado = _lado AND ativo;
  PERFORM public.acompanhamento_link_criar(_org, _sale_id, _lado);
  RETURN public.acompanhamento_links_json(_sale_id, _etapa);
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_link_regenerar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acompanhamento_link_regenerar(uuid, text) TO authenticated;

-- 5) Página pública (só o servidor do ADM, service_role) ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.acompanhamento_publico(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _l public.sale_acompanhamento_links%ROWTYPE;
  _s public.sales%ROWTYPE; _etapa integer; _org_nome text; _google text;
  _d1 timestamptz; _d2 timestamptz; _d3 timestamptz; _upd timestamptz;
  _corretor text; _l1 text; _l2 text;
  _tz constant text := 'America/Sao_Paulo';
BEGIN
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'invalido');
  END IF;
  IF _token IS NOT NULL AND _token ~ '^[A-Za-z0-9_-]{43}$' THEN
    SELECT * INTO _l FROM public.sale_acompanhamento_links
     WHERE token_hash = public.acompanhamento_hash(_token) AND ativo;
  END IF;
  IF _l.id IS NULL THEN
    -- Limite contra quem tenta adivinhar: depois de 10 erros em 15 min, este IP só recebe "limite".
    -- Um erro por vez por IP: requisições em paralelo não furam a contagem.
    PERFORM pg_advisory_xact_lock(hashtextextended('acompanhamento_ip:' || _ip_hash, 0));
    IF (SELECT count(*) FROM public.sale_acompanhamento_tentativas
         WHERE ip_hash = _ip_hash AND created_at > now() - interval '15 minutes') >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'limite');
    END IF;
    INSERT INTO public.sale_acompanhamento_tentativas (ip_hash) VALUES (_ip_hash);
    DELETE FROM public.sale_acompanhamento_tentativas WHERE created_at < now() - interval '1 day';
    RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel');
  END IF;

  SELECT s.* INTO _s FROM public.sales s WHERE s.id = _l.sale_id AND s.organization_id = _l.organization_id;
  SELECT o.nome, o.google_avaliacao_url INTO _org_nome, _google FROM public.organizations o
   WHERE o.id = _l.organization_id AND o.status = 'ativa';
  _etapa := public.acompanhamento_etapa(_s.status);
  -- Indisponível (sem contar como tentativa errada): imobiliária inativa, módulo desligado, lançamento,
  -- venda cancelada/arquivada ou status sem etapa definida.
  IF _s.id IS NULL OR _org_nome IS NULL OR NOT public.link_acompanhamento_modulo_ligado(_l.organization_id)
     OR _s.modalidade IS DISTINCT FROM 'padrao' OR coalesce(_etapa, 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'indisponivel');
  END IF;

  UPDATE public.sale_acompanhamento_links SET aberturas = aberturas + 1, ultima_abertura = now() WHERE id = _l.id;

  -- Datas do andamento (sale_status_history): início, entrada mais recente em "aguardando" e em "assinado".
  _d1 := coalesce((SELECT min(h.created_at) FROM public.sale_status_history h WHERE h.sale_id = _s.id), _s.created_at);
  IF _etapa >= 2 THEN
    _d2 := (SELECT max(h.created_at) FROM public.sale_status_history h
             WHERE h.sale_id = _s.id AND h.para = 'aguardando_assinatura');
  END IF;
  IF _etapa = 3 THEN
    _d3 := (SELECT max(h.created_at) FROM public.sale_status_history h
             WHERE h.sale_id = _s.id AND h.para = 'contrato_assinado');
  END IF;
  -- Última atualização = última entrada na etapa atual (ocorrências internas não mudam a data).
  _upd := CASE _etapa
    WHEN 3 THEN coalesce(_d3, _d1)
    WHEN 2 THEN coalesce(_d2, _d1)
    ELSE coalesce((SELECT max(h.created_at) FROM public.sale_status_history h
                    WHERE h.sale_id = _s.id AND public.acompanhamento_etapa(h.para) = 1), _d1)
  END;

  -- Corretor para dúvidas: o do lado do link (comprador = corretor vendedor; vendedor = captador); senão o da venda.
  _corretor := CASE _l.lado
    WHEN 'comprador' THEN coalesce((SELECT nullif(btrim(p.nome), '') FROM public.profiles p WHERE p.id = _s.corretor_vendedor_id),
                                   nullif(btrim(_s.corretor_vendedor), ''))
    ELSE coalesce((SELECT nullif(btrim(p.nome), '') FROM public.profiles p WHERE p.id = _s.corretor_captador_id),
                  nullif(btrim(_s.corretor_captador), ''))
  END;
  _corretor := coalesce(_corretor, (SELECT nullif(btrim(p.nome), '') FROM public.profiles p WHERE p.id = _s.corretor_id));

  _l1 := nullif(concat_ws(', ', nullif(btrim(_s.imovel_logradouro), ''), nullif(btrim(_s.imovel_numero), ''),
                          nullif(btrim(_s.imovel_complemento), '')), '');
  _l2 := nullif(concat_ws(' · ', nullif(btrim(_s.imovel_bairro), ''),
                          nullif(concat_ws('/', nullif(btrim(_s.imovel_cidade), ''), nullif(btrim(_s.imovel_uf), '')), '')), '');
  IF _l1 IS NULL THEN _l1 := nullif(btrim(_s.imovel_endereco), ''); END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'imobiliaria', _org_nome,
    'lado', _l.lado,
    'imovel', jsonb_build_object('linha1', _l1, 'linha2', _l2),
    'compradores', coalesce((SELECT jsonb_agg(n ORDER BY papel) FROM (
        SELECT p.papel, coalesce(nullif(btrim(p.nome), ''), nullif(btrim(p.razao_social), '')) n
          FROM public.sale_parties p WHERE p.sale_id = _s.id AND p.papel LIKE 'comprador%') x WHERE n IS NOT NULL), '[]'::jsonb),
    'vendedores', coalesce((SELECT jsonb_agg(n ORDER BY papel) FROM (
        SELECT p.papel, coalesce(nullif(btrim(p.nome), ''), nullif(btrim(p.razao_social), '')) n
          FROM public.sale_parties p WHERE p.sale_id = _s.id AND p.papel LIKE 'vendedor%') x WHERE n IS NOT NULL), '[]'::jsonb),
    'corretor', _corretor,
    'etapa', _etapa,
    'datas', jsonb_build_object(
      'preparando', to_char(_d1 AT TIME ZONE _tz, 'YYYY-MM-DD'),
      'aguardando', to_char(_d2 AT TIME ZONE _tz, 'YYYY-MM-DD'),
      'assinado', to_char(_d3 AT TIME ZONE _tz, 'YYYY-MM-DD')),
    'atualizado_em', to_char(_upd AT TIME ZONE _tz, 'YYYY-MM-DD'),
    'google_url', CASE WHEN _etapa = 3 THEN nullif(btrim(_google), '') END
  );
END $$;
REVOKE ALL ON FUNCTION public.acompanhamento_publico(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acompanhamento_publico(text, text) TO service_role;

COMMIT;

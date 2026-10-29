-- "Ache um especialista" separado por imobiliária + regiões compartilhadas por cidade, com aprovação
-- POR IMOBILIÁRIA. Card t_6d8de1d7 (tópico 6238), regras de Denis de 29/10/2026.
-- Rollback: docs/sql/rollback/20261029150000_especialistas_por_imobiliaria.rollback.sql
--
-- O que faz:
-- 1) Página pública: módulo novo "especialistas_publico" (organization_modules). Nasce DESLIGADO em todas as
--    imobiliárias, exceto a imobiliária histórica (legacy_default = Única Escolha), que já aparece hoje.
--    Só o administrador da plataforma liga ou desliga (platform_set_organization_module). O endereço público
--    usa o identificador (slug) que a imobiliária já tem: /especialistas/<slug>.
-- 2) Região passa a ser da CIDADE (cidade + UF), não da imobiliária. Nome único na cidade sem diferenciar
--    acento, maiúscula ou espaço. positioning_regions.organization_id passa a significar "quem criou".
-- 3) positioning_region_orgs: vínculo região × imobiliária (ativa | pendente | recusada | juntada), com quem
--    decidiu, quando e o motivo. A imobiliária só vê e usa as regiões ATIVAS para ela.
--    - Quem cria (staff, ou aprovando sugestão de corretor) vê na hora; cada OUTRA imobiliária da mesma
--      cidade recebe a região como PENDENTE e decide só por si: aprovar, recusar (com motivo) ou juntar com
--      uma região que ela já usa. Uma imobiliária não decide pelas outras; a plataforma só consulta.
--    - Região que já existe na cidade (mesmo nome normalizado) não vira pedido: só vincula.
--    - Corretor que sugeriu é vinculado quando a região fica ativa para a imobiliária dele.
-- 4) Migração das regiões atuais: cada região fica ATIVA para a imobiliária que a criou e também para as
--    demais imobiliárias da mesma cidade (eram globais na prática). Nenhuma escolha de corretor é alterada.
--    Imobiliária que passar a ter cidade (nova ou alterada) herda o catálogo já existente da cidade como
--    ATIVO; só regiões criadas depois viram pedido para ela.
-- 5) RPCs públicas por imobiliária (mesmos campos de hoje; nada de e-mail). As duas RPCs antigas viram
--    atalhos para a imobiliária histórica e respeitam o módulo.
BEGIN;

-- 0) Normalização (sem acento, minúsculo, espaços simples) ------------------------------------------------
CREATE FUNCTION public.regiao_norm(_t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $$
  SELECT nullif(lower(translate(regexp_replace(btrim(coalesce(_t, '')), '\s+', ' ', 'g'),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '')
$$;
REVOKE ALL ON FUNCTION public.regiao_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regiao_norm(text) TO authenticated, service_role;

-- 1) Módulo da página pública ------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico')
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

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'especialistas_publico', o.legacy_default FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Região da cidade -------------------------------------------------------------------------------------
ALTER TABLE public.positioning_regions ADD COLUMN uf text, ADD COLUMN created_by uuid;
UPDATE public.positioning_regions r SET uf = upper(btrim(o.uf))
  FROM public.organizations o WHERE o.id = r.organization_id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.positioning_regions WHERE uf IS NULL OR uf !~ '^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'Regiao sem UF valida (imobiliaria criadora sem UF); abortando';
  END IF;
END $$;
ALTER TABLE public.positioning_regions ALTER COLUMN uf SET NOT NULL,
  ADD CONSTRAINT positioning_regions_uf_check CHECK (uf ~ '^[A-Z]{2}$');

ALTER TABLE public.positioning_regions DROP CONSTRAINT positioning_regions_org_unique;
CREATE UNIQUE INDEX positioning_regions_cidade_nome_uniq ON public.positioning_regions
  (public.regiao_norm(uf), public.regiao_norm(cidade), public.regiao_norm(nome));

-- Escolha e sugestão podem apontar para região criada por outra imobiliária da cidade.
ALTER TABLE public.corretor_positioning_regions DROP CONSTRAINT corretor_positioning_regions_region_org_fk;
ALTER TABLE public.positioning_region_suggestions DROP CONSTRAINT positioning_region_suggestions_region_org_fk;

-- Escrita direta na tabela de regiões deixa de existir: tudo passa pelas RPCs abaixo (que conferem a regra
-- de cidade compartilhada). A leitura direta continua restrita às regiões criadas pela própria imobiliária.
DROP POLICY positioning_regions_admin_write ON public.positioning_regions;

-- 3) Vínculo região × imobiliária --------------------------------------------------------------------------
CREATE TABLE public.positioning_region_orgs (
  region_id bigint NOT NULL REFERENCES public.positioning_regions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ativa', 'pendente', 'recusada', 'juntada')),
  juntada_em bigint REFERENCES public.positioning_regions(id) ON DELETE SET NULL,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 500),
  decidido_por uuid,
  decidido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region_id, organization_id),
  CHECK (status <> 'juntada' OR juntada_em IS NOT NULL)
);
CREATE INDEX idx_positioning_region_orgs_org ON public.positioning_region_orgs (organization_id, status);
ALTER TABLE public.positioning_region_orgs ENABLE ROW LEVEL SECURITY;
-- Sem policy: só as funções SECURITY DEFINER abaixo leem e gravam.
REVOKE ALL ON public.positioning_region_orgs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.positioning_region_orgs TO service_role;

-- Migração: ativa para quem criou e para as outras imobiliárias da mesma cidade.
INSERT INTO public.positioning_region_orgs (region_id, organization_id, status, decidido_em)
SELECT r.id, r.organization_id, 'ativa', now() FROM public.positioning_regions r WHERE r.ativo;
INSERT INTO public.positioning_region_orgs (region_id, organization_id, status, decidido_em)
SELECT r.id, o.id, 'ativa', now()
  FROM public.positioning_regions r
  JOIN public.organizations o ON o.id <> r.organization_id
   AND public.regiao_norm(o.cidade) = public.regiao_norm(r.cidade)
   AND public.regiao_norm(o.uf) = public.regiao_norm(r.uf)
 WHERE r.ativo
ON CONFLICT (region_id, organization_id) DO NOTHING;
DO $$ BEGIN
  -- Nenhuma escolha de corretor pode ficar sem a região ativa para a imobiliária dele.
  IF EXISTS (SELECT 1 FROM public.corretor_positioning_regions c
              JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo
              WHERE NOT EXISTS (SELECT 1 FROM public.positioning_region_orgs l
                                 WHERE l.region_id = c.region_id AND l.organization_id = c.organization_id
                                   AND l.status = 'ativa')) THEN
    RAISE EXCEPTION 'Escolha de corretor sem vinculo ativo; abortando';
  END IF;
END $$;

-- Corretor só fica em região ATIVA para a imobiliária dele (substitui a FK região×org removida acima).
CREATE FUNCTION public.positioning_cpr_check_regiao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.positioning_region_orgs l
                  JOIN public.positioning_regions r ON r.id = l.region_id AND r.ativo
                  WHERE l.region_id = NEW.region_id AND l.organization_id = NEW.organization_id
                    AND l.status = 'ativa') THEN
    RAISE EXCEPTION 'Essa regiao nao esta disponivel para a sua imobiliaria.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.positioning_cpr_check_regiao() FROM PUBLIC, anon, authenticated;
-- "trg_10" roda depois do trg_00_org (que define a organização a partir do corretor).
CREATE TRIGGER trg_10_regiao_ativa_org BEFORE INSERT OR UPDATE OF region_id, organization_id
  ON public.corretor_positioning_regions FOR EACH ROW EXECUTE FUNCTION public.positioning_cpr_check_regiao();

-- Imobiliária que ganha (ou troca) cidade herda o catálogo existente da cidade.
CREATE FUNCTION public.positioning_regions_org_cidade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF public.regiao_norm(NEW.cidade) IS NULL OR public.regiao_norm(NEW.uf) IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE'
     AND public.regiao_norm(NEW.cidade) IS NOT DISTINCT FROM public.regiao_norm(OLD.cidade)
     AND public.regiao_norm(NEW.uf) IS NOT DISTINCT FROM public.regiao_norm(OLD.uf) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.positioning_region_orgs (region_id, organization_id, status, decidido_em)
  SELECT r.id, NEW.id, 'ativa', now() FROM public.positioning_regions r
   WHERE r.ativo AND public.regiao_norm(r.cidade) = public.regiao_norm(NEW.cidade)
     AND public.regiao_norm(r.uf) = public.regiao_norm(NEW.uf)
  ON CONFLICT (region_id, organization_id) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.positioning_regions_org_cidade() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_positioning_regions_org_cidade AFTER INSERT OR UPDATE OF cidade, uf
  ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.positioning_regions_org_cidade();

-- 4) Funções internas ---------------------------------------------------------------------------------------
-- Imobiliária atual, se quem chama é Administrador (admin ou super_admin) ativo dela.
CREATE FUNCTION public.regioes_staff_org() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _u uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _u IS NULL OR _org IS NULL OR NOT public.is_active_user(_u)
     OR NOT public.has_any_role(_u, ARRAY['admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas administradores da imobiliaria podem gerenciar regioes.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.regioes_staff_org() FROM PUBLIC, anon, authenticated;

-- Cria a região na cidade (ou acha a existente) e deixa ATIVA para _org. Regiões novas viram pedido
-- PENDENTE para cada outra imobiliária ativa da mesma cidade. Devolve {region_id, resultado, pendentes}.
CREATE FUNCTION public.positioning_region_obter_ou_criar(_org uuid, _actor uuid, _cidade text, _uf text,
  _zona text, _nome text, _tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _c text := regexp_replace(btrim(coalesce(_cidade, '')), '\s+', ' ', 'g');
  _n text := regexp_replace(btrim(coalesce(_nome, '')), '\s+', ' ', 'g');
  _u text := upper(btrim(coalesce(_uf, '')));
  _z text := nullif(regexp_replace(btrim(coalesce(_zona, '')), '\s+', ' ', 'g'), '');
  _id bigint; _ativo boolean; _antes text; _pend int := 0;
BEGIN
  IF length(_c) < 2 OR length(_c) > 80 OR length(_n) < 2 OR length(_n) > 120 OR length(coalesce(_z, '')) > 80 THEN
    RAISE EXCEPTION 'Preencha cidade e nome da regiao corretamente.' USING ERRCODE = '22023';
  END IF;
  IF _u !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'UF invalida.' USING ERRCODE = '22023'; END IF;
  IF _tipo IS NULL OR _tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Tipo de regiao invalido.' USING ERRCODE = '22023';
  END IF;

  FOR _i IN 1..2 LOOP
    SELECT id, ativo INTO _id, _ativo FROM public.positioning_regions
     WHERE public.regiao_norm(uf) = public.regiao_norm(_u) AND public.regiao_norm(cidade) = public.regiao_norm(_c)
       AND public.regiao_norm(nome) = public.regiao_norm(_n);
    EXIT WHEN FOUND;
    INSERT INTO public.positioning_regions (cidade, uf, zona, nome, tipo, created_by)
    VALUES (_c, _u, _z, _n, _tipo, _actor)
    ON CONFLICT (public.regiao_norm(uf), public.regiao_norm(cidade), public.regiao_norm(nome)) DO NOTHING
    RETURNING id INTO _id;
    IF _id IS NOT NULL THEN
      INSERT INTO public.positioning_region_orgs (region_id, organization_id, status, decidido_por, decidido_em)
      VALUES (_id, _org, 'ativa', _actor, now());
      INSERT INTO public.positioning_region_orgs (region_id, organization_id, status)
      SELECT _id, o.id, 'pendente' FROM public.organizations o
       WHERE o.id <> _org AND o.status = 'ativa'
         AND public.regiao_norm(o.cidade) = public.regiao_norm(_c) AND public.regiao_norm(o.uf) = public.regiao_norm(_u)
      ON CONFLICT (region_id, organization_id) DO NOTHING;
      GET DIAGNOSTICS _pend = ROW_COUNT;
      RETURN jsonb_build_object('region_id', _id, 'resultado', 'criada', 'pendentes', _pend);
    END IF;
  END LOOP;
  IF _id IS NULL THEN RAISE EXCEPTION 'Nao foi possivel registrar a regiao; tente de novo.'; END IF;
  IF NOT _ativo THEN
    RAISE EXCEPTION 'Essa regiao foi desativada; peca ao administrador da plataforma para reativar.'
      USING ERRCODE = '22023';
  END IF;
  SELECT status INTO _antes FROM public.positioning_region_orgs
   WHERE region_id = _id AND organization_id = _org FOR UPDATE;
  INSERT INTO public.positioning_region_orgs (region_id, organization_id, status, decidido_por, decidido_em)
  VALUES (_id, _org, 'ativa', _actor, now())
  ON CONFLICT (region_id, organization_id) DO UPDATE
    SET status = 'ativa', juntada_em = NULL, motivo = NULL, decidido_por = _actor, decidido_em = now()
    WHERE public.positioning_region_orgs.status <> 'ativa';
  RETURN jsonb_build_object('region_id', _id,
    'resultado', CASE WHEN _antes = 'ativa' THEN 'ja_ativa' ELSE 'vinculada' END, 'pendentes', 0);
END $$;
REVOKE ALL ON FUNCTION public.positioning_region_obter_ou_criar(uuid, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- 5) RPCs do staff da imobiliária -------------------------------------------------------------------------
-- Lista de regiões da imobiliária atual em todos os estados (ativa, pendente, recusada, juntada).
CREATE FUNCTION public.positioning_org_regions()
RETURNS TABLE(id bigint, cidade text, uf text, zona text, nome text, tipo text, status text, motivo text,
  juntada_em bigint, origem_nome text, da_minha boolean, corretores_meus bigint, usada_por_outras boolean,
  pedido_por text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.regioes_staff_org();
BEGIN
  RETURN QUERY
  SELECT r.id, r.cidade, r.uf, r.zona, r.nome, r.tipo, l.status, l.motivo, l.juntada_em, o.nome,
    r.organization_id = _org,
    (SELECT count(*) FROM public.corretor_positioning_regions c WHERE c.region_id = r.id AND c.organization_id = _org),
    EXISTS (SELECT 1 FROM public.corretor_positioning_regions c WHERE c.region_id = r.id AND c.organization_id <> _org),
    coalesce((SELECT p.nome FROM public.positioning_region_suggestions s JOIN public.profiles p ON p.id = s.suggested_by
               WHERE s.region_id = r.id AND s.organization_id = r.organization_id AND s.status = 'aprovada'
               ORDER BY s.reviewed_at LIMIT 1),
             (SELECT p.nome FROM public.profiles p WHERE p.id = r.created_by)),
    r.created_at
  FROM public.positioning_region_orgs l
  JOIN public.positioning_regions r ON r.id = l.region_id AND r.ativo
  JOIN public.organizations o ON o.id = r.organization_id
  WHERE l.organization_id = _org
  ORDER BY r.cidade, r.zona NULLS LAST, r.nome;
END $$;

CREATE FUNCTION public.positioning_region_create(_cidade text, _uf text, _zona text, _nome text, _tipo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.regioes_staff_org();
BEGIN
  RETURN public.positioning_region_obter_ou_criar(_org, auth.uid(), _cidade, _uf, _zona, _nome, _tipo);
END $$;

-- Decisão da imobiliária atual sobre UMA região, só para ela: aprovar | recusar | juntar.
CREATE FUNCTION public.positioning_region_decidir(_region_id bigint, _decisao text, _motivo text DEFAULT NULL,
  _juntar_em bigint DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _org uuid := public.regioes_staff_org(); _u uuid := auth.uid();
  _l public.positioning_region_orgs%ROWTYPE; _r public.positioning_regions%ROWTYPE;
  _alvo public.positioning_regions%ROWTYPE; _m text := nullif(btrim(coalesce(_motivo, '')), ''); _uso bigint;
BEGIN
  IF _decisao IS NULL OR _decisao NOT IN ('aprovar', 'recusar', 'juntar') THEN
    RAISE EXCEPTION 'Decisao invalida.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _l FROM public.positioning_region_orgs WHERE region_id = _region_id AND organization_id = _org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Regiao nao encontrada para esta imobiliaria.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO _r FROM public.positioning_regions WHERE id = _region_id;
  IF NOT _r.ativo THEN RAISE EXCEPTION 'Essa regiao foi desativada.' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO _uso FROM public.corretor_positioning_regions
   WHERE region_id = _region_id AND organization_id = _org;

  IF _decisao = 'aprovar' THEN
    UPDATE public.positioning_region_orgs SET status = 'ativa', motivo = NULL, juntada_em = NULL,
      decidido_por = _u, decidido_em = now()
     WHERE region_id = _region_id AND organization_id = _org;
    RETURN 'ativa';
  END IF;

  IF _decisao = 'recusar' THEN
    IF _l.status = 'pendente' AND (_m IS NULL OR length(_m) < 3) THEN
      RAISE EXCEPTION 'Informe o motivo da recusa.' USING ERRCODE = '22023';
    END IF;
    IF _uso > 0 THEN
      RAISE EXCEPTION 'Ha % corretor(es) da imobiliaria usando essa regiao; use "juntar" ou peca para trocarem antes.', _uso
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.positioning_region_orgs SET status = 'recusada', motivo = left(_m, 500), juntada_em = NULL,
      decidido_por = _u, decidido_em = now()
     WHERE region_id = _region_id AND organization_id = _org;
    RETURN 'recusada';
  END IF;

  -- juntar: a imobiliária passa a usar outra região que já é ativa para ela, na mesma cidade.
  SELECT r.* INTO _alvo FROM public.positioning_regions r
    JOIN public.positioning_region_orgs l ON l.region_id = r.id AND l.organization_id = _org AND l.status = 'ativa'
   WHERE r.id = _juntar_em AND r.ativo AND r.id <> _region_id;
  IF NOT FOUND OR public.regiao_norm(_alvo.cidade) <> public.regiao_norm(_r.cidade)
     OR public.regiao_norm(_alvo.uf) <> public.regiao_norm(_r.uf) THEN
    RAISE EXCEPTION 'Escolha uma regiao ativa da mesma cidade para juntar.' USING ERRCODE = '22023';
  END IF;
  -- Corretores da imobiliária que estavam na região passam para a região escolhida (sem duplicar).
  UPDATE public.corretor_positioning_regions c SET region_id = _alvo.id
   WHERE c.region_id = _region_id AND c.organization_id = _org
     AND NOT EXISTS (SELECT 1 FROM public.corretor_positioning_regions d
                      WHERE d.corretor_id = c.corretor_id AND d.region_id = _alvo.id);
  DELETE FROM public.corretor_positioning_regions WHERE region_id = _region_id AND organization_id = _org;
  UPDATE public.positioning_region_orgs SET status = 'juntada', juntada_em = _alvo.id, motivo = left(_m, 500),
    decidido_por = _u, decidido_em = now()
   WHERE region_id = _region_id AND organization_id = _org;
  RETURN 'juntada';
END $$;

-- Renomear/desativar a região para TODA a cidade: admin da plataforma; ou o staff da imobiliária que criou,
-- desde que nenhum corretor de OUTRA imobiliária use a região.
CREATE FUNCTION public.positioning_region_editar(_region_id bigint, _nome text, _zona text, _tipo text,
  _ativo boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _u uuid := auth.uid(); _org uuid; _r public.positioning_regions%ROWTYPE;
  _n text := regexp_replace(btrim(coalesce(_nome, '')), '\s+', ' ', 'g');
  _z text := nullif(regexp_replace(btrim(coalesce(_zona, '')), '\s+', ' ', 'g'), '');
BEGIN
  SELECT * INTO _r FROM public.positioning_regions WHERE id = _region_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Regiao nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_platform_super_admin(_u) THEN
    _org := public.regioes_staff_org();
    IF _r.organization_id <> _org THEN
      RAISE EXCEPTION 'So a imobiliaria que criou a regiao (ou a plataforma) pode altera-la.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.corretor_positioning_regions c WHERE c.region_id = _region_id AND c.organization_id <> _org) THEN
      RAISE EXCEPTION 'Essa regiao e usada por corretores de outra imobiliaria; so o administrador da plataforma pode altera-la.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF length(_n) < 2 OR length(_n) > 120 OR length(coalesce(_z, '')) > 80 OR _ativo IS NULL
     OR _tipo IS NULL OR _tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Dados da regiao invalidos.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE public.positioning_regions SET nome = _n, zona = _z, tipo = _tipo, ativo = _ativo WHERE id = _region_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ja existe uma regiao com esse nome nesta cidade.' USING ERRCODE = '23505';
  END;
END $$;

-- Visão da plataforma (somente leitura): pedidos pendentes em todas as imobiliárias.
CREATE FUNCTION public.positioning_region_platform_pending()
RETURNS TABLE(region_id bigint, nome text, cidade text, uf text, origem_nome text, para_nome text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o administrador da plataforma.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.nome, r.cidade, r.uf, oo.nome, od.nome, l.created_at
    FROM public.positioning_region_orgs l
    JOIN public.positioning_regions r ON r.id = l.region_id AND r.ativo
    JOIN public.organizations oo ON oo.id = r.organization_id
    JOIN public.organizations od ON od.id = l.organization_id
   WHERE l.status = 'pendente'
   ORDER BY l.created_at;
END $$;

-- 6) Corretor ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.my_positioning_regions()
RETURNS TABLE(id bigint, cidade text, uf text, zona text, nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _u uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _u IS NULL OR _org IS NULL OR NOT public.is_active_user(_u) THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.cidade, r.uf, r.zona, r.nome, r.tipo
    FROM public.positioning_region_orgs l JOIN public.positioning_regions r ON r.id = l.region_id AND r.ativo
   WHERE l.organization_id = _org AND l.status = 'ativa'
   ORDER BY r.cidade, r.zona NULLS LAST, r.nome;
END $$;

CREATE OR REPLACE FUNCTION public.save_my_positioning(_region_ids bigint[], _public_enabled boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _user uuid := auth.uid();
  _org uuid := public.current_org_id();
BEGIN
  IF _user IS NULL OR _org IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_role(_user, 'corretor'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas corretores ativos podem editar o posicionamento.';
  END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)) > 2 THEN
    RAISE EXCEPTION 'Selecione no maximo 2 locais.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.positioning_region_orgs l
                        JOIN public.positioning_regions r ON r.id = l.region_id AND r.ativo
                       WHERE l.region_id = requested.id AND l.organization_id = _org AND l.status = 'ativa')
  ) THEN
    RAISE EXCEPTION 'Um dos locais selecionados nao esta disponivel.';
  END IF;
  DELETE FROM public.corretor_positioning_regions WHERE corretor_id = _user;
  INSERT INTO public.corretor_positioning_regions (corretor_id, region_id)
  SELECT _user, requested.id FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) AS requested(id)
  GROUP BY requested.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_positioning_region_suggestion(_cidade text, _zona text, _nome text, _tipo text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _user uuid := auth.uid();
  _org uuid := public.current_org_id();
  _uf text;
  _id uuid;
BEGIN
  IF _user IS NULL OR _org IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(_user, ARRAY['corretor','gestor','team_leader']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas Corretores, Gestores e Team Leaders ativos podem sugerir regioes.';
  END IF;
  IF length(trim(coalesce(_cidade, ''))) < 2 OR length(trim(coalesce(_cidade, ''))) > 80
    OR length(trim(coalesce(_nome, ''))) < 2 OR length(trim(coalesce(_nome, ''))) > 120
    OR length(trim(coalesce(_zona, ''))) > 80 THEN
    RAISE EXCEPTION 'Preencha cidade e nome da regiao corretamente.';
  END IF;
  IF _tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Tipo de regiao invalido.';
  END IF;
  IF (SELECT count(*) FROM public.positioning_region_suggestions
      WHERE suggested_by = _user AND status = 'pendente') >= 5 THEN
    RAISE EXCEPTION 'Voce ja possui 5 sugestoes pendentes.';
  END IF;
  SELECT upper(btrim(uf)) INTO _uf FROM public.organizations WHERE id = _org;
  IF EXISTS (
    SELECT 1 FROM public.positioning_regions r
      JOIN public.positioning_region_orgs l ON l.region_id = r.id AND l.organization_id = _org AND l.status = 'ativa'
     WHERE r.ativo AND public.regiao_norm(r.uf) IS NOT DISTINCT FROM public.regiao_norm(_uf)
       AND public.regiao_norm(r.cidade) = public.regiao_norm(_cidade)
       AND public.regiao_norm(r.nome) = public.regiao_norm(_nome)
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja esta disponivel no catalogo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.positioning_region_suggestions s
    WHERE s.status = 'pendente' AND s.organization_id = _org
      AND public.regiao_norm(s.cidade) = public.regiao_norm(_cidade)
      AND public.regiao_norm(s.nome) = public.regiao_norm(_nome)
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja foi sugerida e aguarda analise.';
  END IF;
  INSERT INTO public.positioning_region_suggestions (suggested_by, cidade, zona, nome, tipo)
  VALUES (_user, trim(_cidade), nullif(trim(coalesce(_zona, '')), ''), trim(_nome), _tipo)
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

-- Aprovar sugestão = criar/achar a região da cidade (ativa na hora para a imobiliária do corretor; pedido
-- para as outras da cidade) + vincular o corretor que sugeriu, se ele tiver vaga (máximo 2 locais).
CREATE OR REPLACE FUNCTION public.review_positioning_region_suggestion(_suggestion_id uuid, _decision text,
  _cidade text DEFAULT NULL::text, _zona text DEFAULT NULL::text, _nome text DEFAULT NULL::text, _tipo text DEFAULT NULL::text)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _user uuid := auth.uid();
  _org uuid := public.regioes_staff_org();
  _suggestion public.positioning_region_suggestions%ROWTYPE;
  _res jsonb;
  _region_id bigint;
  _uf text;
  _final_cidade text;
  _final_nome text;
  _final_tipo text;
  _final_zona text;
BEGIN
  IF _decision NOT IN ('aprovar', 'rejeitar') THEN RAISE EXCEPTION 'Decisao invalida.'; END IF;
  SELECT * INTO _suggestion FROM public.positioning_region_suggestions
  WHERE id = _suggestion_id AND organization_id = _org FOR UPDATE;
  IF NOT FOUND OR _suggestion.status <> 'pendente' THEN
    RAISE EXCEPTION 'Sugestao nao encontrada ou ja analisada.';
  END IF;

  IF _decision = 'rejeitar' THEN
    UPDATE public.positioning_region_suggestions
    SET status = 'rejeitada', reviewed_by = _user, reviewed_at = now()
    WHERE id = _suggestion_id;
    RETURN NULL;
  END IF;

  SELECT upper(btrim(uf)) INTO _uf FROM public.organizations WHERE id = _org;
  IF _uf IS NULL OR _uf !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Cadastre a cidade e a UF da imobiliaria em Dados da imobiliaria antes de aprovar.';
  END IF;
  _final_cidade := trim(coalesce(nullif(_cidade, ''), _suggestion.cidade));
  _final_nome := trim(coalesce(nullif(_nome, ''), _suggestion.nome));
  _final_tipo := coalesce(nullif(_tipo, ''), _suggestion.tipo);
  _final_zona := nullif(trim(coalesce(_zona, _suggestion.zona, '')), '');

  _res := public.positioning_region_obter_ou_criar(_org, _user, _final_cidade, _uf, _final_zona, _final_nome, _final_tipo);
  _region_id := (_res ->> 'region_id')::bigint;

  -- Vincula quem sugeriu (região já é ativa para a imobiliária dele), sem passar de 2 locais.
  IF public.is_active_user(_suggestion.suggested_by)
     AND (SELECT count(*) FROM public.corretor_positioning_regions WHERE corretor_id = _suggestion.suggested_by) < 2 THEN
    INSERT INTO public.corretor_positioning_regions (corretor_id, region_id)
    VALUES (_suggestion.suggested_by, _region_id)
    ON CONFLICT (corretor_id, region_id) DO NOTHING;
  END IF;

  UPDATE public.positioning_region_suggestions
  SET status = 'aprovada', reviewed_by = _user, reviewed_at = now(), region_id = _region_id,
      cidade = _final_cidade, zona = _final_zona, nome = _final_nome, tipo = _final_tipo
  WHERE id = _suggestion_id;
  RETURN _region_id;
END;
$function$;

-- As 3 funções acima eram do dono mt_1b_definer (sem BYPASSRLS), que não enxerga regiões criadas por
-- outra imobiliária. Passam ao dono postgres; o filtro de imobiliária é explícito no SQL.
ALTER FUNCTION public.save_my_positioning(bigint[], boolean) OWNER TO postgres;
ALTER FUNCTION public.submit_positioning_region_suggestion(text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.review_positioning_region_suggestion(uuid, text, text, text, text, text) OWNER TO postgres;

-- 7) Página pública ------------------------------------------------------------------------------------------
-- Imobiliária publicada: ativa, módulo ligado. Fora disso devolve NULL (nada é listado).
CREATE FUNCTION public.especialistas_org_publica(_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT o.id FROM public.organizations o
    JOIN public.organization_modules m ON m.organization_id = o.id AND m.module = 'especialistas_publico' AND m.enabled
   WHERE o.slug = lower(btrim(coalesce(_slug, ''))) AND o.status = 'ativa'
$$;
REVOKE ALL ON FUNCTION public.especialistas_org_publica(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_public_specialist_agencies()
RETURNS TABLE(slug text, nome text, cidade text, uf text, especialistas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT o.slug, o.nome, o.cidade, o.uf, count(p.id)::bigint
    FROM public.organizations o
    JOIN public.organization_modules m ON m.organization_id = o.id AND m.module = 'especialistas_publico' AND m.enabled
    JOIN public.profiles p ON p.organization_id = o.id AND p.ativo
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                   AND ur.organization_id = o.id)
   WHERE o.status = 'ativa'
   GROUP BY o.id, o.slug, o.nome, o.cidade, o.uf
   ORDER BY o.nome
$$;

-- Filtro da página: só regiões em que a imobiliária TEM corretor.
CREATE FUNCTION public.list_public_org_regions(_slug text)
RETURNS TABLE(id bigint, cidade text, zona text, nome text, tipo text, corretores bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH o AS (SELECT public.especialistas_org_publica(_slug) AS id)
  SELECT r.id, r.cidade, r.zona, r.nome, r.tipo, count(DISTINCT p.id)::bigint
    FROM o
    JOIN public.corretor_positioning_regions c ON c.organization_id = o.id
    JOIN public.profiles p ON p.id = c.corretor_id AND p.ativo AND p.organization_id = o.id
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                   AND ur.organization_id = o.id)
    JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo
    JOIN public.positioning_region_orgs l ON l.region_id = r.id AND l.organization_id = o.id AND l.status = 'ativa'
   GROUP BY r.id, r.cidade, r.zona, r.nome, r.tipo
   ORDER BY r.cidade, r.zona NULLS LAST, r.nome
$$;

CREATE FUNCTION public.list_public_org_specialists(_slug text, _search text DEFAULT NULL, _region_id bigint DEFAULT NULL)
RETURNS TABLE(id uuid, nome text, avatar_url text, telefone text, pagina_pessoal_url text, instagram_url text, regioes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH o AS (SELECT public.especialistas_org_publica(_slug) AS id),
       q AS (SELECT nullif(left(btrim(coalesce(_search, '')), 80), '') AS s)
  SELECT p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url,
    coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.nome, 'cidade', r.cidade, 'zona', r.zona, 'tipo', r.tipo)
             ORDER BY r.cidade, r.nome) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb)
  FROM o CROSS JOIN q
  JOIN public.profiles p ON p.organization_id = o.id
  LEFT JOIN public.corretor_positioning_regions c ON c.corretor_id = p.id AND c.organization_id = o.id
  LEFT JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo
  WHERE p.ativo
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                  AND ur.organization_id = o.id)
    AND (_region_id IS NULL OR EXISTS (SELECT 1 FROM public.corretor_positioning_regions cf
          WHERE cf.corretor_id = p.id AND cf.region_id = _region_id AND cf.organization_id = o.id))
    AND (q.s IS NULL OR p.nome ILIKE '%' || q.s || '%' OR EXISTS (
          SELECT 1 FROM public.corretor_positioning_regions cs
            JOIN public.positioning_regions rs ON rs.id = cs.region_id AND rs.ativo
           WHERE cs.corretor_id = p.id AND cs.organization_id = o.id
             AND (rs.nome ILIKE '%' || q.s || '%' OR rs.cidade ILIKE '%' || q.s || '%')))
  GROUP BY p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url
  ORDER BY p.nome
$$;

-- Assinaturas antigas: atalho para a imobiliária histórica (ou a do usuário logado), respeitando o módulo.
CREATE OR REPLACE FUNCTION public.list_public_positioning_regions()
 RETURNS TABLE(id bigint, cidade text, zona text, nome text, tipo text, corretores bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT * FROM public.list_public_org_regions(
    (SELECT o.slug FROM public.organizations o WHERE o.id = public.mt_2c_public_org()))
$function$;

CREATE OR REPLACE FUNCTION public.list_public_specialists(_search text DEFAULT NULL::text, _region_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id uuid, nome text, avatar_url text, telefone text, pagina_pessoal_url text, instagram_url text, regioes jsonb)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT * FROM public.list_public_org_specialists(
    (SELECT o.slug FROM public.organizations o WHERE o.id = public.mt_2c_public_org()), _search, _region_id)
$function$;

-- 8) Permissões ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.list_public_specialist_agencies(), public.list_public_org_regions(text),
  public.list_public_org_specialists(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_specialist_agencies(), public.list_public_org_regions(text),
  public.list_public_org_specialists(text, text, bigint) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.positioning_org_regions(), public.positioning_region_create(text, text, text, text, text),
  public.positioning_region_decidir(bigint, text, text, bigint), public.positioning_region_editar(bigint, text, text, text, boolean),
  public.positioning_region_platform_pending(), public.my_positioning_regions(),
  public.save_my_positioning(bigint[], boolean), public.submit_positioning_region_suggestion(text, text, text, text),
  public.review_positioning_region_suggestion(uuid, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.positioning_org_regions(), public.positioning_region_create(text, text, text, text, text),
  public.positioning_region_decidir(bigint, text, text, bigint), public.positioning_region_editar(bigint, text, text, text, boolean),
  public.positioning_region_platform_pending(), public.my_positioning_regions(),
  public.save_my_positioning(bigint[], boolean), public.submit_positioning_region_suggestion(text, text, text, text),
  public.review_positioning_region_suggestion(uuid, text, text, text, text, text)
  TO authenticated, service_role;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.positioning_region_orgs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.positioning_region_orgs', 'SELECT') THEN
    RAISE EXCEPTION 'positioning_region_orgs exposta';
  END IF;
  IF has_function_privilege('anon', 'public.positioning_region_obter_ou_criar(uuid,uuid,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.positioning_region_obter_ou_criar(uuid,uuid,text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.save_my_positioning(bigint[],boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'funcao interna exposta';
  END IF;
  IF NOT has_function_privilege('anon', 'public.list_public_specialists(text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.list_public_positioning_regions()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.list_public_org_specialists(text,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPCs publicas sem EXECUTE para anon';
  END IF;
END $$;

COMMIT;

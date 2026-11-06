-- Minha carreira → "Meu Plano 2027" (cartão t_1ac2e95d; maquete v3 aprovada por Denis em 06/11/2026, tópico 6238).
--
-- ADITIVA. Rollback: docs/sql/rollback/20261107120000_meu_plano_2027.rollback.sql
-- Sem BEGIN/COMMIT próprios: o teste (supabase/tests/run-meu-plano-2027.sh) a inclui numa transação desfeita.
--
-- O que faz:
-- 1) Módulo 'meu_plano_2027' em organization_modules. Nasce DESLIGADO em todas as imobiliárias (nenhuma linha é
--    criada). Só o super-admin da plataforma liga/desliga (platform_set_organization_module, tela Módulos).
--    Decisão de Denis: ligar só na RE/MAX Única Escolha, e só depois do "sim" de publicação.
-- 2) carreira_plano: 1 linha por corretor + imobiliária + ano. As respostas das telas ficam em respostas (jsonb,
--    chave = campo da tela, ex. "op.0"). Salvar a cada campo = carreira_plano_salvar(ano, {campo: valor}), que faz
--    um merge ATÔMICO no banco (respostas || campos): duas abas/aparelhos mexendo em campos diferentes não se
--    apagam; no mesmo campo, vale a última gravação. Valor null apaga o campo.
-- 3) Leitura (RLS): o corretor lê o próprio plano; gestor, admin e administrador principal (super_admin) leem os
--    planos da PRÓPRIA imobiliária (somente leitura; decisão de Denis: o broker vê tudo). Ninguém grava direto na
--    tabela: authenticated só tem SELECT; toda escrita passa pelas RPCs SECURITY DEFINER abaixo, que conferem
--    login, usuário ativo, imobiliária ativa e módulo ligado.
-- 4) Pacto: o corretor assina o próprio pacto; o broker (gestor/admin/super_admin da mesma imobiliária) assina
--    depois do corretor. Nada além disso é gravado pelo broker.
-- 5) Meta oficial: carreira_plano_usar_meta grava o Objetivo 2027 em minhas_metas (período 'ano'). Se já existir
--    meta anual, devolve 'existe' sem gravar; o app pede confirmação e chama de novo com _substituir = true.
-- 6) Taxas do funil (p.36 do book): 3 colunas opcionais em carreira_taxas (padrão da imobiliária na linha com
--    user_id NULL, gravada pelas políticas que já existem: só admin/gestor). O corretor ajusta no próprio plano.
-- 7) carreira_plano_meus_numeros(): os 5 números da p.14 que o ADM MAX já tem (últimos 12 meses), só leitura.
-- Nenhuma venda, captação ou meta existente é alterada por esta migration.

-- 1) Chave do módulo -----------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027')
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

CREATE OR REPLACE FUNCTION public.meu_plano_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'meu_plano_2027'), false)
$$;
REVOKE ALL ON FUNCTION public.meu_plano_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meu_plano_modulo_ligado(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.meu_plano_2027_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.meu_plano_modulo_ligado(public.current_org_id())
$$;
REVOKE ALL ON FUNCTION public.meu_plano_2027_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_plano_2027_enabled() TO authenticated, service_role;

-- Quem vê os planos da imobiliária (somente leitura) e assina o pacto como broker.
CREATE OR REPLACE FUNCTION public.meu_plano_eh_broker(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND public.has_any_role(_uid, ARRAY['gestor', 'admin', 'super_admin']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.meu_plano_eh_broker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_plano_eh_broker(uuid) TO authenticated, service_role;

-- 2) Tabela ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carreira_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ano integer NOT NULL CHECK (ano BETWEEN 2026 AND 2100),
  trilha text CHECK (trilha IS NULL OR trilha IN ('ativacao', 'planejamento')),
  -- Dia em que o corretor começou a trilha Ativação (os 90 dias contam daqui; decisão de Denis).
  ativacao_inicio date,
  respostas jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(respostas) = 'object' AND octet_length(respostas::text) <= 200000),
  assinado_corretor_em timestamptz,
  assinado_broker_em timestamptz,
  assinado_broker_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  meta_oficial jsonb,
  meta_oficial_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carreira_plano_unico UNIQUE (organization_id, user_id, ano),
  CONSTRAINT carreira_plano_broker_depois CHECK (assinado_broker_em IS NULL OR assinado_corretor_em IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS carreira_plano_org_ano ON public.carreira_plano (organization_id, ano);

CREATE TRIGGER trg_carreira_plano_updated BEFORE UPDATE ON public.carreira_plano
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.carreira_plano ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carreira_plano FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.carreira_plano TO authenticated;
GRANT ALL ON public.carreira_plano TO service_role;

CREATE POLICY org_isolation ON public.carreira_plano AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY modulo_ligado ON public.carreira_plano AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.meu_plano_2027_enabled()));
CREATE POLICY carreira_plano_ler ON public.carreira_plano FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.meu_plano_eh_broker((SELECT auth.uid()))));

-- 3) Taxas do funil (padrão da imobiliária; NULL = valor do book) ---------------------------------------------
ALTER TABLE public.carreira_taxas
  ADD COLUMN IF NOT EXISTS funil_v2_cre numeric(5,2) CHECK (funil_v2_cre IS NULL OR (funil_v2_cre > 0 AND funil_v2_cre <= 100)),
  ADD COLUMN IF NOT EXISTS funil_v1_v2 numeric(5,2) CHECK (funil_v1_v2 IS NULL OR (funil_v1_v2 > 0 AND funil_v1_v2 <= 100)),
  ADD COLUMN IF NOT EXISTS funil_folga numeric(5,2) CHECK (funil_folga IS NULL OR (funil_folga >= 0 AND funil_folga <= 200));

-- 4) RPCs -----------------------------------------------------------------------------------------------------
-- Conferência comum: devolve a imobiliária ativa ou recusa.
CREATE OR REPLACE FUNCTION public.meu_plano_org_ok() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT public.is_active_user(_me) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.meu_plano_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Meu Plano 2027 não está ligado nesta imobiliária' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.meu_plano_org_ok() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meu_plano_org_ok() TO service_role;

-- Salva campos do próprio plano (merge atômico). Devolve o updated_at gravado.
CREATE OR REPLACE FUNCTION public.carreira_plano_salvar(_ano integer, _campos jsonb)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _k text; _v jsonb; _n int := 0; _em timestamptz;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF _campos IS NULL OR jsonb_typeof(_campos) <> 'object' THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(_campos) LOOP
    _n := _n + 1;
    IF _n > 120 THEN RAISE EXCEPTION 'Campos demais numa gravação' USING ERRCODE = '22023'; END IF;
    IF _k !~ '^[a-z0-9]{1,8}(\.[A-Za-z0-9]{1,12}){0,3}$' THEN
      RAISE EXCEPTION 'Campo inválido: %', left(_k, 40) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_v) NOT IN ('string', 'boolean', 'number', 'null')
       OR (jsonb_typeof(_v) = 'string' AND length(_v #>> '{}') > 4000) THEN
      RAISE EXCEPTION 'Valor inválido em %', _k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF _n = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.carreira_plano AS p (organization_id, user_id, ano, respostas)
  VALUES (_org, _me, _ano, jsonb_strip_nulls(_campos))
  ON CONFLICT (organization_id, user_id, ano)
  DO UPDATE SET respostas = jsonb_strip_nulls(p.respostas || _campos)
  RETURNING p.updated_at INTO _em;
  RETURN _em;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_salvar(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_salvar(integer, jsonb) TO authenticated, service_role;

-- Escolhe a trilha. A primeira vez em 'ativacao' grava o dia de início (horário de SP).
CREATE OR REPLACE FUNCTION public.carreira_plano_trilha(_ano integer, _trilha text)
RETURNS date LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _ini date;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF _trilha IS NULL OR _trilha NOT IN ('ativacao', 'planejamento') THEN
    RAISE EXCEPTION 'Trilha inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.carreira_plano AS p (organization_id, user_id, ano, trilha, ativacao_inicio)
  VALUES (_org, _me, _ano, _trilha, CASE WHEN _trilha = 'ativacao' THEN _hoje END)
  ON CONFLICT (organization_id, user_id, ano)
  DO UPDATE SET trilha = EXCLUDED.trilha,
    ativacao_inicio = coalesce(p.ativacao_inicio, CASE WHEN EXCLUDED.trilha = 'ativacao' THEN _hoje END)
  RETURNING p.ativacao_inicio INTO _ini;
  RETURN _ini;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_trilha(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_trilha(integer, text) TO authenticated, service_role;

-- O corretor assina o próprio pacto (uma vez; assinar de novo mantém a data).
CREATE OR REPLACE FUNCTION public.carreira_plano_assinar(_ano integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz;
BEGIN
  _org := public.meu_plano_org_ok();
  UPDATE public.carreira_plano SET assinado_corretor_em = coalesce(assinado_corretor_em, now())
   WHERE organization_id = _org AND user_id = _me AND ano = _ano
  RETURNING assinado_corretor_em INTO _em;
  IF _em IS NULL THEN RAISE EXCEPTION 'Preencha o pacto antes de assinar' USING ERRCODE = 'P0002'; END IF;
  RETURN _em;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_assinar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_assinar(integer) TO authenticated, service_role;

-- O broker (gestor/admin/super_admin da mesma imobiliária) assina depois do corretor.
CREATE OR REPLACE FUNCTION public.carreira_plano_assinar_broker(_corretor uuid, _ano integer)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _em timestamptz; _assin timestamptz; _achou boolean := false;
BEGIN
  _org := public.meu_plano_org_ok();
  IF NOT public.meu_plano_eh_broker(_me) THEN
    RAISE EXCEPTION 'Só o gestor ou o administrador assina como broker' USING ERRCODE = '42501';
  END IF;
  SELECT true, assinado_corretor_em INTO _achou, _assin FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  IF NOT coalesce(_achou, false) THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _assin IS NULL THEN RAISE EXCEPTION 'O corretor ainda não assinou o pacto' USING ERRCODE = '22023'; END IF;
  UPDATE public.carreira_plano
     SET assinado_broker_em = coalesce(assinado_broker_em, now()),
         assinado_broker_por = coalesce(assinado_broker_por, _me)
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano
  RETURNING assinado_broker_em INTO _em;
  RETURN _em;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_assinar_broker(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_assinar_broker(uuid, integer) TO authenticated, service_role;

-- Objetivo do plano → meta anual oficial (minhas_metas). Se já houver meta do ano e _substituir = false,
-- devolve {status:'existe', atual:{...}} sem gravar.
CREATE OR REPLACE FUNCTION public.carreira_plano_usar_meta(_ano integer, _comissao numeric, _vgv numeric,
  _vendas integer, _captacoes integer, _substituir boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _ini date; _atual public.minhas_metas%ROWTYPE; _snap jsonb;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF (_comissao IS NOT NULL AND (_comissao < 0 OR _comissao > 999999999999)) OR
     (_vgv IS NOT NULL AND (_vgv < 0 OR _vgv > 99999999999999)) OR
     (_vendas IS NOT NULL AND _vendas NOT BETWEEN 0 AND 10000) OR
     (_captacoes IS NOT NULL AND _captacoes NOT BETWEEN 0 AND 10000) OR
     num_nulls(_comissao, _vgv, _vendas, _captacoes) = 4 THEN
    RAISE EXCEPTION 'Meta inválida' USING ERRCODE = '22023';
  END IF;
  _ini := make_date(_ano, 1, 1);
  SELECT * INTO _atual FROM public.minhas_metas
   WHERE organization_id = _org AND user_id = _me AND periodo = 'ano' AND inicio = _ini FOR UPDATE;
  IF FOUND AND NOT coalesce(_substituir, false) THEN
    RETURN jsonb_build_object('status', 'existe', 'atual', jsonb_build_object(
      'meta_comissao', _atual.meta_comissao, 'meta_vgv', _atual.meta_vgv,
      'meta_vendas', _atual.meta_vendas, 'meta_captacoes', _atual.meta_captacoes));
  END IF;
  INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao, meta_vgv, meta_vendas, meta_captacoes)
  VALUES (_org, _me, 'ano', _ini, round(_comissao, 2), round(_vgv, 2), _vendas, _captacoes)
  ON CONFLICT (organization_id, user_id, periodo, inicio)
  DO UPDATE SET meta_comissao = EXCLUDED.meta_comissao, meta_vgv = EXCLUDED.meta_vgv,
    meta_vendas = EXCLUDED.meta_vendas, meta_captacoes = EXCLUDED.meta_captacoes;
  _snap := jsonb_build_object('meta_comissao', round(_comissao, 2), 'meta_vgv', round(_vgv, 2),
    'meta_vendas', _vendas, 'meta_captacoes', _captacoes);
  INSERT INTO public.carreira_plano AS p (organization_id, user_id, ano, meta_oficial, meta_oficial_em)
  VALUES (_org, _me, _ano, _snap, now())
  ON CONFLICT (organization_id, user_id, ano)
  DO UPDATE SET meta_oficial = EXCLUDED.meta_oficial, meta_oficial_em = EXCLUDED.meta_oficial_em;
  RETURN jsonb_build_object('status', 'gravada', 'meta', _snap);
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_usar_meta(integer, numeric, numeric, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_usar_meta(integer, numeric, numeric, integer, integer, boolean)
  TO authenticated, service_role;

-- Equipe (broker): quem é corretor/TL/gestor ativo na imobiliária, com o plano do ano (se houver).
CREATE OR REPLACE FUNCTION public.carreira_plano_equipe(_ano integer)
RETURNS TABLE(user_id uuid, nome text, avatar_url text, trilha text, ativacao_inicio date, respostas jsonb,
              assinado_corretor_em timestamptz, assinado_broker_em timestamptz, meta_oficial_em timestamptz,
              updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid;
BEGIN
  _org := public.meu_plano_org_ok();
  IF NOT public.meu_plano_eh_broker(_me) THEN
    RAISE EXCEPTION 'Só gestor ou administrador vê a equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.nome, pr.avatar_url, cp.trilha, cp.ativacao_inicio, coalesce(cp.respostas, '{}'::jsonb),
         cp.assinado_corretor_em, cp.assinado_broker_em, cp.meta_oficial_em, cp.updated_at
    FROM public.organization_members m
    JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
    LEFT JOIN public.carreira_plano cp ON cp.organization_id = _org AND cp.user_id = pr.id AND cp.ano = _ano
   WHERE m.organization_id = _org AND m.ativo
     AND (cp.id IS NOT NULL OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id
            AND ur.organization_id = _org AND ur.role IN ('corretor', 'team_leader', 'gestor')))
   ORDER BY cp.updated_at DESC NULLS LAST, pr.nome;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_equipe(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_equipe(integer) TO authenticated, service_role;

-- p.14: os 5 números que o ADM MAX já tem (últimos 12 meses, só do próprio corretor). Só leitura.
CREATE OR REPLACE FUNCTION public.carreira_plano_meus_numeros()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _r record; _ativos integer;
BEGIN
  _org := public.meu_plano_org_ok();
  SELECT * INTO _r FROM public.meu_realizado(_hoje - 365, _hoje);
  SELECT count(*)::integer INTO _ativos FROM public.exclusive_captures c
   WHERE c.organization_id = _org AND c.captor_id = _me AND c.status = 'aprovada'
     AND c.archived_at IS NULL AND c.discarded_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.exclusive_capture_id = c.id
                      AND s.status NOT IN ('arquivada', 'cancelada'));
  RETURN jsonb_build_object(
    'comissao', _r.comissao,
    'transacoes', coalesce(_r.como_captador, 0) + coalesce(_r.como_vendedor, 0),
    'ticket', CASE WHEN _r.vendas > 0 THEN round(_r.vgv / _r.vendas, 2) END,
    'cres', _r.captacoes,
    'ativos', _ativos);
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_meus_numeros() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_meus_numeros() TO authenticated, service_role;

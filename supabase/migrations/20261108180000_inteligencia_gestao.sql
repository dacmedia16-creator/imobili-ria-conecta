-- Inteligência de gestão 1/3 (cartão t_1d3c07b3; briefing aprovado por Denis em 08/11/2026, tópico 6238).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA. Rollback: supabase/rollback/20261108180000_inteligencia_gestao.sql
-- Teste: supabase/tests/run-inteligencia-gestao.sh (transação desfeita; nunca produção).
--
-- O que faz (regra principal: NÃO DUPLICAR — as contas do farol ficam em src/lib/inteligencia-gestao.ts,
-- reaproveitando as regras que já existem; o banco só entrega os dados, com a checagem de papel):
-- 1) Módulo 'inteligencia_gestao' em organization_modules. Nasce DESLIGADO em todas as imobiliárias (nenhuma
--    linha é criada). Só o super-admin da plataforma liga/desliga. Desligar não apaga nada.
-- 2) gestao_conversas_1a1: conversa 1:1 (imobiliária, equipe, corretor, quem conduziu, data, pauta do momento,
--    combinados, próxima data = data + 14 dias se não informada). Leitura (RLS): gestor/admin = qualquer
--    corretor da própria imobiliária; team leader = só quem é da(s) equipe(s) que lidera; corretor = só as
--    próprias (todas as colunas; nada escondido). Escrita só pelas RPCs.
-- 3) gestao_farol_dados(_ano, _corretor): os dados de cada corretor que o farol precisa e que ainda não vinham
--    de outra RPC (leads em aberto com os prazos, exclusividades + reuniões, funil de 90 dias, entrada na
--    equipe, última/próxima 1:1). Atividade da semana e metas continuam vindo de carreira_diario_equipe_semana
--    / meu_diario_contagens; dias sem vender, de painel_equipe_dados / minhas_comissoes.
-- 4) carreira_pendencias_de(_user): o corpo de minhas_pendencias() passa para esta função interna (mesma saída);
--    minhas_pendencias() vira uma chamada a ela. gestao_pendencias_corretor(_corretor) deixa o gestor/TL ler
--    o "O que fazer hoje" do corretor para a pauta da 1:1.
-- Nenhuma venda, captação, lead, plano ou registro do Diário é alterado.
BEGIN;

-- 1) Chave do módulo -------------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao'));

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
                                        'avisos_exclusividade', 'inteligencia_gestao')
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

-- Para jobs/servidor (service_role); authenticated não executa.
CREATE OR REPLACE FUNCTION public.inteligencia_gestao_modulo_ligado(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'inteligencia_gestao'), false)
$$;
REVOKE ALL ON FUNCTION public.inteligencia_gestao_modulo_ligado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inteligencia_gestao_modulo_ligado(uuid) TO service_role;

-- Para a tela: módulo ligado na imobiliária de quem está logado.
CREATE OR REPLACE FUNCTION public.inteligencia_gestao_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id() IS NOT NULL AND public.inteligencia_gestao_modulo_ligado(public.current_org_id())
$$;
REVOKE ALL ON FUNCTION public.inteligencia_gestao_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inteligencia_gestao_enabled() TO authenticated, service_role;

-- Quem pode ver os dados de gestão de _corretor (na imobiliária atual): o próprio corretor; gestor, admin e
-- administrador principal = qualquer pessoa ativa da imobiliária; team leader = quem é membro de equipe que
-- ele lidera (ou co-lidera, ou equipe-filha). Mesma regra de carreira_diario_equipe_semana.
CREATE OR REPLACE FUNCTION public.gestao_pode_ver(_corretor uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR _corretor IS NULL OR NOT coalesce(public.is_active_user(_me), false)
     OR NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m
                  WHERE m.organization_id = _org AND m.user_id = _corretor) THEN
    RETURN false;
  END IF;
  IF _corretor = _me THEN RETURN true; END IF;
  IF public.meu_plano_eh_broker(_me) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                  WHERE tm.membro_id = _corretor AND t.organization_id = _org
                    AND public.leads_team_or_parent(t.id, _me));
END $$;
REVOKE ALL ON FUNCTION public.gestao_pode_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_pode_ver(uuid) TO authenticated, service_role;

-- Conduzir a 1:1: quem pode ver, menos o próprio corretor.
CREATE OR REPLACE FUNCTION public.gestao_pode_conduzir(_corretor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND _corretor IS DISTINCT FROM auth.uid() AND public.gestao_pode_ver(_corretor)
$$;
REVOKE ALL ON FUNCTION public.gestao_pode_conduzir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_pode_conduzir(uuid) TO authenticated, service_role;

-- 2) Conversas 1:1 ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gestao_conversas_1a1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Equipe do corretor no dia da conversa (nula para quem não tem equipe).
  team_id uuid,
  corretor_id uuid NOT NULL,
  conduzido_por uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  data date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  -- Retrato da pauta no momento (números do mês, sinais acesos, pendências, combinados anteriores com
  -- feito/não feito). O corretor vê tudo.
  pauta jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(pauta) = 'object' AND octet_length(pauta::text) <= 100000),
  -- Novos combinados: [{"texto": "...", "feito": null}] (o feito/não feito é marcado na conversa seguinte).
  combinados jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(combinados) = 'array' AND jsonb_array_length(combinados) <= 20),
  proxima_data date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 14),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pertencer à imobiliária é conferido na RPC (organization_members), porque uma pessoa pode estar em mais
  -- de uma imobiliária.
  CONSTRAINT gestao_1a1_corretor_fk FOREIGN KEY (corretor_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT gestao_1a1_team_fk FOREIGN KEY (team_id, organization_id)
    REFERENCES public.teams (id, organization_id) ON DELETE SET NULL (team_id),
  CONSTRAINT gestao_1a1_proxima_depois CHECK (proxima_data >= data),
  CONSTRAINT gestao_1a1_nao_consigo CHECK (conduzido_por IS NULL OR conduzido_por <> corretor_id)
);
CREATE INDEX IF NOT EXISTS gestao_1a1_corretor ON public.gestao_conversas_1a1 (organization_id, corretor_id, data DESC);

CREATE TRIGGER trg_gestao_1a1_updated BEFORE UPDATE ON public.gestao_conversas_1a1
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.gestao_conversas_1a1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gestao_conversas_1a1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gestao_conversas_1a1 TO authenticated;
GRANT ALL ON public.gestao_conversas_1a1 TO service_role;

CREATE POLICY org_isolation ON public.gestao_conversas_1a1 AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY modulo_ligado ON public.gestao_conversas_1a1 AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.inteligencia_gestao_enabled()))
  WITH CHECK ((SELECT public.inteligencia_gestao_enabled()));
CREATE POLICY gestao_1a1_ler ON public.gestao_conversas_1a1 FOR SELECT TO authenticated
  USING (corretor_id = (SELECT auth.uid()) OR public.gestao_pode_ver(corretor_id));

-- Valida a lista de combinados: até 20, cada um {texto: 1 a 300 caracteres, feito: true/false/null}.
CREATE OR REPLACE FUNCTION public.gestao_combinados_ok(_c jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT _c IS NOT NULL AND jsonb_typeof(_c) = 'array' AND jsonb_array_length(_c) <= 20
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(_c) e(x)
        WHERE jsonb_typeof(x) <> 'object'
           OR jsonb_typeof(x->'texto') IS DISTINCT FROM 'string'
           OR length(btrim(x->>'texto')) NOT BETWEEN 1 AND 300
           OR coalesce(jsonb_typeof(x->'feito'), 'null') NOT IN ('boolean', 'null')
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('texto', 'feito')))
$$;
REVOKE ALL ON FUNCTION public.gestao_combinados_ok(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_combinados_ok(jsonb) TO authenticated, service_role;

-- Salva a 1:1. Gestor/admin: qualquer corretor da imobiliária; TL: só da própria equipe; ninguém consigo mesmo.
-- Data: de 31 dias atrás até hoje. Próxima: data + 14 se não vier; até 180 dias depois da conversa.
CREATE OR REPLACE FUNCTION public.gestao_1a1_salvar(_corretor uuid, _data date, _pauta jsonb, _combinados jsonb,
  _proxima date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _id uuid; _team uuid;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _prox date;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Inteligência de gestão não está ligada nesta imobiliária' USING ERRCODE = '42501';
  END IF;
  IF NOT public.gestao_pode_conduzir(_corretor) THEN
    RAISE EXCEPTION 'Só o gestor ou o líder da equipe do corretor faz a 1:1' USING ERRCODE = '42501';
  END IF;
  _data := coalesce(_data, _hoje);
  IF _data > _hoje OR _data < _hoje - 31 THEN
    RAISE EXCEPTION 'Data da 1:1: de hoje até 31 dias atrás' USING ERRCODE = '22023';
  END IF;
  IF _pauta IS NULL OR jsonb_typeof(_pauta) <> 'object' OR octet_length(_pauta::text) > 100000 THEN
    RAISE EXCEPTION 'Pauta inválida' USING ERRCODE = '22023';
  END IF;
  _combinados := coalesce(_combinados, '[]'::jsonb);
  IF NOT public.gestao_combinados_ok(_combinados) THEN
    RAISE EXCEPTION 'Combinados inválidos (até 20, de 1 a 300 caracteres)' USING ERRCODE = '22023';
  END IF;
  _prox := coalesce(_proxima, _data + 14);
  IF _prox < _data OR _prox > _data + 180 THEN
    RAISE EXCEPTION 'Próxima 1:1: entre a data da conversa e 180 dias depois' USING ERRCODE = '22023';
  END IF;
  -- Equipe do corretor (de preferência a que eu lidero).
  SELECT tm.team_id INTO _team FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
   WHERE tm.membro_id = _corretor AND t.organization_id = _org
   ORDER BY public.leads_team_or_parent(t.id, _me) DESC, tm.created_at LIMIT 1;
  INSERT INTO public.gestao_conversas_1a1 (organization_id, team_id, corretor_id, conduzido_por, data, pauta,
                                           combinados, proxima_data)
  VALUES (_org, _team, _corretor, _me, _data, _pauta, _combinados, _prox) RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.gestao_1a1_salvar(uuid, date, jsonb, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_1a1_salvar(uuid, date, jsonb, jsonb, date) TO authenticated, service_role;

-- Remarca a próxima 1:1 (quem pode conduzir com o corretor). Só a data muda.
CREATE OR REPLACE FUNCTION public.gestao_1a1_remarcar(_id uuid, _proxima date)
RETURNS date LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _c record;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false)
     OR NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  SELECT id, corretor_id, data INTO _c FROM public.gestao_conversas_1a1
   WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _c.id IS NULL OR NOT public.gestao_pode_conduzir(_c.corretor_id) THEN
    RAISE EXCEPTION 'Conversa não encontrada' USING ERRCODE = '42501';
  END IF;
  IF _proxima IS NULL OR _proxima < _c.data OR _proxima > _c.data + 180 THEN
    RAISE EXCEPTION 'Próxima 1:1: entre a data da conversa e 180 dias depois' USING ERRCODE = '22023';
  END IF;
  UPDATE public.gestao_conversas_1a1 SET proxima_data = _proxima WHERE id = _id;
  RETURN _proxima;
END $$;
REVOKE ALL ON FUNCTION public.gestao_1a1_remarcar(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_1a1_remarcar(uuid, date) TO authenticated, service_role;

-- 3) Dados do farol ---------------------------------------------------------------------------------------------
-- _corretor NULL: todos que eu vejo (gestor/admin: corretores e TLs ativos da imobiliária, sem mim; TL: membros
-- das equipes que lidero). _corretor informado: só ele, se eu puder ver (o corretor pede o próprio termômetro).
-- O funil da equipe é o total somado da equipe do corretor (sem nomes); sem equipe, o da imobiliária.
CREATE OR REPLACE FUNCTION public.gestao_farol_dados(_ano integer, _corretor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _broker boolean; _tl boolean;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _ini90 date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 89;
  _leads boolean; _caps boolean; _reun boolean; _ids uuid[]; _res jsonb;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.inteligencia_gestao_modulo_ligado(_org) THEN
    RAISE EXCEPTION 'Inteligência de gestão não está ligada nesta imobiliária' USING ERRCODE = '42501';
  END IF;
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN
    RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023';
  END IF;
  _broker := public.meu_plano_eh_broker(_me);
  IF _corretor IS NOT NULL THEN
    IF NOT public.gestao_pode_ver(_corretor) THEN
      RAISE EXCEPTION 'Sem acesso a este corretor' USING ERRCODE = '42501';
    END IF;
    _ids := ARRAY[_corretor];
  ELSE
    _tl := EXISTS (SELECT 1 FROM public.teams t WHERE t.organization_id = _org AND public.leads_team_or_parent(t.id, _me));
    IF NOT _broker AND NOT _tl THEN
      RAISE EXCEPTION 'Apenas gestor, administrador ou líder de equipe vê o farol da equipe' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(pr.id ORDER BY pr.nome), '{}') INTO _ids
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo AND pr.id <> _me
       AND CASE WHEN _broker THEN EXISTS (
                  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader'))
                ELSE EXISTS (
                  SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                   WHERE tm.membro_id = pr.id AND t.organization_id = _org
                     AND public.leads_team_or_parent(t.id, _me)) END;
  END IF;

  _leads := coalesce((SELECT enabled FROM public.organization_modules WHERE organization_id = _org AND module = 'leads'), false);
  _caps := coalesce((SELECT enabled FROM public.organization_modules WHERE organization_id = _org AND module = 'captacao_exclusiva'), false);
  _reun := public.avisos_exclusividade_modulo_ligado(_org);

  WITH pessoas AS (
    SELECT pr.id, pr.nome,
      (SELECT tm.team_id FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.membro_id = pr.id AND t.organization_id = _org
        ORDER BY public.leads_team_or_parent(t.id, _me) DESC, tm.created_at LIMIT 1) AS team_id
      FROM public.profiles pr WHERE pr.id = ANY (_ids)),
  entrada AS (
    -- Entrada na equipe atual: vigência do histórico; senão, quando virou membro; sem equipe, entrada na imobiliária.
    SELECT p.id,
      coalesce(
        (SELECT max(h.vigente_de) FROM public.team_membership_history h
          WHERE h.membro_id = p.id AND h.team_id = p.team_id AND h.vigente_ate IS NULL),
        (SELECT min(tm.created_at) FROM public.team_members tm WHERE tm.membro_id = p.id AND tm.team_id = p.team_id),
        (SELECT min(m.created_at) FROM public.organization_members m WHERE m.user_id = p.id AND m.organization_id = _org)
      ) AS em
      FROM pessoas p),
  funil AS (
    -- Últimos 90 dias. "Visita (antiga)" fica de fora; captação = exclusiva aprovada pela data de assinatura
    -- (a mesma regra do Diário).
    SELECT x.uid,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'ligacao'), 0)::integer AS lig,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v1'), 0)::integer AS v1,
      coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v2'), 0)::integer AS v2
      FROM (SELECT DISTINCT unnest(_ids) AS uid
            UNION SELECT tm.membro_id FROM public.team_members tm
                   WHERE tm.team_id IN (SELECT team_id FROM pessoas) AND tm.organization_id = _org
            UNION SELECT m.user_id FROM public.organization_members m WHERE m.organization_id = _org AND m.ativo
                   AND EXISTS (SELECT 1 FROM pessoas WHERE team_id IS NULL)) x
      LEFT JOIN public.carreira_diario d ON d.user_id = x.uid AND d.organization_id = _org
       AND d.dia BETWEEN _ini90 AND _hoje AND d.tipo IN ('ligacao', 'v1', 'v2')
     GROUP BY x.uid),
  capt90 AS (
    SELECT coalesce(c.captador_original_id, c.captor_id) AS uid, count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND (c.signed_on IS NULL OR c.signed_on BETWEEN _ini90 AND _hoje)
       AND coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) BETWEEN _ini90 AND _hoje
     GROUP BY 1),
  funil_cap AS (
    SELECT f.uid, f.lig, f.v1, f.v2, coalesce(c.n, 0) AS capt FROM funil f LEFT JOIN capt90 c ON c.uid = f.uid),
  ult AS (
    SELECT DISTINCT ON (g.corretor_id) g.corretor_id, g.id, g.data, g.proxima_data, g.combinados, pr.nome AS com
      FROM public.gestao_conversas_1a1 g LEFT JOIN public.profiles pr ON pr.id = g.conduzido_por
     WHERE g.organization_id = _org AND g.corretor_id = ANY (_ids)
     ORDER BY g.corretor_id, g.data DESC, g.created_at DESC)
  SELECT jsonb_build_object(
    'hoje', _hoje,
    'lead_config', CASE WHEN _leads THEN (SELECT jsonb_build_object(
        'prazo_aceite_min', c.prazo_aceite_min, 'prazo_primeira_interacao_dias', c.prazo_primeira_interacao_dias,
        'prazo_sem_interacao_dias', c.prazo_sem_interacao_dias)
        FROM public.lead_config c WHERE c.organization_id = _org) END,
    'taxas_em', (SELECT max(tx.updated_at) FROM public.carreira_taxas tx WHERE tx.organization_id = _org AND tx.user_id IS NULL),
    'pessoas', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'nome', p.nome, 'team_id', p.team_id,
      'entrou_em', ((SELECT e.em FROM entrada e WHERE e.id = p.id) AT TIME ZONE 'America/Sao_Paulo')::date,
      'metas_em', (SELECT (cp.updated_at AT TIME ZONE 'America/Sao_Paulo')::date FROM public.carreira_plano cp
                    WHERE cp.organization_id = _org AND cp.user_id = p.id AND cp.ano = _ano),
      'leads', CASE WHEN _leads THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
          'etapa', l.etapa, 'no_banco_desde', l.no_banco_desde, 'responsavel_id', l.responsavel_id,
          'atribuido_em', l.atribuido_em, 'aceito_em', l.aceito_em, 'ultima_interacao_em', l.ultima_interacao_em,
          'created_at', l.created_at))
          FROM (SELECT * FROM public.leads l WHERE l.organization_id = _org AND l.responsavel_id = p.id
                   AND l.etapa NOT IN ('ganho', 'perdido') AND l.no_banco_desde IS NULL
                 ORDER BY l.created_at LIMIT 300) l), '[]'::jsonb) END,
      'captacoes', CASE WHEN _caps THEN coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'status', c.status, 'signed_on', c.signed_on,
          'prazo_dias', c.form_data->'condicoes'->>'prazo_dias_numero',
          'vendida', EXISTS (SELECT 1 FROM public.sales s WHERE s.exclusive_capture_id = c.id AND s.organization_id = _org
                               AND s.status::text IN ('contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
                                                      'ocorrencia_devolvida_gestor', 'ocorrencia_concluida')),
          'reunioes', CASE WHEN _reun THEN coalesce((SELECT jsonb_agg(r.met_on ORDER BY r.met_on)
                          FROM public.exclusive_owner_meetings r WHERE r.capture_id = c.id AND r.organization_id = _org),
                          '[]'::jsonb) END))
          FROM public.exclusive_captures c
         WHERE c.organization_id = _org AND c.captor_id = p.id AND c.status = 'aprovada'
           AND c.archived_at IS NULL AND c.discarded_at IS NULL AND c.signed_on IS NOT NULL), '[]'::jsonb) END,
      'funil90', (SELECT jsonb_build_object('ligacoes', f.lig, 'v1', f.v1, 'v2', f.v2, 'captacoes', f.capt)
                    FROM funil_cap f WHERE f.uid = p.id),
      'funil90_equipe', (SELECT jsonb_build_object('ligacoes', sum(f.lig), 'v1', sum(f.v1), 'v2', sum(f.v2),
                                                   'captacoes', sum(f.capt))
                           FROM funil_cap f
                          WHERE CASE WHEN p.team_id IS NOT NULL THEN
                                  f.uid IN (SELECT tm.membro_id FROM public.team_members tm WHERE tm.team_id = p.team_id)
                                ELSE f.uid IN (SELECT m.user_id FROM public.organization_members m
                                                WHERE m.organization_id = _org AND m.ativo) END),
      'ultima_1a1', (SELECT jsonb_build_object('id', u.id, 'data', u.data, 'proxima_data', u.proxima_data,
                                               'com', u.com, 'combinados', u.combinados)
                       FROM ult u WHERE u.corretor_id = p.id))
      ORDER BY p.nome) FROM pessoas p), '[]'::jsonb)
  ) INTO _res;
  RETURN _res;
END $function$;
REVOKE ALL ON FUNCTION public.gestao_farol_dados(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_farol_dados(integer, uuid) TO authenticated, service_role;

-- 4) "O que fazer hoje" de outra pessoa (pauta da 1:1) --------------------------------------------------------------
-- Corpo de minhas_pendencias() (migration 20261029200000) com o usuário como parâmetro. Uso interno.
CREATE OR REPLACE FUNCTION public.carreira_pendencias_de(_me uuid)
 RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.status, c.manual, c.form_data, c.signed_on,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = public.current_org_id()
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, _me)),
  apr AS (SELECT caps.*, public.exclusive_aprovada_em(caps.id) AS ap, public.exclusive_inicio_plano(caps.id) AS ini
          FROM caps WHERE caps.status = 'aprovada'),
  docs AS (
    SELECT caps.id, array_remove(ARRAY[
      -- Todos os proprietários: 1º com o texto de antes; demais "do Nº proprietário" — t_58effd65.
      (SELECT CASE WHEN count(*) = 0 THEN NULL
                   WHEN count(*) = 1 AND min(g.n) = 1 THEN 'RG e CPF ou CNH do proprietário'
                   WHEN count(*) = 1 THEN 'RG e CPF ou CNH do ' || min(g.n) || 'º proprietário'
                   ELSE 'RG e CPF ou CNH dos proprietários ' || string_agg(g.n::text || 'º', ', ' ORDER BY g.n) END
         FROM generate_series(1, jsonb_array_length(public.exclusive_owner_list(caps.form_data))) g(n)
        WHERE NOT (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'cnh')
          OR (EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'rg')
          AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = g.n AND d.kind = 'cpf')))),
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'matricula')
        THEN 'matrícula' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.capture_id = caps.id AND d.owner_index = 0 AND d.kind = 'iptu')
        THEN 'IPTU' END], NULL) AS falta
      FROM caps WHERE caps.status IN ('rascunho', 'devolvida') AND NOT caps.manual),
  venc AS (
    SELECT apr.*, apr.signed_on + (apr.form_data->'condicoes'->>'prazo_dias_numero')::int AS fim
      FROM apr
     WHERE apr.signed_on IS NOT NULL AND coalesce(apr.form_data->'condicoes'->>'prazo_dias_numero', '') ~ '^[0-9]{1,4}$'
       AND (apr.form_data->'condicoes'->>'prazo_dias_numero')::int > 0)
  SELECT 'devolvida'::text, caps.id, caps.imovel, 'Devolvida pela gestão: corrija e reenvie'::text, NULL::date, NULL::integer
    FROM caps WHERE caps.status = 'devolvida'
  UNION ALL
  SELECT 'documentos', docs.id, caps.imovel, 'Falta anexar: ' || array_to_string(docs.falta, ', '), NULL, NULL
    FROM docs JOIN caps ON caps.id = docs.id WHERE cardinality(docs.falta) > 0
  UNION ALL
  SELECT 'sem_anuncio', apr.id, apr.imovel, 'Aprovada sem anúncio ligado nos portais', NULL, (_hoje - apr.ap)
    FROM apr WHERE apr.ap IS NOT NULL AND _hoje - apr.ap > 7
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links l
                      WHERE l.capture_id = apr.id AND l.status IN ('ativo', 'aguardando_gestor'))
  UNION ALL
  SELECT 'atrasada', apr.id, apr.imovel,
         a.label || CASE WHEN it.sem > 0 THEN ' (Semana ' || it.sem || ')' ELSE '' END, it.prazo, (_hoje - it.prazo)
    FROM apr JOIN public.owner_feedback_actions a
      ON a.organization_id = apr.organization_id AND a.list = 'marketing' AND (apr.form_data->'dossie') ? a.id::text
    CROSS JOIN LATERAL (
      SELECT s.s AS sem,
             CASE WHEN s.s > 0 THEN apr.ini + 7 * s.s - 1 ELSE apr.ini + public.exclusive_plan_prazo_dias(a.weight) END AS prazo
        FROM public.exclusive_plan_semanas(apr.form_data, a.id) s(s)) it
   WHERE apr.ini IS NOT NULL AND it.prazo < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d
                      WHERE d.capture_id = apr.id AND d.action_id = a.id AND d.semana = it.sem)
  UNION ALL
  SELECT 'vencendo', venc.id, venc.imovel,
         CASE WHEN venc.fim < _hoje THEN 'Exclusividade vencida' ELSE 'Exclusividade vence em breve' END,
         venc.fim, (venc.fim - _hoje)
    FROM venc WHERE venc.fim - _hoje BETWEEN -30 AND 30;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_pendencias_de(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_pendencias_de(uuid) TO service_role;

-- Mesma assinatura e mesma saída de antes.
CREATE OR REPLACE FUNCTION public.minhas_pendencias()
 RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT * FROM public.carreira_pendencias_de(auth.uid())
$function$;

-- Pendências do corretor para a pauta da 1:1 (gestor/admin: imobiliária; TL: própria equipe).
CREATE OR REPLACE FUNCTION public.gestao_pendencias_corretor(_corretor uuid)
 RETURNS TABLE(kind text, capture_id uuid, imovel text, detalhe text, prazo date, dias integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.gestao_pode_ver(_corretor) THEN
    RAISE EXCEPTION 'Sem acesso a este corretor' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.carreira_pendencias_de(_corretor);
END $function$;
REVOKE ALL ON FUNCTION public.gestao_pendencias_corretor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestao_pendencias_corretor(uuid) TO authenticated, service_role;

COMMIT;

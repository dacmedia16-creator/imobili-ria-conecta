-- Minha imobiliária (cartão t_f7f1b3e4; maquete v2 aprovada por Denis em 20/11/2026, tópico 6238).
-- ADITIVA: cria 4 funções novas. Não altera tabela, função, policy nem dado existente. Só leitura.
--
-- Quem vê: SÓ o dono (Administrador principal, papel super_admin) e o administrador (admin) DESTA imobiliária, ou o
-- super admin da plataforma ("Entrar como"). O papel tem de ser desta imobiliária (metas_direcao_papel confere
-- user_roles.organization_id). Gestor, Team Leader, corretor e só-Locação: recusado (42501).
--
-- 1) minha_imobiliaria_resumo(): avisos, cartões e sinais do termômetro da EMPRESA TODA (mês corrente, dia de SP):
--    exclusivas vencendo em 15 dias / ativas hoje e 30 dias atrás / novas no mês (pela DATA DE APROVAÇÃO);
--    leads sem atendimento há +24h e % aceitos no prazo de aceite da imobiliária (lead_config.prazo_aceite_min);
--    vendas paradas há +5 dias (sem mudança de etapa); aluguéis em atraso; corretores produtivos (90 dias, inclui o
--    admin que vende); corretores novos (< 60 dias na imobiliária) sem venda. Módulo desligado = bloco null.
-- 2) minha_imobiliaria_atividades(_ano): V1 e V2 do mês (carreira_diario) de cada pessoa da imobiliária, o recorte
--    do plano que a conta de V1/V2 usa (funil + somas das despesas; despesas nunca saem item a item) e os
--    administradores ativos com a equipe vigente (para o "admin que vende").
-- Rollback: supabase/rollback/20261210120000_minha_imobiliaria.sql
BEGIN;

-- Recusa quem não é dono/admin desta imobiliária e devolve a imobiliária atual. Uso interno.
CREATE OR REPLACE FUNCTION public.minha_imobiliaria_org()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF NOT public.metas_direcao_papel(ARRAY['admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só o dono e o administrador da imobiliária veem Minha imobiliária' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $function$;
REVOKE ALL ON FUNCTION public.minha_imobiliaria_org() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minha_imobiliaria_org() TO service_role;

-- Recorte do plano que a conta de V1/V2 usa (espelho de respostasDoFunil em src/lib/minha-imobiliaria/metas-mes.ts):
-- funil, ticket, %, conversão, faixa e alíquota + só as SOMAS das despesas (op.0, on.0, so.0.v). Uso interno.
CREATE OR REPLACE FUNCTION public.minha_imobiliaria_respostas_funil(_r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  WITH r AS (SELECT CASE WHEN jsonb_typeof(_r) = 'object' THEN _r ELSE '{}'::jsonb END AS j),
  soma AS (SELECT x.k, (SELECT sum(public.metas_num(e.value)) FROM r, jsonb_each(r.j) e WHERE e.key ~ x.re) AS v
             FROM (VALUES ('op.0', '^op\.[0-7]$'), ('on.0', '^on\.[0-5]$'), ('so.0.v', '^so\.[0-2]\.v$')) x(k, re)),
  saida AS (
    SELECT e.key AS k, e.value AS v FROM r, jsonb_each(r.j) e
     WHERE e.key ~ '^(m\.(faixa|conv|ticket|pct)|d\.(conv|ticket)|es\.aliq|fu\.(v2cre|v1v2|folga))$'
    UNION ALL
    SELECT soma.k, to_jsonb(soma.v) FROM soma WHERE soma.v IS NOT NULL)
  SELECT coalesce(jsonb_object_agg(saida.k, saida.v), '{}'::jsonb) FROM saida
$function$;
REVOKE ALL ON FUNCTION public.minha_imobiliaria_respostas_funil(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minha_imobiliaria_respostas_funil(jsonb) TO service_role;

-- 1) Resumo da empresa (avisos, cartões e termômetro) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.minha_imobiliaria_resumo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _org uuid := public.minha_imobiliaria_org();   -- recusa quem não pode ANTES de ler qualquer coisa
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _ini date; _ant_ini date; _ant_fim date; _caps boolean; _leads boolean; _loc boolean; _prazo integer;
  _exc jsonb; _ld jsonb; _vp jsonb; _alu jsonb; _prod jsonb; _novos integer;
BEGIN
  _ini := date_trunc('month', _hoje)::date;
  _ant_ini := (_ini - interval '1 month')::date;
  _ant_fim := least(_ant_ini + (_hoje - _ini), _ini - 1);   -- mesmo período do mês anterior (dia 1 até o dia de hoje)
  SELECT coalesce(bool_or(om.module = 'captacao_exclusiva' AND om.enabled), false),
         coalesce(bool_or(om.module = 'leads' AND om.enabled), false),
         coalesce(bool_or(om.module = 'locacao' AND om.enabled), false)
    INTO _caps, _leads, _loc
    FROM public.organization_modules om WHERE om.organization_id = _org;
  _prazo := coalesce((SELECT lc.prazo_aceite_min FROM public.lead_config lc WHERE lc.organization_id = _org), 30);

  -- Exclusivas (captação conta pela DATA DE APROVAÇÃO; vencimento = data de assinatura + prazo em dias).
  IF _caps THEN
    WITH c AS (
      SELECT x.id, (x.archived_at AT TIME ZONE 'America/Sao_Paulo')::date AS arq, public.exclusive_aprovada_em(x.id) AS ap,
             CASE WHEN x.signed_on IS NOT NULL
                       AND coalesce(x.form_data -> 'condicoes' ->> 'prazo_dias_numero', '') ~ '^[0-9]{1,4}$'
                       AND (x.form_data -> 'condicoes' ->> 'prazo_dias_numero')::int > 0
                  THEN x.signed_on + (x.form_data -> 'condicoes' ->> 'prazo_dias_numero')::int END AS vence,
             coalesce(nullif(btrim(x.form_data -> 'imovel' ->> 'endereco'), ''),
                      nullif(btrim(x.form_data -> 'imovel' ->> 'bairro'), '')) AS imovel
        FROM public.exclusive_captures x
       WHERE x.organization_id = _org AND x.status = 'aprovada' AND x.discarded_at IS NULL),
    venc AS (SELECT c.* FROM c WHERE c.arq IS NULL AND c.vence BETWEEN _hoje AND _hoje + 15)
    SELECT jsonb_build_object(
      'ativas', (SELECT count(*) FROM c WHERE c.arq IS NULL),
      -- shortcut: "ativas 30 dias atrás" reconstrói pelas datas (aprovação e arquivamento); descarte não tem histórico.
      'ativas_30d', (SELECT count(*) FROM c WHERE c.ap <= _hoje - 30 AND (c.arq IS NULL OR c.arq > _hoje - 30)),
      'novas_mes', (SELECT count(*) FROM c WHERE c.ap BETWEEN _ini AND _hoje),
      'novas_ant', (SELECT count(*) FROM c WHERE c.ap BETWEEN _ant_ini AND _ant_fim),
      'vencendo', (SELECT count(*) FROM venc),
      'vencendo_primeira_dias', (SELECT min(venc.vence) - _hoje FROM venc),
      'vencendo_primeira_imovel', (SELECT venc.imovel FROM venc ORDER BY venc.vence, venc.id LIMIT 1))
      INTO _exc;
  END IF;

  -- Leads (simulados fora). No prazo = aceito até "última atribuição (ou criação) + prazo de aceite da imobiliária".
  -- Entram no % só os leads já aceitos ou com o prazo vencido (quem ainda está dentro do prazo não pesa).
  IF _leads THEN
    WITH l AS (
      SELECT x.origem, x.aceito_em, x.etapa, coalesce(x.atribuido_em, x.created_at) AS desde,
             (x.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
             coalesce(x.atribuido_em, x.created_at) + make_interval(mins => _prazo) AS limite
        FROM public.leads x
       WHERE x.organization_id = _org AND NOT coalesce(x.simulado, false)
         AND (x.created_at >= (_ant_ini::timestamp AT TIME ZONE 'America/Sao_Paulo')
              OR (x.aceito_em IS NULL AND x.etapa NOT IN ('ganho', 'perdido')))),
    espera AS (SELECT l.* FROM l WHERE l.aceito_em IS NULL AND l.etapa NOT IN ('ganho', 'perdido')
                                   AND l.desde < now() - interval '24 hours')
    SELECT jsonb_build_object(
      'prazo_aceite_min', _prazo,
      'sem_atendimento', (SELECT count(*) FROM espera),
      'mais_antigo_horas', (SELECT floor(extract(epoch FROM now() - min(espera.desde)) / 3600)::integer FROM espera),
      'mais_antigo_origem', (SELECT espera.origem FROM espera ORDER BY espera.desde LIMIT 1),
      'recebidos_mes', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ini AND _hoje),
      'recebidos_ant', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ant_ini AND _ant_fim),
      'elegiveis_mes', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ini AND _hoje
                          AND (l.aceito_em IS NOT NULL OR l.limite <= now())),
      'no_prazo_mes', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ini AND _hoje AND l.aceito_em <= l.limite),
      'elegiveis_ant', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ant_ini AND _ant_fim
                          AND (l.aceito_em IS NOT NULL OR l.limite <= now())),
      'no_prazo_ant', (SELECT count(*) FROM l WHERE l.dia BETWEEN _ant_ini AND _ant_fim AND l.aceito_em <= l.limite))
      INTO _ld;
  END IF;

  -- Vendas paradas: em andamento e sem mudança de etapa há mais de 5 dias (mesma régua de "tempo parado").
  WITH v AS (
    SELECT s.id, s.status::text AS status,
           _hoje - (coalesce((SELECT max(h.created_at) FROM public.sale_status_history h WHERE h.sale_id = s.id),
                             s.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dias
      FROM public.sales s
     WHERE s.organization_id = _org
       AND s.status NOT IN ('rascunho', 'cancelada', 'arquivada', 'ocorrencia_concluida')),
  p AS (SELECT v.* FROM v WHERE v.dias > 5)
  SELECT jsonb_build_object(
    'qtd', (SELECT count(*) FROM p),
    'maior_dias', (SELECT max(p.dias) FROM p),
    'maior_status', (SELECT p.status FROM p ORDER BY p.dias DESC, p.id LIMIT 1))
    INTO _vp;

  -- Aluguéis em atraso (módulo Locação).
  IF _loc THEN
    SELECT jsonb_build_object('qtd', count(*), 'valor', coalesce(round(sum(c.valor), 2), 0),
                              'maior_dias', max(_hoje - c.vencimento))
      INTO _alu
      FROM public.locacao_cobrancas c
     WHERE c.organization_id = _org AND c.status = 'aberta' AND c.vencimento < _hoje;
  END IF;

  -- Corretores produtivos: corretores ativos + administradores que venderam (decisão de Denis); produtivo = foi
  -- captador ou vendedor de venda válida (assinatura, dia de SP) nos últimos 90 dias. "Antes" = mesma conta 30 dias atrás.
  WITH canon AS (
    SELECT v.data_fechamento AS dia, s.corretor_captador_id AS capt, s.corretor_vendedor_id AS vend
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _hoje - 119 AND _hoje),
  pontas AS (SELECT canon.dia, canon.capt AS uid FROM canon WHERE canon.capt IS NOT NULL
             UNION ALL SELECT canon.dia, canon.vend FROM canon WHERE canon.vend IS NOT NULL),
  membros AS (
    SELECT m.user_id, m.created_at,
           EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.organization_id = _org
                     AND r.role = 'corretor') AS corretor,
           EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.organization_id = _org
                     AND r.role IN ('admin', 'super_admin')) AS admin
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo),
  jan AS (
    SELECT j.k, j.de, j.ate FROM (VALUES ('hoje', _hoje - 89, _hoje), ('ant', _hoje - 119, _hoje - 30)) j(k, de, ate)),
  conta AS (
    SELECT jan.k,
           count(*) FILTER (WHERE mb.corretor OR (mb.admin AND x.vendeu)) AS ativos,
           count(*) FILTER (WHERE (mb.corretor OR mb.admin) AND x.vendeu) AS produtivos,
           count(*) FILTER (WHERE mb.admin AND NOT mb.corretor AND x.vendeu) AS admins
      FROM jan CROSS JOIN membros mb
      CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM pontas pt WHERE pt.uid = mb.user_id
                                            AND pt.dia BETWEEN jan.de AND jan.ate) AS vendeu) x
     GROUP BY jan.k)
  SELECT jsonb_build_object(
    'ativos', (SELECT conta.ativos FROM conta WHERE conta.k = 'hoje'),
    'produtivos', (SELECT conta.produtivos FROM conta WHERE conta.k = 'hoje'),
    'admins_que_venderam', (SELECT conta.admins FROM conta WHERE conta.k = 'hoje'),
    -- shortcut: o "antes" usa quem está ativo HOJE (não há histórico de quem estava ativo 30 dias atrás).
    'ativos_ant', (SELECT conta.ativos FROM conta WHERE conta.k = 'ant'),
    'produtivos_ant', (SELECT conta.produtivos FROM conta WHERE conta.k = 'ant')),
    (SELECT count(*) FROM membros mb
      WHERE mb.corretor AND mb.created_at >= now() - interval '60 days'
        AND NOT EXISTS (SELECT 1 FROM pontas pt WHERE pt.uid = mb.user_id))::integer
    INTO _prod, _novos;

  RETURN jsonb_build_object(
    'hoje', _hoje, 'mes_inicio', _ini, 'ant_inicio', _ant_ini, 'ant_fim', _ant_fim,
    'modulos', jsonb_build_object('captacao', _caps, 'leads', _leads, 'locacao', _loc),
    'exclusivas', _exc, 'leads', _ld, 'vendas_paradas', _vp, 'alugueis', _alu,
    'produtivos', _prod, 'novos_sem_venda', coalesce(_novos, 0));
END $function$;
REVOKE ALL ON FUNCTION public.minha_imobiliaria_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_imobiliaria_resumo() TO authenticated, service_role;

-- 2) V1/V2 do mês por pessoa + recorte do plano + administradores ---------------------------------------------
CREATE OR REPLACE FUNCTION public.minha_imobiliaria_atividades(_ano integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _org uuid := public.minha_imobiliaria_org();   -- recusa quem não pode ANTES de ler qualquer coisa
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _ini date; _modulo boolean; _out jsonb;
BEGIN
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  _ini := date_trunc('month', _hoje)::date;
  _modulo := public.meu_plano_modulo_ligado(_org);
  WITH ativos AS (
    SELECT m.user_id FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo)
  SELECT jsonb_build_object(
    'inicio', _ini, 'fim', _hoje,
    'atividades', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'v1', a.v1, 'v2', a.v2) ORDER BY a.user_id)
        FROM (SELECT d.user_id,
                     coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v1'), 0)::integer AS v1,
                     coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'v2'), 0)::integer AS v2
                FROM public.carreira_diario d
               WHERE d.organization_id = _org AND d.dia BETWEEN _ini AND _hoje AND d.tipo IN ('v1', 'v2')
               GROUP BY d.user_id) a), '[]'::jsonb),
    'funil', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', cp.user_id,
                                          'respostas', public.minha_imobiliaria_respostas_funil(cp.respostas))
                       ORDER BY cp.user_id)
        FROM public.carreira_plano cp
       WHERE _modulo AND cp.organization_id = _org AND cp.ano = _ano
         AND cp.user_id IN (SELECT ativos.user_id FROM ativos)), '[]'::jsonb),
    'admins', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', a.user_id, 'nome', pr.nome,
               'team_id', (SELECT t.id FROM public.teams t
                            WHERE t.id = public.equipe_vigente(a.user_id, now()) AND t.organization_id = _org),
               'papeis', (SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                           WHERE ur.user_id = a.user_id AND ur.organization_id = _org))
             ORDER BY pr.nome)
        FROM ativos a JOIN public.profiles pr ON pr.id = a.user_id
       WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = a.user_id AND r.organization_id = _org
                       AND r.role IN ('admin', 'super_admin'))), '[]'::jsonb))
    INTO _out;
  RETURN _out;
END $function$;
REVOKE ALL ON FUNCTION public.minha_imobiliaria_atividades(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_imobiliaria_atividades(integer) TO authenticated, service_role;

COMMIT;

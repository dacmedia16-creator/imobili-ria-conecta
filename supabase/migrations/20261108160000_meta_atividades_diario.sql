-- Meta x atividades (cartão t_09c29e96, decisões de Denis em 08/11/2026): liga o Meu Plano 2027 ao Diário.
-- ADITIVA. Nenhum registro existente do diário é apagado, convertido ou alterado.
-- 1) carreira_diario.tipo passa a aceitar v1 (1ª visita ao proprietário), v2 (2ª visita: Plano de Marketing e
--    Venda + ACM) e visita_comprador (só contagem). 'visita' continua válido para LER o histórico antigo.
-- 2) carreira_diario_validar(): onde o Meu Plano 2027 está ligado (hoje só nas contas de teste), novo registro
--    'visita' é recusado; nas outras imobiliárias o diário segue igual (e os tipos novos são recusados lá).
--    ANTES de ligar o módulo numa imobiliária real, o front novo precisa estar publicado (aparelho com o app
--    antigo em cache mandaria 'visita' e receberia erro).
-- 3) meu_diario_contagens(): mesma assinatura; devolve também v1, v2, visita_comprador, 'visita' (antiga) e
--    'captacao' (captações exclusivas aprovadas do corretor, pela data de assinatura do contrato). O front
--    antigo ignora os tipos que não conhece.
-- 4) carreira_diario_equipe_semana(_ano): NOVA. Feito na semana/mês x metas do plano de cada corretor, para a
--    conversa 1:1. Gestor/admin: a imobiliária; team leader: só a(s) própria(s) equipe(s). Exige o módulo
--    meu_plano_2027 ligado. TL recebe só a cópia das metas (campos "ms.*" do plano), nunca as respostas.
-- Sem pontos e fora do ranking (decisão de 16/10). carreira_diario_equipe(date, date) NÃO muda.
-- Rollback: supabase/rollback/20261108160000_meta_atividades_diario.sql
BEGIN;

-- 1) Tipos -----------------------------------------------------------------------------------------------
ALTER TABLE public.carreira_diario DROP CONSTRAINT carreira_diario_tipo_check;
ALTER TABLE public.carreira_diario ADD CONSTRAINT carreira_diario_tipo_check
  CHECK (tipo IN ('ligacao', 'visita', 'acm', 'v1', 'v2', 'visita_comprador'));

-- 2) Validação no INSERT (UPDATE não existe para authenticated) -------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_diario_validar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_active_user(auth.uid()), false) THEN
    RAISE EXCEPTION 'Usuário inativo' USING ERRCODE = '42501';
  END IF;
  IF NEW.dia > _hoje OR NEW.dia < _hoje - 31 THEN
    RAISE EXCEPTION 'Registre atividades de hoje até 31 dias atrás.' USING ERRCODE = '22023';
  END IF;
  -- Decisão de Denis (08/11): "Visita" deu lugar a V1, V2 e Visita com comprador — só onde o Meu Plano 2027
  -- está ligado. Nas outras imobiliárias o diário segue com ligação/visita/ACM (o gestor lá usa
  -- carreira_diario_equipe, que não conhece os tipos novos).
  IF public.meu_plano_modulo_ligado(NEW.organization_id) THEN
    IF NEW.tipo = 'visita' THEN
      RAISE EXCEPTION 'Registre como V1, V2 ou Visita com comprador.' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.tipo IN ('v1', 'v2', 'visita_comprador') THEN
    RAISE EXCEPTION 'Registre como Ligação, Visita ou ACM.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.carreira_diario_validar() FROM PUBLIC, anon, authenticated;

-- 3) Contagens do próprio corretor (mesma assinatura) --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_diario_contagens()
RETURNS TABLE(tipo text, hoje integer, semana integer, mes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  _mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH diario AS (
    SELECT t.tipo AS k, t.ordem,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia = _d), 0)::integer AS h,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg), 0)::integer AS s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes), 0)::integer AS m
      FROM (VALUES ('ligacao', 1), ('v1', 2), ('v2', 3), ('acm', 4), ('visita_comprador', 5), ('visita', 6))
           AS t(tipo, ordem)
      LEFT JOIN public.carreira_diario d
        ON d.tipo = t.tipo AND d.organization_id = _org AND d.user_id = _me
       AND d.dia >= least(_seg, _mes) AND d.dia <= _d
     GROUP BY t.tipo, t.ordem),
  cap AS (
    -- Captações exclusivas aprovadas do corretor (quem captou, mesmo se transferida depois), contadas pela
    -- data em que o contrato foi ASSINADO (regra de Denis: "assinadas no mês"); sem data, a da aprovação.
    -- Atenção: meu_realizado() conta pela data de aprovação, então os números podem diferir na virada do mês.
    SELECT coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) AS dia
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND coalesce(c.captador_original_id, c.captor_id) = _me
       AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND (c.signed_on IS NULL OR c.signed_on BETWEEN least(_seg, _mes) AND _d))
  SELECT x.k, x.h, x.s, x.m FROM (
    SELECT k, ordem, h, s, m FROM diario
    UNION ALL
    SELECT 'captacao', 7,
           (count(*) FILTER (WHERE cap.dia = _d))::integer,
           (count(*) FILTER (WHERE cap.dia BETWEEN _seg AND _d))::integer,
           (count(*) FILTER (WHERE cap.dia BETWEEN _mes AND _d))::integer
      FROM cap) x
   ORDER BY x.ordem;
END $function$;
REVOKE ALL ON FUNCTION public.meu_diario_contagens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_diario_contagens() TO authenticated, service_role;

-- 4) Equipe: feito x meta da semana (1:1, sem ranking) --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_diario_equipe_semana(_ano integer)
RETURNS TABLE(user_id uuid, nome text,
              lig_sem integer, v1_sem integer, v2_sem integer, acm_sem integer, comprador_sem integer,
              lig_mes integer, v1_mes integer, v2_mes integer, acm_mes integer, comprador_mes integer,
              antigas_mes integer, capt_mes integer, metas jsonb, respostas jsonb, ultimo_dia date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid; _broker boolean;
  _d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  _mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
BEGIN
  _org := public.meu_plano_org_ok();  -- login, usuário ativo, imobiliária ativa e módulo ligado
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN
    RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023';
  END IF;
  _broker := public.meu_plano_eh_broker(_me);
  IF NOT _broker AND NOT EXISTS (SELECT 1 FROM public.teams t
                                  WHERE t.organization_id = _org AND public.leads_team_or_parent(t.id, _me)) THEN
    RAISE EXCEPTION 'Apenas gestor, administrador ou líder de equipe vê o diário da equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pessoas AS (
    SELECT pr.id, pr.nome
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo AND pr.id <> _me
       AND CASE WHEN _broker THEN EXISTS (
                  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader'))
                ELSE EXISTS (
                  SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
                   WHERE tm.membro_id = pr.id AND t.organization_id = _org
                     AND public.leads_team_or_parent(t.id, _me)) END),
  dia AS (
    SELECT d.user_id AS uid,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'ligacao'), 0)::integer AS lig_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'v1'), 0)::integer AS v1_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'v2'), 0)::integer AS v2_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'acm'), 0)::integer AS acm_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg AND d.tipo = 'visita_comprador'), 0)::integer AS comp_s,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'ligacao'), 0)::integer AS lig_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'v1'), 0)::integer AS v1_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'v2'), 0)::integer AS v2_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'acm'), 0)::integer AS acm_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'visita_comprador'), 0)::integer AS comp_m,
           coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes AND d.tipo = 'visita'), 0)::integer AS ant_m,
           max(d.dia) AS ult
      FROM public.carreira_diario d
     WHERE d.organization_id = _org AND d.user_id IN (SELECT id FROM pessoas)
       AND d.dia >= least(_seg, _mes) AND d.dia <= _d
     GROUP BY d.user_id),
  cap AS (
    SELECT coalesce(c.captador_original_id, c.captor_id) AS uid, count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND coalesce(c.captador_original_id, c.captor_id) IN (SELECT id FROM pessoas)
       AND (c.signed_on IS NULL OR c.signed_on BETWEEN _mes AND _d)
       AND coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) BETWEEN _mes AND _d
     GROUP BY 1)
  SELECT p.id, p.nome,
         coalesce(x.lig_s, 0), coalesce(x.v1_s, 0), coalesce(x.v2_s, 0), coalesce(x.acm_s, 0), coalesce(x.comp_s, 0),
         coalesce(x.lig_m, 0), coalesce(x.v1_m, 0), coalesce(x.v2_m, 0), coalesce(x.acm_m, 0), coalesce(x.comp_m, 0),
         coalesce(x.ant_m, 0), coalesce(c.n, 0),
         (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(cp.respostas) e WHERE e.key LIKE 'ms.%'),
         CASE WHEN _broker THEN cp.respostas END,
         x.ult
    FROM pessoas p
    LEFT JOIN dia x ON x.uid = p.id
    LEFT JOIN cap c ON c.uid = p.id
    LEFT JOIN public.carreira_plano cp ON cp.organization_id = _org AND cp.user_id = p.id AND cp.ano = _ano
   ORDER BY p.nome;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_diario_equipe_semana(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_diario_equipe_semana(integer) TO authenticated, service_role;

COMMIT;

-- Minha carreira, PR 3 (card t_b848f957; "pode executar" de Denis em 15/10/2026): bloco "Conquistas".
-- 1) Módulo "ranking_valores" (organization_modules): "mostrar valores dos colegas no ranking".
--    Ligado só na Única Escolha (slug unica-escolha); desligado nas demais. Liga/desliga pelo mesmo
--    caminho dos outros módulos (super-admin da plataforma, com histórico).
-- 2) carreira_ranking(_inicio, _fim): SÓ LEITURA. Ranking da imobiliária ATIVA (current_org_id) para
--    usuário logado e ATIVO (auth.uid() + is_active_user). Anon não executa.
--    Mesma regra dos relatórios e do meu_realizado (vendas_comerciais_canonicas /
--    participacoes_comerciais_validas, data de fechamento = mês da assinatura em SP):
--      captacoes = vendas válidas em que a pessoa é corretor captador;   vendas = como corretor vendedor;
--      pontos    = captacoes + vendas (captação +1, venda +1, igual ao Mural);
--      vgv       = VGV próprio das vendas em que a pessoa tem comissão; comissao = comissão individual.
--    Com o módulo DESLIGADO o banco devolve vgv/comissao = NULL para os colegas (o próprio corretor
--    continua vendo os seus). Nunca devolve cliente, imóvel, parcela nem venda individual.
-- Não altera vendas, captações, metas nem relatórios.
BEGIN;

-- 1) Módulo ------------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores')
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

-- Ligado por padrão só na Única Escolha (decisão de Denis, 15/10).
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'ranking_valores', o.slug = 'unica-escolha' FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Ranking -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_ranking(_inicio date, _fim date)
RETURNS TABLE(posicao integer, user_id uuid, nome text, avatar_url text, captacoes integer, vendas integer,
              pontos integer, vgv numeric, comissao numeric, eu boolean, valores_visiveis boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _ver boolean;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  _ver := coalesce((SELECT om.enabled FROM public.organization_modules om
                     WHERE om.organization_id = _org AND om.module = 'ranking_valores'), false);
  RETURN QUERY
  WITH canon AS (
    SELECT v.sale_id, v.vgv_proprio, s.corretor_captador_id AS capt_id, s.corretor_vendedor_id AS vend_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  part AS (
    SELECT p.user_id AS uid, p.sale_id, sum(p.valor_individual) AS valor
      FROM public.participacoes_comerciais_validas() p
      JOIN canon c ON c.sale_id = p.sale_id
     GROUP BY p.user_id, p.sale_id),
  pessoas AS (
    SELECT c.capt_id AS uid FROM canon c WHERE c.capt_id IS NOT NULL
    UNION SELECT c.vend_id FROM canon c WHERE c.vend_id IS NOT NULL
    UNION SELECT pt.uid FROM part pt),
  tot AS (
    SELECT x.uid,
      (SELECT count(*) FROM canon c WHERE c.capt_id = x.uid)::integer AS n_capt,
      (SELECT count(*) FROM canon c WHERE c.vend_id = x.uid)::integer AS n_vend,
      coalesce((SELECT sum(c.vgv_proprio) FROM canon c JOIN part pt ON pt.sale_id = c.sale_id AND pt.uid = x.uid), 0)::numeric AS t_vgv,
      coalesce((SELECT sum(pt.valor) FROM part pt WHERE pt.uid = x.uid), 0)::numeric AS t_com
      FROM pessoas x)
  SELECT (rank() OVER (ORDER BY t.n_capt + t.n_vend DESC))::integer,
         t.uid, pr.nome, pr.avatar_url, t.n_capt, t.n_vend, (t.n_capt + t.n_vend)::integer,
         CASE WHEN _ver OR t.uid = _me THEN t.t_vgv END,
         CASE WHEN _ver OR t.uid = _me THEN t.t_com END,
         t.uid = _me, _ver
    FROM tot t
    JOIN public.profiles pr ON pr.id = t.uid
   ORDER BY t.n_capt + t.n_vend DESC, pr.nome
   LIMIT 100;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_ranking(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_ranking(date, date) TO authenticated, service_role;

-- 3) Destaques do Mural do próprio corretor ---------------------------------------------------
-- Reaproveita achievement_posts (Mural de Conquistas): só posts ativos da organização ativa em que o
-- usuário logado é captador, vendedor ou coordenador. Com o Mural desligado devolve vazio.
CREATE OR REPLACE FUNCTION public.carreira_meus_destaques(_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, venda_em timestamptz, papel text, captador_nome text, vendedor_nome text,
              tipo_imovel text, bairro text, cidade text, cheers bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT p.id, p.venda_em,
         CASE WHEN p.captador_id = auth.uid() AND p.vendedor_id = auth.uid() THEN 'captou e vendeu'
              WHEN p.captador_id = auth.uid() THEN 'captação'
              WHEN p.vendedor_id = auth.uid() THEN 'venda'
              ELSE 'coordenação' END,
         p.captador_nome, p.vendedor_nome, p.tipo_imovel, p.bairro, p.cidade,
         (SELECT count(*) FROM public.achievement_cheers c WHERE c.post_id = p.id)
    FROM public.achievement_posts p
   WHERE auth.uid() IS NOT NULL AND coalesce(public.is_active_user(auth.uid()), false)
     AND public.achievements_enabled() AND p.organization_id = public.current_org_id() AND p.ativo
     AND auth.uid() IN (p.captador_id, p.vendedor_id, p.coordenador_id)
   ORDER BY p.venda_em DESC, p.created_at DESC
   LIMIT least(greatest(coalesce(_limit, 5), 1), 20)
$function$;
REVOKE ALL ON FUNCTION public.carreira_meus_destaques(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_meus_destaques(integer) TO authenticated, service_role;

-- 4) Clube RE/MAX (pedido de Denis em 16/10) --------------------------------------------------
-- Faixas de VGC anual por ano do clube, por imobiliária; editáveis só por admin/gestor (não ficam no
-- código). "ano" = ano do clube; o VGC que qualifica é o do ano civil ANTERIOR.
-- VGC do corretor = soma da comissão individual dele nas vendas válidas do ano (mesma regra do
-- meu_realizado: participacoes_comerciais_validas, mês da assinatura em SP), só na organização ativa.
CREATE TABLE IF NOT EXISTS public.clube_remax_faixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  ano integer NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 50),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  vgc_minimo numeric(16,2) NOT NULL CHECK (vgc_minimo >= 0),
  origem text CHECK (origem IS NULL OR length(origem) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clube_remax_faixas_ordem_unica UNIQUE (organization_id, ano, ordem),
  CONSTRAINT clube_remax_faixas_nome_unico UNIQUE (organization_id, ano, nome)
);
CREATE TRIGGER trg_clube_remax_faixas_updated BEFORE UPDATE ON public.clube_remax_faixas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.clube_remax_faixas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clube_remax_faixas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clube_remax_faixas TO authenticated;
GRANT ALL ON public.clube_remax_faixas TO service_role;
CREATE POLICY org_isolation ON public.clube_remax_faixas AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY clube_remax_faixas_ler ON public.clube_remax_faixas FOR SELECT TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))));
CREATE POLICY clube_remax_faixas_gestao ON public.clube_remax_faixas FOR ALL TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin', 'super_admin', 'gestor']::public.app_role[])))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid())))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin', 'super_admin', 'gestor']::public.app_role[])));

-- Carga inicial: tabela 2025 (post de 27/02/2025, @grasygoncalvescorretora), em todas as imobiliárias.
-- Denis (16/10, "faz com essa"): usar a de 2025 como oficial por enquanto; trocar quando sair a nova.
INSERT INTO public.clube_remax_faixas (organization_id, ano, ordem, nome, vgc_minimo, origem)
SELECT o.id, 2025, f.ordem, f.nome, f.minimo, 'Tabela de referência 2025'
  FROM public.organizations o
 CROSS JOIN (VALUES (1, 'Executive', 132696), (2, '100%', 265393), (3, 'Platinum', 663482),
                    (4, 'Chairman''s', 1326964), (5, 'Titan', 1990446), (6, 'Diamond', 2653928),
                    (7, 'Pinnacle', 5307856)) AS f(ordem, nome, minimo)
ON CONFLICT DO NOTHING;

-- Clube do usuário logado. Usa a tabela do ano pedido; se não houver, a mais recente anterior
-- (e devolve o ano da tabela usada + a origem, para a tela avisar).
CREATE OR REPLACE FUNCTION public.carreira_clube(_ano integer DEFAULT NULL)
RETURNS TABLE(ano integer, vgc_ano_anterior numeric, clube_atual text, tabela_atual integer,
              vgc_ano_corrente numeric, clube_buscando text, proximo_clube text, falta_proximo numeric,
              tabela_buscando integer, origem text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _a integer := coalesce(_ano, extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  _vgc_ant numeric; _vgc_cor numeric; _t_at integer; _t_bu integer;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _a < 2000 OR _a > 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(p.valor_individual) FILTER (WHERE extract(year FROM v.data_fechamento) = _a - 1), 0),
         coalesce(sum(p.valor_individual) FILTER (WHERE extract(year FROM v.data_fechamento) = _a), 0)
    INTO _vgc_ant, _vgc_cor
    FROM public.participacoes_comerciais_validas() p
    JOIN public.vendas_comerciais_canonicas() v ON v.sale_id = p.sale_id
    JOIN public.sales s ON s.id = p.sale_id
   WHERE p.user_id = _me AND s.organization_id = _org
     AND v.data_fechamento >= make_date(_a - 1, 1, 1) AND v.data_fechamento <= make_date(_a, 12, 31);
  SELECT max(f.ano) INTO _t_at FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano <= _a;
  SELECT max(f.ano) INTO _t_bu FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano <= _a + 1;
  RETURN QUERY SELECT _a, _vgc_ant,
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_at
        AND f.vgc_minimo <= _vgc_ant ORDER BY f.vgc_minimo DESC LIMIT 1),
    _t_at, _vgc_cor,
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo <= _vgc_cor ORDER BY f.vgc_minimo DESC LIMIT 1),
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo > _vgc_cor ORDER BY f.vgc_minimo LIMIT 1),
    (SELECT f.vgc_minimo - _vgc_cor FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo > _vgc_cor ORDER BY f.vgc_minimo LIMIT 1),
    _t_bu,
    (SELECT f.origem FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        ORDER BY f.ordem LIMIT 1);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_clube(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_clube(integer) TO authenticated, service_role;

COMMIT;

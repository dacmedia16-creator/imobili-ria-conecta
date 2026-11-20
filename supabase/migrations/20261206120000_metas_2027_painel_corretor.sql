-- Painéis de metas 2027 — ETAPA 2 (cartão t_2fa76ce2, Denis 19/11/2026, tópico 6238): painel do corretor.
-- ADITIVA: cria 1 tabela e 3 funções novas. Não altera tabela, função, policy nem dado existente.
--
-- 1) carreira_anotacoes: anotação livre do corretor (texto, próximo passo e data do próximo passo). Não mexe
--    na meta. O DONO lê, grava, edita e apaga as próprias. Gestor/Team Leader da EQUIPE do corretor e
--    admin da imobiliária só LEEM (regra de painel_equipe_permitido: admin vê todas; gestor/TL só a equipe
--    que lidera ou co-lidera). Isolamento por imobiliária e usuário ativo são RESTRITIVOS. Anon sem acesso.
-- 2) minha_comissao_vendas(_inicio, _fim): vendas do PRÓPRIO corretor no período (assinatura, dia de SP),
--    com a parte dele e o que foi descontado DELE (indicador e extras), montado sobre
--    calcular_distribuicao_venda. NUNCA devolve a comissão bruta da venda nem a parte da imobiliária.
--    Mesma base de meu_realizado/minhas_comissoes (vendas_comerciais_canonicas +
--    participacoes_comerciais_validas), então a soma bate com o realizado.
-- Rollback: supabase/rollback/20261206120000_metas_2027_painel_corretor.sql
BEGIN;

-- 1) Anotações ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carreira_anotacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  proximo_passo text CHECK (proximo_passo IS NULL OR length(proximo_passo) <= 300),
  proximo_passo_em date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carreira_anotacoes_org_user ON public.carreira_anotacoes (organization_id, user_id, created_at DESC);

-- Quem pode LER a anotação de outra pessoa: admin da imobiliária ou gestor/TL da equipe vigente do dono.
CREATE OR REPLACE FUNCTION public.carreira_anotacoes_pode_ler(_dono uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _team uuid;
BEGIN
  IF _me IS NULL OR _dono IS NULL OR _org IS NULL THEN RETURN false; END IF;
  -- Super admin da plataforma: mesma regra de painel_equipe_permitido.
  IF coalesce(public.has_any_role(_me, ARRAY['super_admin']::public.app_role[]), false) THEN RETURN true; END IF;
  -- Admin: o papel tem de ser DESTA imobiliária (quem é admin em outra não lê as anotações daqui).
  IF coalesce(public.has_any_role(_me, ARRAY['admin']::public.app_role[]), false)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _me AND r.organization_id = _org
                   AND r.role = 'admin') THEN
    RETURN true;
  END IF;
  -- Gestor/TL: papel gestor/team_leader NESTA imobiliária E líder/co-líder da equipe vigente do dono.
  -- (Não usa o ramo "admin" de painel_equipe_permitido, que não confere a imobiliária do papel.)
  _team := public.equipe_vigente(_dono, now());
  RETURN _team IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _me AND r.organization_id = _org
                  AND r.role IN ('gestor', 'team_leader'))
    AND coalesce(public.painel_equipe_permitido(_team), false)
    AND coalesce(public.leads_team_or_parent(_team, _me), false);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_anotacoes_pode_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_anotacoes_pode_ler(uuid) TO authenticated, service_role;

-- Datas sempre do servidor (não dá para antedatar) e, na edição, não troca dono, imobiliária nem criação.
CREATE OR REPLACE FUNCTION public.carreira_anotacoes_editar()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Não é possível mudar o dono da anotação' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.carreira_anotacoes_editar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_carreira_anotacoes_editar ON public.carreira_anotacoes;
CREATE TRIGGER trg_carreira_anotacoes_editar BEFORE INSERT OR UPDATE ON public.carreira_anotacoes
  FOR EACH ROW EXECUTE FUNCTION public.carreira_anotacoes_editar();

ALTER TABLE public.carreira_anotacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carreira_anotacoes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carreira_anotacoes TO authenticated;
GRANT ALL ON public.carreira_anotacoes TO service_role;
DROP POLICY IF EXISTS org_isolation ON public.carreira_anotacoes;
CREATE POLICY org_isolation ON public.carreira_anotacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS usuario_ativo ON public.carreira_anotacoes;
CREATE POLICY usuario_ativo ON public.carreira_anotacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
-- Dono: lê, grava, edita e apaga só as próprias.
DROP POLICY IF EXISTS carreira_anotacoes_proprio ON public.carreira_anotacoes;
CREATE POLICY carreira_anotacoes_proprio ON public.carreira_anotacoes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
-- Gestor/TL da equipe e admin: SÓ leitura (não há policy de gravação para eles).
DROP POLICY IF EXISTS carreira_anotacoes_lider_ler ON public.carreira_anotacoes;
CREATE POLICY carreira_anotacoes_lider_ler ON public.carreira_anotacoes FOR SELECT TO authenticated
  USING (public.carreira_anotacoes_pode_ler(user_id));

-- 2) Comissão do corretor, venda a venda -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.minha_comissao_vendas(_inicio date, _fim date)
RETURNS TABLE(sale_id uuid, venda_em date, imovel text, codigo text, papel text, lados integer, vgv numeric,
              minha_parte numeric, indicador numeric, extras numeric, descontado numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  -- Mesma trava de meu_realizado (t_00c1173c): o só-Locação não lê números de venda.
  IF public.eh_so_locacao(_me) THEN RAISE EXCEPTION 'Sem acesso' USING ERRCODE = '42501'; END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH canon AS (            -- vendas válidas da imobiliária ativa, pela data da assinatura (SP)
    SELECT v.sale_id, v.data_fechamento, v.vgv_proprio
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  -- Parte do corretor (líquida): o mesmo filtro de participacoes_comerciais_validas() (usada por
  -- meu_realizado), lido direto e só do próprio corretor, para não calcular a imobiliária inteira.
  minhas AS (
    SELECT o.sale_id, sum(oc.valor) AS valor
      FROM canon c
      JOIN public.occurrences o ON o.sale_id = c.sale_id
      JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
     WHERE oc.user_id = _me AND coalesce(oc.sem_cadastro_confirmado, false) = false
     GROUP BY o.sale_id),
  base AS (
    SELECT c.sale_id, c.data_fechamento, c.vgv_proprio, m.valor, s.tipo_imovel, s.imovel_bairro,
           s.imovel_endereco, s.imovel_id,
           coalesce(s.corretor_captador_id = _me, false) AS eh_capt,
           coalesce(s.corretor_vendedor_id = _me, false) AS eh_vend,
           public.calcular_distribuicao_venda(s) AS d
      FROM minhas m
      JOIN canon c ON c.sale_id = m.sale_id
      JOIN public.sales s ON s.id = m.sale_id),
  desc_ AS (                 -- só o que foi descontado DO LADO do corretor (captador e/ou vendedor)
    SELECT b.*,
      CASE WHEN b.eh_capt THEN coalesce((b.d ->> 'indicador_captador')::numeric, 0) ELSE 0 END
      + CASE WHEN b.eh_vend THEN coalesce((b.d ->> 'indicador_vendedor')::numeric, 0) ELSE 0 END AS ind,
      CASE WHEN b.eh_capt THEN coalesce((b.d ->> 'descontos_extra_captador')::numeric, 0) ELSE 0 END
      + CASE WHEN b.eh_vend THEN coalesce((b.d ->> 'descontos_extra_vendedor')::numeric, 0) ELSE 0 END AS ext
      FROM base b)
  SELECT x.sale_id, x.data_fechamento,
         nullif(concat_ws(' · ', x.tipo_imovel, coalesce(x.imovel_bairro, x.imovel_endereco)), ''),
         x.imovel_id,
         (SELECT string_agg(DISTINCT CASE oc.papel WHEN 'corretor_captador' THEN 'captador'
                                                   WHEN 'corretor_vendedor' THEN 'vendedor'
                                                   ELSE replace(oc.papel, '_', ' ') END, ' e ')
            FROM public.occurrences o
            JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
           WHERE o.sale_id = x.sale_id AND oc.user_id = _me
             AND coalesce(oc.sem_cadastro_confirmado, false) = false),
         -- Lados da venda que são do corretor (captou = 1, vendeu = 1): a unidade da meta "transações" do plano.
         (x.eh_capt::integer + x.eh_vend::integer),
         round(x.vgv_proprio, 2), round(x.valor, 2), round(x.ind, 2), round(x.ext, 2), round(x.ind + x.ext, 2)
    FROM desc_ x
   ORDER BY x.data_fechamento DESC, x.sale_id;
END $function$;
REVOKE ALL ON FUNCTION public.minha_comissao_vendas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minha_comissao_vendas(date, date) TO authenticated, service_role;

COMMIT;

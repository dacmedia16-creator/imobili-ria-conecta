-- Módulo "Mural de Conquistas" (maquete t_3982960f aprovada por Denis em 15/10/2026; card t_aab528e5).
-- Feed das vendas válidas da imobiliária, "parabenizar", ranking do mês, aniversariantes e o aviso com
-- confete em tempo real (Supabase Realtime, INSERT em achievement_posts).
-- Liga/desliga por imobiliária (super-admin). Começa DESLIGADO em todas.
-- Regra de venda: a MESMA de public.vendas_comerciais_validas() (contrato assinado e etapas seguintes;
-- lançamento entra quando vai ao Financeiro). Nunca guarda valor, comissão nem cliente.
-- Não altera nenhum dado de venda: só lê sales/sale_status_history.

-- 1) Módulo -----------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades', 'mural_conquistas'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades', 'mural_conquistas')
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

CREATE OR REPLACE FUNCTION public.achievements_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'mural_conquistas'), false)
$$;
REVOKE ALL ON FUNCTION public.achievements_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.achievements_enabled() TO authenticated, service_role;

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'mural_conquistas', false FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Aniversário: dado novo e opcional; o próprio usuário preenche no perfil. O mural mostra só dia/mês.
-- Fica em tabela própria (1:1 com profiles) e não em coluna de profiles: gestor/jurídico/financeiro/admin
-- leem perfis de colegas (policy profiles_self_select) e veriam o ano. Aqui só o dono lê a data completa.
CREATE TABLE IF NOT EXISTS public.profile_birthdates (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  data_nascimento date NOT NULL CHECK (data_nascimento >= DATE '1900-01-01'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_birthdates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_birthdates FROM anon, authenticated;
GRANT SELECT ON public.profile_birthdates TO authenticated;
DROP POLICY IF EXISTS profile_birthdates_self ON public.profile_birthdates;  -- o rollback preserva a tabela
CREATE POLICY profile_birthdates_self ON public.profile_birthdates FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.profile_set_birthdate(_data date) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF _data IS NULL THEN
    DELETE FROM public.profile_birthdates WHERE user_id = _uid;
    RETURN NULL;
  END IF;
  IF _data < DATE '1900-01-01' OR _data > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_uid, _data)
  ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now();
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_set_birthdate(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_birthdate(date) TO authenticated, service_role;

-- 3) Tabelas ----------------------------------------------------------------------------------
-- Um post por venda (UNIQUE sale_id) = idempotência. Nunca é apagado pela regra: se a venda sai do
-- conjunto válido (cancelada, devolvida) vira ativo = false; se volta, é reativado por UPDATE — o
-- confete (que escuta só INSERT) não dispara de novo.
CREATE TABLE IF NOT EXISTS public.achievement_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sale_id uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  venda_em timestamptz NOT NULL,
  captador_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  captador_nome text,
  vendedor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  vendedor_nome text,
  coordenador_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  coordenador_nome text,
  tipo_imovel text,
  bairro text,
  cidade text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS achievement_posts_org_venda_idx ON public.achievement_posts (organization_id, venda_em DESC);

CREATE TABLE IF NOT EXISTS public.achievement_cheers (
  post_id uuid NOT NULL REFERENCES public.achievement_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- "Silenciar comemorações": preferência do próprio usuário.
CREATE TABLE IF NOT EXISTS public.achievement_mutes (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Acesso -----------------------------------------------------------------------------------
ALTER TABLE public.achievement_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_cheers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_mutes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.achievement_posts, public.achievement_cheers, public.achievement_mutes FROM anon, authenticated;
-- Leitura direta dos posts é necessária para o Realtime (postgres_changes respeita esta RLS).
GRANT SELECT ON public.achievement_posts TO authenticated;
GRANT SELECT ON public.achievement_cheers TO authenticated;
GRANT SELECT ON public.achievement_mutes TO authenticated;
-- Escritas só pelas funções abaixo (SECURITY DEFINER).

CREATE POLICY org_isolation ON public.achievement_posts AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.achievement_cheers AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY zz_mt_modulo_mural_conquistas ON public.achievement_posts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.achievements_enabled())) WITH CHECK ((SELECT public.achievements_enabled()));
CREATE POLICY zz_mt_modulo_mural_conquistas ON public.achievement_cheers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.achievements_enabled())) WITH CHECK ((SELECT public.achievements_enabled()));

CREATE POLICY achievement_posts_read ON public.achievement_posts FOR SELECT TO authenticated USING (ativo);
CREATE POLICY achievement_cheers_read ON public.achievement_cheers FOR SELECT TO authenticated USING (true);
CREATE POLICY achievement_mutes_self ON public.achievement_mutes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 5) Sincronização com a venda ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.achievement_sync_sale(_sale_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _s record; _venda_em timestamptz; _on boolean;
BEGIN
  SELECT s.id, s.organization_id, s.corretor_captador_id, s.corretor_vendedor_id, s.coordenador_id,
         s.tipo_imovel, s.imovel_bairro, s.imovel_cidade
    INTO _s FROM public.sales s WHERE s.id = _sale_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesma regra dos relatórios (fonte única).
  SELECT v.venda_em INTO _venda_em FROM public.vendas_comerciais_validas() v WHERE v.sale_id = _sale_id;

  IF _venda_em IS NULL THEN
    UPDATE public.achievement_posts SET ativo = false, updated_at = now()
     WHERE sale_id = _sale_id AND ativo;
    RETURN;
  END IF;

  SELECT m.enabled INTO _on FROM public.organization_modules m
   WHERE m.organization_id = _s.organization_id AND m.module = 'mural_conquistas';
  IF NOT coalesce(_on, false) THEN RETURN; END IF;  -- desligado: nada gravado, nenhum evento

  INSERT INTO public.achievement_posts AS p (organization_id, sale_id, venda_em,
    captador_id, captador_nome, vendedor_id, vendedor_nome, coordenador_id, coordenador_nome,
    tipo_imovel, bairro, cidade)
  VALUES (_s.organization_id, _s.id, _venda_em,
    _s.corretor_captador_id, (SELECT nome FROM public.profiles WHERE id = _s.corretor_captador_id),
    _s.corretor_vendedor_id, (SELECT nome FROM public.profiles WHERE id = _s.corretor_vendedor_id),
    _s.coordenador_id, (SELECT nome FROM public.profiles WHERE id = _s.coordenador_id),
    nullif(btrim(_s.tipo_imovel), ''), nullif(btrim(_s.imovel_bairro), ''), nullif(btrim(_s.imovel_cidade), ''))
  ON CONFLICT (sale_id) DO UPDATE SET
    venda_em = EXCLUDED.venda_em,
    captador_id = EXCLUDED.captador_id, captador_nome = EXCLUDED.captador_nome,
    vendedor_id = EXCLUDED.vendedor_id, vendedor_nome = EXCLUDED.vendedor_nome,
    coordenador_id = EXCLUDED.coordenador_id, coordenador_nome = EXCLUDED.coordenador_nome,
    tipo_imovel = EXCLUDED.tipo_imovel, bairro = EXCLUDED.bairro, cidade = EXCLUDED.cidade,
    ativo = true, updated_at = now()
  WHERE (p.venda_em, p.captador_id, p.captador_nome, p.vendedor_id, p.vendedor_nome, p.coordenador_id,
         p.coordenador_nome, p.tipo_imovel, p.bairro, p.cidade, p.ativo)
    IS DISTINCT FROM
        (EXCLUDED.venda_em, EXCLUDED.captador_id, EXCLUDED.captador_nome, EXCLUDED.vendedor_id,
         EXCLUDED.vendedor_nome, EXCLUDED.coordenador_id, EXCLUDED.coordenador_nome,
         EXCLUDED.tipo_imovel, EXCLUDED.bairro, EXCLUDED.cidade, true);
END $$;
REVOKE ALL ON FUNCTION public.achievement_sync_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.achievement_sync_sale(uuid) TO service_role;

-- A comemoração nunca pode travar a venda: erro vira WARNING.
CREATE OR REPLACE FUNCTION public.trg_achievement_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'sales' THEN
      PERFORM public.achievement_sync_sale(NEW.id);
    ELSE
      PERFORM public.achievement_sync_sale(NEW.sale_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mural_conquistas: falha ao sincronizar venda (%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_achievement_sync() FROM PUBLIC, anon, authenticated;

-- Gancho principal: change_sale_status grava o histórico (contrato_assinado / financeiro).
DROP TRIGGER IF EXISTS trg_zz_mural_conquistas ON public.sale_status_history;
CREATE TRIGGER trg_zz_mural_conquistas AFTER INSERT ON public.sale_status_history
  FOR EACH ROW EXECUTE FUNCTION public.trg_achievement_sync();
-- Saída do conjunto válido (cancelada/devolvida) e correções de equipe/imóvel/data.
DROP TRIGGER IF EXISTS trg_zz_mural_conquistas ON public.sales;
CREATE TRIGGER trg_zz_mural_conquistas AFTER UPDATE ON public.sales
  FOR EACH ROW WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.modalidade IS DISTINCT FROM NEW.modalidade
    OR OLD.data_assinatura IS DISTINCT FROM NEW.data_assinatura
    OR OLD.corretor_captador_id IS DISTINCT FROM NEW.corretor_captador_id
    OR OLD.corretor_vendedor_id IS DISTINCT FROM NEW.corretor_vendedor_id
    OR OLD.coordenador_id IS DISTINCT FROM NEW.coordenador_id
    OR OLD.tipo_imovel IS DISTINCT FROM NEW.tipo_imovel
    OR OLD.imovel_bairro IS DISTINCT FROM NEW.imovel_bairro
    OR OLD.imovel_cidade IS DISTINCT FROM NEW.imovel_cidade)
  EXECUTE FUNCTION public.trg_achievement_sync();

-- 6) Leitura para a tela ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.achievement_feed(_limit integer DEFAULT 30)
RETURNS TABLE (id uuid, venda_em timestamptz, captador_nome text, vendedor_nome text, coordenador_nome text,
               tipo_imovel text, bairro text, cidade text, cheers bigint, cheered_by_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p.id, p.venda_em, p.captador_nome, p.vendedor_nome, p.coordenador_nome, p.tipo_imovel, p.bairro, p.cidade,
         (SELECT count(*) FROM public.achievement_cheers c WHERE c.post_id = p.id),
         EXISTS (SELECT 1 FROM public.achievement_cheers c WHERE c.post_id = p.id AND c.user_id = auth.uid())
  FROM public.achievement_posts p
  WHERE public.achievements_enabled() AND p.organization_id = public.current_org_id() AND p.ativo
  ORDER BY p.venda_em DESC, p.created_at DESC
  LIMIT least(greatest(coalesce(_limit, 30), 1), 100)
$$;

CREATE OR REPLACE FUNCTION public.achievement_cheer(_post_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id(); _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.achievements_enabled() OR NOT EXISTS (
    SELECT 1 FROM public.achievement_posts WHERE id = _post_id AND organization_id = _org AND ativo) THEN
    RAISE EXCEPTION 'Conquista indisponivel' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.achievement_cheers (post_id, user_id, organization_id)
  VALUES (_post_id, _uid, _org) ON CONFLICT DO NOTHING;
  RETURN (SELECT count(*) FROM public.achievement_cheers WHERE post_id = _post_id);
END $$;

-- Ranking por quantidade (sem valores): captador +1 e vendedor +1; mês da venda em São Paulo.
CREATE OR REPLACE FUNCTION public.achievement_ranking(_ano integer, _mes integer)
RETURNS TABLE (user_id uuid, nome text, avatar_url text, pontos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH vendas AS (
    SELECT s.corretor_captador_id, s.corretor_vendedor_id
    FROM public.vendas_comerciais_validas() v
    JOIN public.sales s ON s.id = v.sale_id
    WHERE public.achievements_enabled() AND s.organization_id = public.current_org_id()
      AND date_trunc('month', v.venda_em AT TIME ZONE 'America/Sao_Paulo') = make_date(_ano, _mes, 1)
  ), pontos AS (
    SELECT corretor_captador_id AS uid FROM vendas WHERE corretor_captador_id IS NOT NULL
    UNION ALL
    SELECT corretor_vendedor_id FROM vendas WHERE corretor_vendedor_id IS NOT NULL
  )
  SELECT x.uid, pr.nome, pr.avatar_url, count(*)
  FROM pontos x JOIN public.profiles pr ON pr.id = x.uid
  GROUP BY x.uid, pr.nome, pr.avatar_url
  ORDER BY count(*) DESC, pr.nome
  LIMIT 20
$$;

-- Aniversariantes do mês: só dia e mês (nunca ano ou idade), só membros ativos da imobiliária.
CREATE OR REPLACE FUNCTION public.achievement_birthdays(_mes integer)
RETURNS TABLE (user_id uuid, nome text, avatar_url text, dia integer, mes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p.id, p.nome, p.avatar_url, extract(day FROM b.data_nascimento)::int, extract(month FROM b.data_nascimento)::int
  FROM public.profile_birthdates b
  JOIN public.profiles p ON p.id = b.user_id
  JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = public.current_org_id() AND m.ativo
  WHERE public.achievements_enabled() AND p.ativo
    AND extract(month FROM b.data_nascimento) = _mes
  ORDER BY 4, 2
$$;

CREATE OR REPLACE FUNCTION public.achievement_set_muted(_muted boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF _muted THEN
    INSERT INTO public.achievement_mutes (user_id) VALUES (_uid) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.achievement_mutes WHERE user_id = _uid;
  END IF;
  RETURN coalesce(_muted, false);
END $$;

REVOKE ALL ON FUNCTION public.achievement_feed(integer), public.achievement_cheer(uuid),
  public.achievement_ranking(integer, integer), public.achievement_birthdays(integer),
  public.achievement_set_muted(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.achievement_feed(integer), public.achievement_cheer(uuid),
  public.achievement_ranking(integer, integer), public.achievement_birthdays(integer),
  public.achievement_set_muted(boolean) TO authenticated, service_role;

-- 7) Tempo real: só INSERT de post é usado pelo aviso; a RLS acima limita à mesma imobiliária e ao módulo ligado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'achievement_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.achievement_posts;
  END IF;
END $$;

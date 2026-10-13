-- Opção POR IMOBILIÁRIA para mostrar/esconder no Mapa de captações os imóveis de venda do site RE/MAX
-- (pedido de Denis 13/10/2026, t_e02a7b17). Padrão LIGADO.
--
-- Segue o padrão de configuração que o ADM da imobiliária já usa ("Dados da imobiliária"):
-- coluna em public.organizations + RPC de gravação protegida por public.agency_can_edit()
-- (admin ou super_admin da imobiliária atual, usuário ativo). organization_modules não serve aqui:
-- ali só o super-admin da plataforma liga/desliga.
--
--  * public.organizations.mapa_site_enabled boolean NOT NULL DEFAULT true (todas começam ligadas);
--  * public.mapa_site_set_enabled(bool): só admin/super_admin da imobiliária atual; grava só a própria;
--  * public.mapa_anuncios_site(): quando desligado devolve vazio (bloqueio no servidor).
-- Nenhuma coleta, cron, tabela de anúncios ou permissão de tabela muda.
-- Rollback: supabase/rollback/20261013210000_mapa_site_opcao.sql
BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN mapa_site_enabled boolean NOT NULL DEFAULT true;

CREATE FUNCTION public.mapa_site_set_enabled(_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _org uuid := public.current_org_id();
  _now boolean;
BEGIN
  IF NOT coalesce(public.agency_can_edit(), false)
     OR NOT coalesce(public.exclusive_actor_active(auth.uid()), false) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta configuração' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organizations SET mapa_site_enabled = _enabled WHERE id = _org
    RETURNING mapa_site_enabled INTO _now;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliária não encontrada' USING ERRCODE = '42501'; END IF;
  RETURN _now;
END $$;
REVOKE ALL ON FUNCTION public.mapa_site_set_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapa_site_set_enabled(boolean) TO authenticated;

-- Mesma função publicada em 20261013200000, com uma única regra nova: opção desligada => vazio.
CREATE OR REPLACE FUNCTION public.mapa_anuncios_site()
 RETURNS TABLE (
  code text,
  url text,
  transacao text,
  tipo text,
  rua text,
  bairro text,
  cidade text,
  lat double precision,
  lon double precision,
  area numeric,
  quartos smallint,
  preco numeric,
  exclusivo boolean,
  corretor text,
  capture_id uuid,
  coleta timestamptz
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_org_id();
  _run public.remax_site_runs%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT coalesce(public.mt_1b_gate(), false)
     OR NOT coalesce(public.exclusive_actor_active(_uid), false)
     OR NOT coalesce(public.has_any_role(_uid,
       ARRAY['corretor','team_leader','gestor','admin','super_admin']::public.app_role[]), false) THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.exclusive_capture_enabled(), false) THEN
    RETURN;  -- módulo de captação desligado nesta imobiliária: sem camada
  END IF;
  IF NOT coalesce((SELECT o.mapa_site_enabled FROM public.organizations o WHERE o.id = _org), true) THEN
    RETURN;  -- imobiliária desligou os imóveis do site no mapa (t_e02a7b17)
  END IF;
  SELECT * INTO _run FROM public.remax_site_runs r
   WHERE r.organization_id = _org AND r.status = 'ok' ORDER BY r.finished_at DESC LIMIT 1;
  IF _run.id IS NULL THEN
    RETURN;  -- imobiliária sem coleta configurada/boa
  END IF;
  RETURN QUERY
  SELECT l.code, l.url, l.transacao, l.tipo,
         nullif(btrim(l.rua), ''), nullif(btrim(l.bairro), ''), nullif(btrim(l.cidade), ''),
         l.lat, l.lon, l.area, l.quartos, l.preco, l.exclusivo,
         coalesce(p.nome, nullif(btrim(a.nome), '')),
         CASE WHEN k.capture_id IS NOT NULL
               AND coalesce(public.exclusive_can_view(k.capture_id, _uid), false)
              THEN k.capture_id END,
         _run.finished_at
    FROM public.remax_site_listings l
    LEFT JOIN public.remax_site_agents a ON a.organization_id = l.organization_id AND a.agent_id = l.agent_id
    LEFT JOIN LATERAL (
      SELECT nullif(btrim(u.nome), '') AS nome FROM public.profiles u
       WHERE u.organization_id = l.organization_id AND u.remax_id = l.agent_id AND u.ativo
       ORDER BY u.nome LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT x.capture_id FROM public.exclusive_listing_links x
        JOIN public.exclusive_captures c ON c.id = x.capture_id AND c.organization_id = x.organization_id
       WHERE x.organization_id = l.organization_id AND x.code_key = l.code_key
         AND x.status IN ('ativo', 'aguardando_gestor')
         AND c.discarded_at IS NULL AND c.archived_at IS NULL
       ORDER BY (x.status = 'ativo') DESC
       LIMIT 1
    ) k ON true
   WHERE l.organization_id = _org AND l.last_run = _run.id AND l.status_uid = 160
     AND l.transacao = 'venda'
     AND l.lat IS NOT NULL AND l.lon IS NOT NULL
   ORDER BY l.code;
END $function$;

COMMIT;

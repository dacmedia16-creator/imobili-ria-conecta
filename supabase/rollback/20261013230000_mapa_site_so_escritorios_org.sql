-- Rollback de 20261013230000_mapa_site_so_escritorios_org.sql (t_d017e87f)
-- Volta mapa_anuncios_site ao texto de 20261013210000 e devolve o escritório 63164 à configuração da Única.
-- Os anúncios/corretores apagados do 63164 voltam na próxima coleta diária (ou pelo backup
-- /root/.config/max/adm-max-prod-backups/td017-*.dump, tabelas remax_site_listings/remax_site_agents).
-- Depois de rodar, remover a linha 20261013230000 de supabase_migrations.schema_migrations.
BEGIN;
INSERT INTO public.remax_site_offices (organization_id, office_id)
SELECT o.id, 63164 FROM public.organizations o WHERE o.slug = 'unica-escolha'
ON CONFLICT (organization_id, office_id) DO UPDATE SET ativo = true;

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

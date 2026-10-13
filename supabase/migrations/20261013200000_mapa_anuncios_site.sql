-- Painel e mapa das captações: camada com os anúncios do site público da RE/MAX já coletados
-- (remax_site_listings, migration 20261009040000). Pedido de Denis, 13/10/2026 ("então continua").
--
-- Só LEITURA e só uma função nova; nenhuma coleta, tabela, cron ou permissão de tabela muda.
-- Regras:
--  * quem chama: usuário ativo da imobiliária atual, módulo de captação ligado, com papel que já abre
--    o painel (corretor, team_leader, gestor, admin, super_admin) — mesma porta da rota /exclusividades;
--  * o quê: anúncios ATIVOS (status_uid 160) da ÚLTIMA coleta boa da imobiliária do usuário, com
--    coordenada. Coleta falha/suspeita não muda o mapa (vale a última 'ok');
--  * campos: só o que o site público já mostra — código, link, venda/locação, tipo, rua (sem número),
--    bairro, cidade, coordenada, área, quartos, preço, exclusivo e o nome do corretor no site (ou o
--    nome do usuário do ADM com aquele ID). Nunca telefone, e-mail, proprietário ou comissão;
--  * sem duplicar: anúncio LIGADO à captação (exclusive_listing_links status 'ativo', confirmado pelo
--    fluxo do PR #56) devolve capture_id — a tela junta os dois num marcador só. capture_id só sai para
--    quem já pode abrir a captação (exclusive_can_view); para os demais o anúncio aparece sozinho.
--    Ligação 'aguardando_gestor' e semelhança de endereço NÃO juntam nada.
-- Rollback: supabase/rollback/20261013200000_mapa_anuncios_site.sql
BEGIN;

CREATE FUNCTION public.mapa_anuncios_site()
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
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
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
       WHERE x.organization_id = l.organization_id AND x.code_key = l.code_key AND x.status = 'ativo'
         AND c.discarded_at IS NULL AND c.archived_at IS NULL
       LIMIT 1
    ) k ON true
   WHERE l.organization_id = _org AND l.last_run = _run.id AND l.status_uid = 160
     AND l.lat IS NOT NULL AND l.lon IS NOT NULL
   ORDER BY l.code;
END $function$;

REVOKE ALL ON FUNCTION public.mapa_anuncios_site() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapa_anuncios_site() TO authenticated, service_role;

COMMIT;

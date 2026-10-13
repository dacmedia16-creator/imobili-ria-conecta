-- Mapa de captações mostrava imóveis de OUTRA RE/MAX (Denis 13/10/2026, tópico 6238, t_d017e87f).
--
-- Causa (produção, conferida no site remax.com.br): a configuração inicial da Única Escolha
-- (migration 20261009040000) incluiu o escritório 63164, que no site é a REMAX VOLUTE (outra imobiliária).
-- Os da Única são 63059 (Única Escolha I), 63060 (II) e 63183 (III). Dos 822 imóveis de venda no mapa,
-- 108 eram da Volute.
--
-- Correção:
--  1) dados: tira o 63164 da configuração da Única e apaga o que a coleta guardou dele DENTRO da Única
--     (anúncios e nomes de corretores). Assim a próxima coleta já não busca a Volute e o Feedback
--     ("Sem corretor") deixa de listar corretores dela. Nenhum anúncio da Volute estava ligado a captação.
--  2) mapa_anuncios_site(): só devolve anúncio cujo escritório está ATIVO na configuração da própria
--     imobiliária (proteção extra, vale para todas as imobiliárias).
-- Nenhuma coleta (código), cron ou permissão muda. Backup antes: pg_dump do schema public (t_d017e87f).
-- Rollback: supabase/rollback/20261013230000_mapa_site_so_escritorios_org.sql
BEGIN;

DELETE FROM public.remax_site_listings l
 USING public.organizations o
 WHERE o.slug = 'unica-escolha' AND l.organization_id = o.id AND l.office_id = 63164;
DELETE FROM public.remax_site_agents a
 USING public.organizations o
 WHERE o.slug = 'unica-escolha' AND a.organization_id = o.id AND a.office_id = 63164;
DELETE FROM public.remax_site_offices s
 USING public.organizations o
 WHERE o.slug = 'unica-escolha' AND s.organization_id = o.id AND s.office_id = 63164;

-- Mesma função de 20261013210000, com uma única regra nova: escritório ativo da própria imobiliária.
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
     -- só escritórios da própria imobiliária (t_d017e87f)
     AND EXISTS (SELECT 1 FROM public.remax_site_offices s
                  WHERE s.organization_id = _org AND s.office_id = l.office_id AND s.ativo)
   ORDER BY l.code;
END $function$;

COMMIT;

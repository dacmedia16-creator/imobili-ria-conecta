-- Mapa de captações: preço do imóvel para todos, contato do captador e dados para os filtros
-- (pedido de Denis, 08/10/2026: "precisa colocar o preço para todos verem" e "colocar o contato do
-- captador tb").
--
-- Função NOVA (mapa_captacoes_v2) em vez de alterar mapa_captacoes(): o tipo de retorno muda, e a
-- função antiga continua servindo o frontend publicado até o deploy. Rollback = DROP desta função.
--
-- Mesmas regras de mapa_captacoes() (migration 20261008150000):
--  * só captações com contrato assinado (status 'aprovada'), sem descartadas/arquivadas;
--  * só da imobiliária do usuário (current_org_id), módulo de captação ligado;
--  * ponto exato do imóvel; endereço por escrito, situação e botão Abrir só para gestor/admin/
--    super_admin ou quem já vê a captação (exclusive_can_view).
-- Novo (decisão de Denis 08/10):
--  * valor_imovel (valor do imóvel informado na captação) para TODOS os perfis;
--  * contato do CAPTADOR (corretor dono da captação, profiles do captor_id): telefone e e-mail;
--  * equipe do captador (teams.nome via team_members) para o filtro.
-- Continua proibido: nome, telefone, e-mail ou documento do PROPRIETÁRIO e a comissão — nada de
-- form_data->'proprietario_*', 'testemunha_*' ou 'condicoes'->'comissao_*' sai daqui.
-- Rollback: supabase/rollback/20261008170000_mapa_captacoes_preco_contato.sql
BEGIN;

CREATE FUNCTION public.mapa_captacoes_v2()
 RETURNS TABLE (
  id uuid,
  codigo text,
  tipo_imovel text,
  bairro text,
  cidade text,
  captador text,
  geo_lat double precision,
  geo_lon double precision,
  detalhe boolean,
  pode_abrir boolean,
  endereco text,
  status text,
  signed_on date,
  prazo_dias text,
  estado text,
  geo_key text,
  valor_imovel text,
  captador_id uuid,
  captador_telefone text,
  captador_email text,
  equipe text
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _org uuid := public.current_org_id();
  _amplo boolean;
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.exclusive_capture_enabled(), false) THEN
    RETURN;  -- módulo de captação desligado nesta imobiliária: mapa vazio
  END IF;
  _amplo := coalesce(public.has_any_role(auth.uid(),
    ARRAY['gestor','admin','super_admin']::public.app_role[]), false);
  RETURN QUERY
  WITH c AS (
    SELECT x.id, x.form_data, x.broker_name, x.captor_id, x.geo_lat, x.geo_lon, x.geo_key, x.status,
           x.signed_on, x.created_at,
           coalesce(public.exclusive_can_view(x.id, auth.uid()), false) AS abre
    FROM public.exclusive_captures x
    WHERE x.organization_id = _org AND x.status = 'aprovada'
      AND x.discarded_at IS NULL AND x.archived_at IS NULL
  ), d AS (
    SELECT c.*, (_amplo OR c.abre) AS det FROM c
  )
  SELECT d.id,
         upper(left(d.id::text, 8)),
         nullif(btrim(d.form_data->'imovel'->>'tipo_imovel'), ''),
         nullif(btrim(d.form_data->'imovel'->>'bairro'), ''),
         nullif(btrim(d.form_data->'imovel'->>'municipio'), ''),
         coalesce(nullif(btrim(d.broker_name), ''), nullif(btrim(p.nome), '')),
         d.geo_lat,
         d.geo_lon,
         d.det,
         d.abre,
         CASE WHEN d.det THEN nullif(btrim(d.form_data->'imovel'->>'endereco'), '') END,
         CASE WHEN d.det THEN d.status END,
         CASE WHEN d.det THEN d.signed_on END,
         CASE WHEN d.det THEN d.form_data->'condicoes'->>'prazo_dias_numero' END,
         CASE WHEN d.abre THEN nullif(btrim(d.form_data->'imovel'->>'estado'), '') END,
         CASE WHEN d.abre THEN d.geo_key END,
         nullif(btrim(d.form_data->'imovel'->>'valor_imovel'), ''),
         d.captor_id,
         -- contato do corretor captador: só de perfil ativo da mesma imobiliária
         CASE WHEN p.ativo THEN nullif(btrim(p.telefone), '') END,
         CASE WHEN p.ativo THEN nullif(btrim(p.email), '') END,
         eq.nome
  FROM d
  LEFT JOIN public.profiles p ON p.id = d.captor_id AND p.organization_id = _org
  LEFT JOIN LATERAL (
    SELECT nullif(btrim(t.nome), '') AS nome
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _org
    WHERE tm.membro_id = d.captor_id AND tm.organization_id = _org
    ORDER BY tm.created_at
    LIMIT 1
  ) eq ON true
  ORDER BY d.created_at DESC;
END $function$;

GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.mapa_captacoes_v2() OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.mapa_captacoes_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapa_captacoes_v2() TO authenticated, service_role;

COMMIT;

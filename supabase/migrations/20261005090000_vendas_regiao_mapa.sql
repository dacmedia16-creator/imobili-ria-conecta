-- Mapa da tela "Vendas por região": guarda a coordenada (lat/lon) de cada venda, obtida do endereço
-- do imóvel (rua, bairro, cidade, UF — nunca dado de cliente) via OpenStreetMap/Nominatim no navegador.
-- geo_key = endereço normalizado usado na consulta; se o endereço mudar, o mapa refaz a busca.
--
-- Por que tabela própria e não colunas em public.sales: sales tem ~18 triggers (updated_at, trava de
-- comissão, auditoria, validações de status/valor). Gravar a coordenada lá mudaria updated_at e
-- dispararia essas regras numa venda que não mudou. Em sale_geo a venda fica intacta.
-- Isolamento: organization_id com FK composta (sale_id, organization_id) -> sales(id, organization_id),
-- RLS por current_org_id() + mt_1b_gate() + can_view_sale(); escrita só pela RPC definer sale_set_geo.
-- Rollback: supabase/rollback/20261005090000_vendas_regiao_mapa.sql
BEGIN;

CREATE TABLE public.sale_geo (
  sale_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  geo_key text NOT NULL CHECK (length(geo_key) <= 500),
  geo_lat double precision CHECK (geo_lat BETWEEN -90 AND 90),
  geo_lon double precision CHECK (geo_lon BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((geo_lat IS NULL) = (geo_lon IS NULL)),
  FOREIGN KEY (sale_id, organization_id) REFERENCES public.sales(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX sale_geo_org_idx ON public.sale_geo (organization_id);

ALTER TABLE public.sale_geo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_geo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_geo TO authenticated;
GRANT ALL ON public.sale_geo TO service_role, mt_1b_definer;
CREATE POLICY mt_1b_definer_access ON public.sale_geo FOR ALL TO mt_1b_definer
  USING (true) WITH CHECK (true);
CREATE POLICY sale_geo_read ON public.sale_geo FOR SELECT TO authenticated USING (
  organization_id = (SELECT public.current_org_id())
  AND (SELECT public.mt_1b_gate())
  AND public.can_view_sale((SELECT auth.uid()), sale_id)
);
CREATE TRIGGER trg_zz_pc_audit AFTER INSERT OR DELETE OR UPDATE ON public.sale_geo
  FOR EACH ROW EXECUTE FUNCTION public.mt_pc_audit_write();

CREATE FUNCTION public.sale_set_geo(_sale_id uuid, _key text, _lat double precision, _lon double precision)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _org uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id INTO _org FROM public.sales s
    WHERE s.id = _sale_id AND s.organization_id = public.current_org_id();
  IF _org IS NULL THEN RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501'; END IF;
  IF _key IS NULL OR length(_key) = 0 OR length(_key) > 500 THEN RAISE EXCEPTION 'Endereço inválido'; END IF;
  IF (_lat IS NULL) <> (_lon IS NULL) OR _lat NOT BETWEEN -90 AND 90 OR _lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Coordenada inválida';
  END IF;
  INSERT INTO public.sale_geo (sale_id, organization_id, geo_key, geo_lat, geo_lon, updated_at)
  VALUES (_sale_id, _org, _key, _lat, _lon, now())
  ON CONFLICT (sale_id) DO UPDATE
    SET geo_key = EXCLUDED.geo_key, geo_lat = EXCLUDED.geo_lat, geo_lon = EXCLUDED.geo_lon,
        updated_at = now()
    WHERE public.sale_geo.organization_id = _org;
END $function$;
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.sale_set_geo(uuid,text,double precision,double precision) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.sale_set_geo(uuid,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_set_geo(uuid,text,double precision,double precision) TO authenticated, service_role;

COMMIT;

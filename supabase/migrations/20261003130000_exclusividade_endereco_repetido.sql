-- Aviso de endereço repetido: ao abrir/salvar uma captação, informa se já existe outra captação
-- ATIVA (não excluída, não arquivada, não vencida) da mesma imobiliária no mesmo endereço
-- (endereço + complemento + cidade, normalizados). Retorna só nome do captador, situação e data —
-- nenhum dado de proprietário. Rollback: docs/sql/rollback/20261003130000_exclusividade_endereco_repetido.rollback.sql
BEGIN;
CREATE FUNCTION public.exclusive_norm_address(_t text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $f$
  SELECT nullif(trim(regexp_replace(regexp_replace(regexp_replace(
    ' ' || translate(lower(coalesce(_t,'')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn') || ' ',
    '[^a-z0-9]+', ' ', 'g'),
    ' (r|rua) ', ' rua ', 'g'),
    ' (av|avenida) ', ' avenida ', 'g')), '')
$f$;

CREATE FUNCTION public.exclusive_address_conflicts(_id uuid)
 RETURNS TABLE(broker_name text, status text, created_on_sp date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _key text;
BEGIN
  IF NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id;
  _key := public.exclusive_norm_address(_c.form_data->'imovel'->>'endereco');
  IF _key IS NULL THEN RETURN; END IF;
  _key := _key || '|' || coalesce(public.exclusive_norm_address(_c.form_data->'imovel'->>'complemento'),'')
               || '|' || coalesce(public.exclusive_norm_address(_c.form_data->'imovel'->>'municipio'),'');
  RETURN QUERY
  SELECT o.broker_name::text, o.status::text, o.created_on_sp
  FROM public.exclusive_captures o
  WHERE o.id <> _id AND o.organization_id = _c.organization_id
    AND o.discarded_at IS NULL AND o.archived_at IS NULL
    AND NOT (o.signed_on IS NOT NULL
             AND (o.form_data->'condicoes'->>'prazo_dias_numero') ~ '^\d+$'
             AND o.signed_on + (o.form_data->'condicoes'->>'prazo_dias_numero')::int
                 < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
    AND public.exclusive_norm_address(o.form_data->'imovel'->>'endereco')
        || '|' || coalesce(public.exclusive_norm_address(o.form_data->'imovel'->>'complemento'),'')
        || '|' || coalesce(public.exclusive_norm_address(o.form_data->'imovel'->>'municipio'),'') = _key
  ORDER BY o.created_at;
END $function$;
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_address_conflicts(uuid) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_address_conflicts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_address_conflicts(uuid) TO authenticated, service_role;
COMMIT;

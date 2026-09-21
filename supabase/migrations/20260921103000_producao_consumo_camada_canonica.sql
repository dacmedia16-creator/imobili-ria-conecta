-- Completa a migração da Produção por pessoa para a camada canônica.
DO $migrate$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'producao_por_pessoa_dados'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Função esperada não encontrada: public.producao_por_pessoa_dados()';
  END IF;

  v_updated := replace(
    v_definition,
    'from public.vendas_comerciais_validas()',
    'from public.vendas_comerciais_canonicas()'
  );

  IF v_updated <> v_definition THEN
    EXECUTE v_updated;
  END IF;
END
$migrate$;

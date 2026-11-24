-- Rollback de 20270103120000_leads_gestor_ve_equipe.sql: volta as definições que estavam em produção em 24/11.
BEGIN;
DROP POLICY IF EXISTS leads_read ON public.leads;
CREATE POLICY leads_read ON public.leads FOR SELECT TO authenticated
  USING ((SELECT public.leads_gestor())
         OR responsavel_id IN (SELECT public.leads_responsaveis_visiveis()));

CREATE OR REPLACE FUNCTION public.leads_responsaveis_visiveis()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() WHERE auth.uid() IS NOT NULL
     AND public.lead_pode_ser_responsavel(auth.uid(), public.current_org_id())
  UNION
  SELECT tm.membro_id FROM public.team_members tm
   WHERE auth.uid() IS NOT NULL AND tm.organization_id = public.current_org_id()
     AND public.has_role(auth.uid(), 'team_leader'::public.app_role)
     AND public.leads_team_or_parent(tm.team_id, auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.lead_contatos(_ids uuid[])
 RETURNS TABLE(id uuid, telefone text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _org uuid := public.lead_ctx(); _gestor boolean := public.leads_gestor();
BEGIN
  IF _ids IS NULL OR cardinality(_ids) > 500 THEN
    RAISE EXCEPTION 'Lista de leads invalida' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT l.id, l.telefone, l.email FROM public.leads l
   WHERE l.organization_id = _org AND l.id = ANY (_ids)
     AND (_gestor
          OR (l.aceito_em IS NOT NULL AND l.no_banco_desde IS NULL
              AND l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis())));
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_pode_ver(_lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND (public.leads_gestor() OR EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.id = _lead AND l.organization_id = public.current_org_id()
       AND l.aceito_em IS NOT NULL AND l.no_banco_desde IS NULL
       AND l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis())))
$function$;

CREATE OR REPLACE FUNCTION public.lead_pega(_lead uuid, _org uuid)
 RETURNS leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead AND organization_id = _org FOR UPDATE;
  -- coalesce: lead sem responsável dá NULL no IN e NÃO pode passar para corretor (revisão t_2472761a).
  IF _l.id IS NULL OR NOT coalesce(public.leads_gestor()
       OR _l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis()), false) THEN
    RAISE EXCEPTION 'Lead nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN _l;
END $function$;

CREATE OR REPLACE FUNCTION public.proposta_criar(_capture_id uuid, _lead_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.proposta_ctx(); _me uuid := auth.uid(); _c public.exclusive_captures;
        _l public.leads; _cli public.clientes; _id uuid := gen_random_uuid(); _im jsonb; _o record; _ec text;
        _uf text; _p public.propostas_compra;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture_id AND organization_id = _org;
  IF _c.id IS NULL OR NOT public.exclusive_pode_virar_venda(_capture_id, _me) THEN
    RAISE EXCEPTION 'Só o captador, corretores e o gestor da mesma equipe fazem proposta nesta captação (aprovada).'
      USING ERRCODE = '42501';
  END IF;
  IF _lead_id IS NOT NULL THEN
    SELECT * INTO _l FROM public.leads WHERE id = _lead_id AND organization_id = _org;
    IF _l.id IS NULL OR NOT coalesce(public.leads_enabled(), false)
       OR NOT coalesce(public.leads_gestor() OR _l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis()), false) THEN
      RAISE EXCEPTION 'Lead não encontrado.' USING ERRCODE = '42501';
    END IF;
    IF _l.cliente_id IS NOT NULL THEN
      SELECT * INTO _cli FROM public.clientes WHERE id = _l.cliente_id AND organization_id = _org;
    END IF;
  END IF;

  _im := CASE WHEN jsonb_typeof(_c.form_data->'imovel') = 'object' THEN _c.form_data->'imovel' ELSE '{}'::jsonb END;
  _uf := upper(btrim(coalesce(_im->>'estado', '')));
  -- Padrões do texto oficial (t_b4e7c368): contrato em 15 dias, proteção das certidões marcada, sinal em 2 dias úteis.
  INSERT INTO public.propostas_compra (id, organization_id, capture_id, lead_id, corretor_id, prazo_contrato_dias,
    certidoes, sinal_prazo_dias, imovel, criado_por)
  VALUES (_id, _org, _c.id, _l.id, _me, 15, 'vendedor_apresenta', 2, jsonb_strip_nulls(jsonb_build_object(
      'codigo', upper(left(replace(_c.id::text, '-', ''), 8)),
      'tipo', nullif(btrim(_im->>'tipo_imovel'), ''), 'endereco', nullif(btrim(_im->>'endereco'), ''),
      'complemento', nullif(btrim(_im->>'complemento'), ''), 'bairro', nullif(btrim(_im->>'bairro'), ''),
      'cidade', nullif(btrim(_im->>'municipio'), ''), 'uf', CASE WHEN _uf ~ '^[A-Z]{2}$' THEN _uf ELSE nullif(btrim(_im->>'estado'), '') END,
      'matricula', nullif(btrim(_im->>'numero_matricula'), ''), 'cartorio', nullif(btrim(_im->>'cartorio_registro'), ''),
      'iptu', nullif(btrim(_im->>'classificacao_fiscal_iptu'), ''), 'valor_anunciado', nullif(btrim(_im->>'valor_imovel'), ''))),
    _me);

  -- Comprador: do lead (nome, celular, e-mail) + cadastro do cliente (CPF/CNPJ, tipo) quando houver.
  PERFORM public.proposta_parte_inserir(_org, _id, 'comprador', 1,
    CASE WHEN _cli.tipo_pessoa IN ('fisica', 'juridica') THEN _cli.tipo_pessoa ELSE 'fisica' END,
    coalesce(nullif(btrim(_cli.razao_social), ''), nullif(btrim(_cli.nome), ''), _l.nome),
    coalesce(_cli.cpf_cnpj, _cli.cnpj), NULL, coalesce(_l.telefone, _cli.telefone), coalesce(_l.email, _cli.email),
    NULL, CASE WHEN _l.id IS NOT NULL THEN 'lead' ELSE 'manual' END);

  -- Vendedores: todos os proprietários da captação (1º sempre; demais com nome), como no "Virou venda".
  FOR _o IN SELECT l.o, l.n FROM jsonb_array_elements(public.exclusive_owner_list(_c.form_data)) WITH ORDINALITY l(o, n)
             WHERE l.n = 1 OR nullif(btrim(coalesce(l.o->>'nome_completo', '')), '') IS NOT NULL LOOP
    _ec := public.proposta_estado_civil(_o.o->>'estado_civil');
    PERFORM public.proposta_parte_inserir(_org, _id, 'vendedor', _o.n::int, 'fisica', _o.o->>'nome_completo',
      _o.o->>'cpf', _ec, _o.o->>'telefone_1', _o.o->>'email', NULL, 'captacao');
    IF public.proposta_precisa_conjuge(_ec) THEN
      PERFORM public.proposta_parte_inserir(_org, _id, 'vendedor_conjuge', _o.n::int, 'fisica', NULL, NULL, NULL,
        NULL, NULL, NULL, 'manual');
    END IF;
  END LOOP;

  -- Corretor do negócio (quem cria): nome e celular do perfil.
  PERFORM public.proposta_parte_inserir(_org, _id, 'corretor', 1, 'fisica', pr.nome, NULL, NULL, pr.telefone, NULL,
    _me, 'perfil') FROM public.profiles pr WHERE pr.id = _me;

  SELECT * INTO _p FROM public.propostas_compra WHERE id = _id;
  PERFORM public.proposta_evento(_p, 'criada', CASE WHEN _l.id IS NOT NULL THEN 'com lead do CRM' END);
  RETURN public.proposta_detalhe(_id);
END $function$;

DROP FUNCTION IF EXISTS public.leads_ve_responsavel(uuid);
DROP FUNCTION IF EXISTS public.leads_admin();
COMMIT;

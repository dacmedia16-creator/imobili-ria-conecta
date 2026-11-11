-- Etapa de montagem residencial com fiador. Sem cobrança, assinatura ou envio externo.
CREATE TABLE public.locacao_montagem (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campos jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT montagem_campos_objeto CHECK (jsonb_typeof(campos) = 'object')
);
ALTER TABLE public.locacao_montagem ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_montagem FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_montagem TO service_role;

-- Não liberar montagem antes da conferência nem após troca de etapa; gravações só no setor de contratos.
CREATE OR REPLACE FUNCTION public.locacao_montagem_pega(_id uuid) RETURNS public.locacoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _l.tipo <> 'residencial' OR _l.garantia <> 'fiador' THEN
    RAISE EXCEPTION 'Modelo disponível apenas para residencial com fiador' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.locacao_docs_faltando(_l)) > 0 THEN
    RAISE EXCEPTION 'Montar contrato travado: documentos obrigatórios pendentes' USING ERRCODE = '22023';
  END IF;
  RETURN _l;
END $$;
REVOKE ALL ON FUNCTION public.locacao_montagem_pega(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_montagem_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_montagem_pega(_id); _o public.organizations; _c jsonb;
BEGIN
  SELECT * INTO _o FROM public.organizations WHERE id = _l.organization_id;
  SELECT campos INTO _c FROM public.locacao_montagem WHERE locacao_id = _id AND organization_id = _l.organization_id;
  RETURN jsonb_build_object('campos', coalesce(_c, '{}'::jsonb),
    'contrato', public.locacao_contrato_valores(_l),
    'administradora', jsonb_build_object('nome', coalesce(_o.razao_social, _o.nome),
      'cnpj', _o.cnpj, 'creci', _o.creci, 'cidade', _o.cidade, 'uf', _o.uf));
END $$;

CREATE OR REPLACE FUNCTION public.locacao_montagem_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_montagem_pega(_id); _k text; _v jsonb; _lim integer;
BEGIN
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR _dados = '{}'::jsonb THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(_dados) LOOP
    IF NOT ((_k LIKE 'd\_%' ESCAPE '\' AND substring(_k FROM 3) = ANY(public.locacao_contrato_chaves())) OR _k = ANY(ARRAY[
      'imovel_endereco','fia_imovel_endereco','aluguel',
      'numero','situacao','checklist_modelo','destinacao_fiscal','locadores_adicionais','locatarios_adicionais',
      'nota_fiscal','irrf','deduzir_taxa_irrf','dimob','fim','ocupacao','reajuste',
      'conta_bancaria','cobranca','entrega','isencao_multa_meses','mes_fechado',
      'juros','multa','desconto','tarifa_bancaria','gerente_comercial','clausulas_adicionais',
      'observacao','repasse_tipo','repasse_taxa','repasse_fixo','repasse_dias_uteis',
      'repasse_garantido','tarifa_doc_ted','local','data','assinaturas'])) THEN
      RAISE EXCEPTION 'Campo de montagem inválido: %', _k USING ERRCODE = '22023';
    END IF;
    _lim := CASE WHEN _k IN ('clausulas_adicionais','observacao','locadores_adicionais','locatarios_adicionais','assinaturas') THEN 4000
                 WHEN _k = 'd_moradores' THEN 2000 ELSE 400 END;
    IF jsonb_typeof(_v) <> 'string' OR length(_v #>> '{}') > _lim THEN
      RAISE EXCEPTION 'Valor inválido: %', _k USING ERRCODE = '22023';
    END IF;
    IF (_k LIKE 'd\_%' ESCAPE '\' AND NOT public.locacao_contrato_valor_ok(substring(_k FROM 3), _v #>> '{}'))
       OR (_k = 'aluguel' AND (_v #>> '{}') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$')
       OR (_k = 'aluguel' AND (_v #>> '{}') ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' AND (_v #>> '{}')::numeric <= 0)
       OR (_k = 'fim' AND (_v #>> '{}') <> '' AND NOT public.locacao_contrato_valor_ok('inicio', _v #>> '{}'))
       OR (_k = 'data' AND (_v #>> '{}') <> '' AND NOT public.locacao_contrato_valor_ok('inicio', _v #>> '{}'))
       OR (_k = 'isencao_multa_meses' AND (_v #>> '{}') <> '' AND (_v #>> '{}') !~ '^[0-9]{1,3}$')
    THEN
      RAISE EXCEPTION 'Valor inválido: %', _k USING ERRCODE = '22023';
    END IF;
    IF (_v #>> '{}') <> '' AND (
      (_k = 'situacao' AND _v #>> '{}' NOT IN ('ativo','pendente'))
      OR (_k = 'cobranca' AND _v #>> '{}' NOT IN ('mes_vencido','mes_vincendo'))
      OR (_k = 'repasse_tipo' AND _v #>> '{}' NOT IN ('manual','split'))
      OR (_k = 'repasse_taxa' AND CASE WHEN (_v #>> '{}') ~ '^([0-9]{1,2}|100)(\.[0-9]{1,2})?$' THEN (_v #>> '{}')::numeric > 100 ELSE true END)
      OR (_k = 'repasse_dias_uteis' AND CASE WHEN (_v #>> '{}') ~ '^[0-9]{1,2}$' THEN (_v #>> '{}')::int > 60 ELSE true END)
      OR (_k IN ('nota_fiscal','irrf','deduzir_taxa_irrf','dimob','mes_fechado','repasse_garantido')
          AND _v #>> '{}' NOT IN ('sim','nao'))
    ) THEN
      RAISE EXCEPTION 'Valor fora das opções: %', _k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.locacao_montagem(locacao_id, organization_id, campos)
    VALUES (_id, _l.organization_id, _dados)
  ON CONFLICT (locacao_id) DO UPDATE SET campos = public.locacao_montagem.campos || EXCLUDED.campos,
    atualizado_em = now()
    WHERE public.locacao_montagem.organization_id = EXCLUDED.organization_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.locacao_montagem_ler(uuid), public.locacao_montagem_salvar(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_montagem_ler(uuid), public.locacao_montagem_salvar(uuid,jsonb)
  TO authenticated;

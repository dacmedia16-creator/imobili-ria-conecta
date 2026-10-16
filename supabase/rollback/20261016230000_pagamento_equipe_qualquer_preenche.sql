-- Rollback da migration 20261016230000_pagamento_equipe_qualquer_preenche.sql (card t_19cd1fc1).
-- Volta à regra anterior (só o próprio corretor grava o bloco dele na venda): remove a RPC
-- salvar_dados_pagamento_venda, restaura salvar_meus_dados_pagamento_venda e venda_dados_pagamento
-- exatamente como em 20261016220000 e remove as colunas preenchido_por / preenchido_em.
-- Os dados já gravados na cópia por venda são mantidos (inclusive os preenchidos por terceiros).
-- ATENÇÃO: publicar o frontend anterior junto (a tela nova chama salvar_dados_pagamento_venda).
BEGIN;
DROP FUNCTION IF EXISTS public.salvar_dados_pagamento_venda(uuid, uuid, text, boolean, jsonb, boolean);
DROP FUNCTION IF EXISTS public.venda_dados_pagamento(uuid);

CREATE OR REPLACE FUNCTION public.salvar_meus_dados_pagamento_venda(
  _sale_id uuid, _modo text, _usar_cadastro boolean DEFAULT false,
  _dados jsonb DEFAULT '{}'::jsonb, _salvar_cadastro boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _sale_org uuid; _status text;
  _cad public.corretor_dados_pagamento%ROWTYPE;
  _titular text; _documento text; _tipo_conta text; _banco text; _agencia text; _conta text;
  _pix_tipo text; _pix_chave text;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id, s.status::text INTO _sale_org, _status FROM public.sales s WHERE s.id = _sale_id;
  IF _sale_org IS NULL OR _sale_org <> _org OR NOT coalesce(public.can_view_sale(_me, _sale_id), false) THEN
    RAISE EXCEPTION 'Venda não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sale_equipe_pagamento(_sale_id) p WHERE p.user_id = _me) THEN
    RAISE EXCEPTION 'Só a própria pessoa da equipe preenche os dados de pagamento dela' USING ERRCODE = '42501';
  END IF;
  IF _status IN ('arquivada', 'cancelada', 'ocorrencia_concluida') THEN
    RAISE EXCEPTION 'Venda encerrada: os dados de pagamento não podem mais ser alterados' USING ERRCODE = '42501';
  END IF;
  IF _modo IS NULL OR _modo NOT IN ('imobiliaria', 'conta_propria') THEN
    RAISE EXCEPTION 'Escolha como vai receber' USING ERRCODE = '22023';
  END IF;

  IF _modo = 'conta_propria' THEN
    IF coalesce(_usar_cadastro, false) THEN
      SELECT * INTO _cad FROM public.corretor_dados_pagamento c WHERE c.organization_id = _org AND c.user_id = _me;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ainda não há conta salva no seu cadastro' USING ERRCODE = '22023';
      END IF;
      _titular := _cad.titular; _documento := _cad.documento; _tipo_conta := _cad.tipo_conta;
      _banco := _cad.banco; _agencia := _cad.agencia; _conta := _cad.conta;
      _pix_tipo := _cad.pix_tipo; _pix_chave := _cad.pix_chave;
    ELSE
      _dados := coalesce(_dados, '{}'::jsonb);
      _titular := nullif(btrim(_dados->>'titular'), '');
      _documento := nullif(btrim(_dados->>'documento'), '');
      _tipo_conta := nullif(btrim(_dados->>'tipo_conta'), '');
      _banco := nullif(btrim(_dados->>'banco'), '');
      _agencia := nullif(btrim(_dados->>'agencia'), '');
      _conta := nullif(btrim(_dados->>'conta'), '');
      _pix_tipo := nullif(btrim(_dados->>'pix_tipo'), '');
      _pix_chave := nullif(btrim(_dados->>'pix_chave'), '');
      IF coalesce(_salvar_cadastro, false) THEN
        INSERT INTO public.corretor_dados_pagamento AS c (organization_id, user_id, recebe_pela_imobiliaria,
          titular, documento, tipo_conta, banco, agencia, conta, pix_tipo, pix_chave)
        VALUES (_org, _me, false, _titular, _documento, _tipo_conta, _banco, _agencia, _conta, _pix_tipo, _pix_chave)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET
          recebe_pela_imobiliaria = false, titular = EXCLUDED.titular, documento = EXCLUDED.documento,
          tipo_conta = EXCLUDED.tipo_conta, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia,
          conta = EXCLUDED.conta, pix_tipo = EXCLUDED.pix_tipo, pix_chave = EXCLUDED.pix_chave;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.sale_dados_pagamento AS d (organization_id, sale_id, user_id, modo, titular, documento,
    tipo_conta, banco, agencia, conta, pix_tipo, pix_chave)
  VALUES (_org, _sale_id, _me, _modo, _titular, _documento, _tipo_conta, _banco, _agencia, _conta, _pix_tipo, _pix_chave)
  ON CONFLICT (sale_id, user_id) DO UPDATE SET
    modo = EXCLUDED.modo, titular = EXCLUDED.titular, documento = EXCLUDED.documento,
    tipo_conta = EXCLUDED.tipo_conta, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia,
    conta = EXCLUDED.conta, pix_tipo = EXCLUDED.pix_tipo, pix_chave = EXCLUDED.pix_chave;
END $function$;
REVOKE ALL ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean)
  TO authenticated, service_role;

CREATE FUNCTION public.venda_dados_pagamento(_sale_id uuid)
RETURNS TABLE(user_id uuid, nome text, origem text, modo text, completo boolean, tem_cadastro boolean,
              dados_completos boolean, titular text, documento text, tipo_conta text, banco text,
              agencia text, conta text, pix_tipo text, pix_chave text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _sale_org uuid; _priv boolean;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id INTO _sale_org FROM public.sales s WHERE s.id = _sale_id;
  IF _sale_org IS NULL OR _sale_org <> _org OR NOT coalesce(public.can_view_sale(_me, _sale_id), false) THEN
    RAISE EXCEPTION 'Venda não encontrada' USING ERRCODE = '42501';
  END IF;
  _priv := coalesce(public.has_any_role(_me, ARRAY['admin', 'super_admin', 'financeiro']::public.app_role[]), false);
  RETURN QUERY
  WITH eq AS (SELECT p.user_id FROM public.sale_equipe_pagamento(_sale_id) p),
  base AS (
    SELECT eq.user_id, pr.nome,
           CASE WHEN v.id IS NOT NULL THEN 'venda' WHEN c.user_id IS NOT NULL THEN 'cadastro' ELSE 'nenhum' END AS origem,
           CASE WHEN v.id IS NOT NULL THEN v.modo
                WHEN c.recebe_pela_imobiliaria THEN 'imobiliaria' ELSE 'conta_propria' END AS modo,
           (c.user_id IS NOT NULL) AS tem_cadastro,
           (eq.user_id = _me OR _priv) AS ve_tudo,
           CASE WHEN v.id IS NOT NULL THEN v.titular ELSE c.titular END AS titular,
           CASE WHEN v.id IS NOT NULL THEN v.documento ELSE c.documento END AS documento,
           CASE WHEN v.id IS NOT NULL THEN v.tipo_conta ELSE c.tipo_conta END AS tipo_conta,
           CASE WHEN v.id IS NOT NULL THEN v.banco ELSE c.banco END AS banco,
           CASE WHEN v.id IS NOT NULL THEN v.agencia ELSE c.agencia END AS agencia,
           CASE WHEN v.id IS NOT NULL THEN v.conta ELSE c.conta END AS conta,
           CASE WHEN v.id IS NOT NULL THEN v.pix_tipo ELSE c.pix_tipo END AS pix_tipo,
           CASE WHEN v.id IS NOT NULL THEN v.pix_chave ELSE c.pix_chave END AS pix_chave
      FROM eq
      LEFT JOIN public.profiles pr ON pr.id = eq.user_id
      LEFT JOIN public.sale_dados_pagamento v ON v.sale_id = _sale_id AND v.user_id = eq.user_id
                                              AND v.organization_id = _org
      LEFT JOIN public.corretor_dados_pagamento c ON c.organization_id = _org AND c.user_id = eq.user_id
  )
  SELECT b.user_id, b.nome, b.origem, b.modo,
         (b.titular IS NOT NULL AND (b.pix_chave IS NOT NULL
           OR (b.banco IS NOT NULL AND b.agencia IS NOT NULL AND b.conta IS NOT NULL))) AS completo,
         b.tem_cadastro, b.ve_tudo,
         b.titular,
         CASE WHEN b.ve_tudo THEN b.documento ELSE public.pagamento_mascarar(b.documento) END,
         b.tipo_conta, b.banco,
         CASE WHEN b.ve_tudo THEN b.agencia ELSE public.pagamento_mascarar(b.agencia) END,
         CASE WHEN b.ve_tudo THEN b.conta ELSE public.pagamento_mascarar(b.conta) END,
         b.pix_tipo,
         CASE WHEN b.ve_tudo THEN b.pix_chave ELSE public.pagamento_mascarar(b.pix_chave) END
    FROM base b
   ORDER BY b.nome;
END $function$;
REVOKE ALL ON FUNCTION public.venda_dados_pagamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_dados_pagamento(uuid) TO authenticated, service_role;

ALTER TABLE public.sale_dados_pagamento DROP COLUMN IF EXISTS preenchido_em;
ALTER TABLE public.sale_dados_pagamento DROP COLUMN IF EXISTS preenchido_por;
COMMIT;

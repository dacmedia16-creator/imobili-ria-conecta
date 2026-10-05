-- Valores antigos são preservados e considerados manuais. Nenhuma venda existente é atualizada.
ALTER TABLE public.sales
  ADD COLUMN imovel_observacoes_origem text NOT NULL DEFAULT 'manual'
    CHECK (imovel_observacoes_origem IN ('manual', 'ia_matricula')),
  ADD COLUMN imovel_descricao_corrigida_por uuid,
  ADD COLUMN imovel_descricao_corrigida_em timestamptz;

CREATE FUNCTION public.enforce_matricula_descricao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.imovel_observacoes_origem <> 'manual'
       OR NEW.imovel_descricao_corrigida_por IS NOT NULL
       OR NEW.imovel_descricao_corrigida_em IS NOT NULL THEN
      RAISE EXCEPTION 'Origem e auditoria da descrição não podem ser fornecidas na criação';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.imovel_observacoes_origem IS DISTINCT FROM OLD.imovel_observacoes_origem THEN
    IF OLD.imovel_observacoes_origem <> 'manual'
       OR NEW.imovel_observacoes_origem <> 'ia_matricula'
       OR current_setting('app.matricula_descricao', true) IS DISTINCT FROM 'extracao' THEN
      RAISE EXCEPTION 'Origem da descrição não pode ser alterada manualmente';
    END IF;
  END IF;
  IF OLD.imovel_observacoes_origem = 'ia_matricula'
     AND NEW.imovel_observacoes IS DISTINCT FROM OLD.imovel_observacoes THEN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = p.organization_id
      WHERE p.id = actor AND p.organization_id = OLD.organization_id
        AND r.role IN ('juridico'::public.app_role, 'admin'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Somente jurídico ou admin da imobiliária pode corrigir a descrição';
    END IF;
    NEW.imovel_descricao_corrigida_por := actor;
    NEW.imovel_descricao_corrigida_em := now();
  ELSIF NEW.imovel_descricao_corrigida_por IS DISTINCT FROM OLD.imovel_descricao_corrigida_por
     OR NEW.imovel_descricao_corrigida_em IS DISTINCT FROM OLD.imovel_descricao_corrigida_em THEN
    RAISE EXCEPTION 'Registro de correção não pode ser alterado';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_matricula_descricao BEFORE INSERT OR UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.enforce_matricula_descricao();
REVOKE ALL ON FUNCTION public.enforce_matricula_descricao() FROM PUBLIC, anon, authenticated;

-- Nunca aceita texto fornecido pelo navegador: usa a extração concluída da própria matrícula,
-- no escopo da venda, somente quando a descrição está vazia (preserva textos legados).
CREATE FUNCTION public.aplicar_descricao_matricula(_sale_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sale public.sales%ROWTYPE; v_texto text; actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor) THEN RETURN false; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor AND organization_id = v_sale.organization_id
  ) OR NOT public.can_view_sale(actor, _sale_id) THEN RETURN false; END IF;
  IF nullif(trim(v_sale.imovel_observacoes), '') IS NOT NULL
     OR v_sale.imovel_observacoes_origem <> 'manual' THEN RETURN false; END IF;
  SELECT nullif(trim(e.raw_json->>'observacoes_imovel'), '') INTO v_texto
    FROM public.document_extractions e
    JOIN public.sale_documents d ON d.id = e.document_id
      AND d.sale_id = e.sale_id AND d.organization_id = e.organization_id
   WHERE e.sale_id = _sale_id AND e.organization_id = v_sale.organization_id
     AND e.status = 'done' AND d.tipo = 'matricula' AND d.deleted_at IS NULL
     AND nullif(trim(e.raw_json->>'observacoes_imovel'), '') IS NOT NULL
   ORDER BY e.updated_at DESC LIMIT 1;
  IF v_texto IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.matricula_descricao', 'extracao', true);
  UPDATE public.sales SET imovel_observacoes = v_texto,
    imovel_observacoes_origem = 'ia_matricula' WHERE id = _sale_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.aplicar_descricao_matricula(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_descricao_matricula(uuid) TO authenticated;

-- O jurídico não depende do status da venda para corrigir: RPC verifica papel e agência
-- antes de usar o privilégio do definer, enquanto o trigger audita a alteração efetiva.
CREATE FUNCTION public.corrigir_descricao_matricula(_sale_id uuid, _descricao text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_active_user(actor)
     OR nullif(trim(_descricao), '') IS NULL OR length(_descricao) > 10000 THEN
    RETURN false;
  END IF;
  SELECT organization_id INTO v_org FROM public.sales WHERE id = _sale_id;
  IF v_org IS NULL OR NOT public.can_view_sale(actor, _sale_id) OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = p.organization_id
    WHERE p.id = actor AND p.organization_id = v_org
      AND r.role IN ('juridico'::public.app_role, 'admin'::public.app_role)
  ) THEN RETURN false; END IF;
  UPDATE public.sales SET imovel_observacoes = trim(_descricao)
    WHERE id = _sale_id AND imovel_observacoes_origem = 'ia_matricula'
      AND imovel_observacoes IS DISTINCT FROM trim(_descricao);
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.corrigir_descricao_matricula(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_descricao_matricula(uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Hoje "só o gestor edita a Divisão da comissão" só é travado na UI
-- (editableComissao em vendas.$id.tsx). Isso deixa aberto uma corretor
-- conseguir gravar esses campos via chamada direta à API durante a própria
-- janela de edição dele (ex.: rascunho/devolvida_ajuste/contrato_conferencia_corretor).
-- Esta migration espelha a mesma regra no banco.

-- Mesma lógica de can_edit_sale_stage, mas só pro conjunto "gestor pode editar
-- comissão" (financeiro/admin sempre podem; gestor só nos status que são a vez
-- dele e enquanto a venda não estiver travada por ocorrência aceita/concluída).
CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
    OR (
      public.has_role(_user, 'gestor'::public.app_role)
      AND NOT public.is_sale_locked(_sale_id)
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.id = _sale_id
        AND s.status::text = ANY(ARRAY[
          'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
          'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
        ])
      )
    );
$function$;

-- Trava por coluna na própria tabela sales (RLS não faz granularidade de coluna):
-- qualquer UPDATE que mude um dos campos da divisão de comissão exige
-- can_edit_sale_comissao, mesmo que o UPDATE como um todo já tenha passado pela
-- policy geral (ex.: corretor editando Partes/Documentos na mesma sessão).
CREATE OR REPLACE FUNCTION public.enforce_sale_comissao_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (
    NEW.percentual_comissao_captador IS DISTINCT FROM OLD.percentual_comissao_captador
    OR NEW.valor_comissao_captador IS DISTINCT FROM OLD.valor_comissao_captador
    OR NEW.percentual_comissao_vendedor IS DISTINCT FROM OLD.percentual_comissao_vendedor
    OR NEW.valor_comissao_vendedor IS DISTINCT FROM OLD.valor_comissao_vendedor
    OR NEW.indicador IS DISTINCT FROM OLD.indicador
    OR NEW.indicador_lado IS DISTINCT FROM OLD.indicador_lado
    OR NEW.percentual_comissao_indicador IS DISTINCT FROM OLD.percentual_comissao_indicador
    OR NEW.valor_comissao_indicador IS DISTINCT FROM OLD.valor_comissao_indicador
  ) AND NOT public.can_edit_sale_comissao(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Somente o gestor (ou financeiro/admin) pode editar a divisão da comissão desta venda.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sales_comissao_lock ON public.sales;
CREATE TRIGGER trg_sales_comissao_lock
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_comissao_lock();

-- sale_commission_extras existe só pra "Divisão da comissão" (partes extras),
-- então dá pra travar a tabela inteira: qualquer um que vê a venda continua
-- podendo ver as linhas, mas só quem pode editar comissão pode inserir/
-- atualizar/remover.
DROP POLICY IF EXISTS sale_commission_extras_rw ON public.sale_commission_extras;

CREATE POLICY sale_commission_extras_select ON public.sale_commission_extras
  FOR SELECT USING (public.can_view_sale(auth.uid(), sale_id));

CREATE POLICY sale_commission_extras_insert ON public.sale_commission_extras
  FOR INSERT WITH CHECK (public.can_edit_sale_comissao(auth.uid(), sale_id));

CREATE POLICY sale_commission_extras_update ON public.sale_commission_extras
  FOR UPDATE USING (public.can_edit_sale_comissao(auth.uid(), sale_id))
  WITH CHECK (public.can_edit_sale_comissao(auth.uid(), sale_id));

CREATE POLICY sale_commission_extras_delete ON public.sale_commission_extras
  FOR DELETE USING (public.can_edit_sale_comissao(auth.uid(), sale_id));

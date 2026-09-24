-- Capacidade estreita: certidões do Jurídico em venda padrão que comprovadamente
-- entrou na fila jurídica. Histórico legado é gravável por clientes autenticados;
-- portanto NÃO serve, isoladamente, como prova de passagem pela etapa.
BEGIN;

-- Marcador privado criado pelo banco no momento de uma transição real. O estado
-- atual elegível também é prova direta (e é semeado para sobreviver à próxima devolução).
CREATE TABLE public.sale_juridico_reached (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  reached_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.sale_juridico_reached FROM PUBLIC, anon, authenticated;
INSERT INTO public.sale_juridico_reached (sale_id)
SELECT s.id FROM public.sales s
WHERE s.modalidade = 'padrao' AND s.status::text IN (
  'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
  'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
  'aguardando_assinatura','contrato_assinado','ocorrencia_pendente',
  'ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
);

CREATE FUNCTION public.record_sale_juridico_reached()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.modalidade = 'padrao' AND NEW.status::text = 'aprovada_gestor'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.sale_juridico_reached(sale_id) VALUES (NEW.id)
    ON CONFLICT (sale_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_sale_juridico_reached() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_record_sale_juridico_reached AFTER UPDATE OF status ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.record_sale_juridico_reached();

CREATE FUNCTION public.can_read_sale_juridico_certidao(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.is_active_user(auth.uid())
    AND public.has_role(auth.uid(), 'juridico'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.sales s
      JOIN public.sale_juridico_reached r ON r.sale_id = s.id
      WHERE s.id = _sale_id AND s.modalidade = 'padrao'
        AND s.status::text IN (
          'enviada_revisao','devolvida_ajuste',
          'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
          'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
          'aguardando_assinatura','contrato_assinado','ocorrencia_pendente',
          'ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
        )
    ), false);
$$;
REVOKE ALL ON FUNCTION public.can_read_sale_juridico_certidao(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_sale_juridico_certidao(uuid) TO authenticated;

CREATE FUNCTION public.can_upload_juridico_certidao(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.can_read_sale_juridico_certidao(_sale_id)
    AND NOT public.is_sale_locked(_sale_id), false);
$$;
REVOKE ALL ON FUNCTION public.can_upload_juridico_certidao(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_juridico_certidao(uuid) TO authenticated;

-- Somente SELECT adicional, sem ampliar can_view_sale (que também governa escrita).
CREATE POLICY juridico_returned_sale_read ON public.sales FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(id));
CREATE POLICY juridico_returned_parties_read ON public.sale_parties FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_payment_read ON public.sale_payment FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_bank_read ON public.sale_bank_accounts FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_documents_read ON public.sale_documents FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_comments_read ON public.sale_comments FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_history_read ON public.sale_status_history FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_extras_read ON public.sale_commission_extras FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_activity_read ON public.activity_logs FOR SELECT TO authenticated
USING (public.can_read_sale_juridico_certidao(sale_id));
CREATE POLICY juridico_returned_storage_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sale-documents' AND EXISTS (
  SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name, '/', 1)
    AND public.can_read_sale_juridico_certidao(s.id)
));

-- A policy antiga segue intacta; ramo novo restringe bucket, venda e caminho.
CREATE POLICY juridico_certidao_storage_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'sale-documents'
  AND split_part(name, '/', 2) = 'juridico'
  AND split_part(name, '/', 3) = 'certidao_juridico'
  AND split_part(name, '/', 4) <> ''
  AND split_part(name, '/', 5) = ''
  AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id::text = split_part(name, '/', 1)
      AND public.can_upload_juridico_certidao(s.id)
  )
);

-- Preserva a RPC implantada, inclusive co-líder. Substitui somente as duas guardas,
-- falhando fechado se a definição implantada divergir. O ramo especial aceita só
-- documento enviado, sem extração, no caminho da própria venda.
DO $migration$
DECLARE
  definition text;
  old_view text := '(public.can_view_sale(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))';
  old_edit text := '(public.can_edit_sale_stage(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))';
  special text := $guard$(public.can_upload_juridico_certidao(_sale_id)
    AND _tipo = 'certidao_juridico' AND _parte = 'juridico'
    AND split_part(_storage_path, '/', 1) = _sale_id::text
    AND split_part(_storage_path, '/', 2) = 'juridico'
    AND split_part(_storage_path, '/', 3) = 'certidao_juridico'
    AND split_part(_storage_path, '/', 4) <> ''
    AND split_part(_storage_path, '/', 5) = ''
    AND _status = 'enviado'::public.doc_status
    AND _extraction_status = 'none')$guard$;
BEGIN
  definition := pg_get_functiondef('public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)'::regprocedure);
  IF definition IS NULL
     OR (length(definition) - length(replace(definition, old_view, ''))) / length(old_view) <> 1
     OR (length(definition) - length(replace(definition, old_edit, ''))) / length(old_edit) <> 1
     OR position('public.can_upload_juridico_certidao(_sale_id)' IN definition) > 0 THEN
    RAISE EXCEPTION 'Definição de insert_sale_document divergente; nenhuma permissão aplicada.';
  END IF;
  definition := replace(definition, old_view, '(' || old_view || ' OR ' || special || ')');
  definition := replace(definition, old_edit, '(' || old_edit || ' OR ' || special || ')');
  EXECUTE definition;
END;
$migration$;
COMMIT;

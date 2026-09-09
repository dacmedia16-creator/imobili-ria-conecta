-- Capacidade por venda, sem alterar can_view_sale/is_lead_of nem papéis globais.
-- A leitura canônica existente da auxiliar continua sendo pré-requisito.
BEGIN;

CREATE FUNCTION public.can_manage_sale_as_co_leader(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.can_read_principal_sale_as_co_leader(_sale_id)
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND s.modalidade = 'padrao');
$$;
REVOKE ALL ON FUNCTION public.can_manage_sale_as_co_leader(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_sale_as_co_leader(uuid) TO authenticated;

CREATE FUNCTION public.can_edit_sale_as_co_leader(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.can_manage_sale_as_co_leader(_sale_id)
    AND NOT public.is_sale_locked(_sale_id)
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id
      AND s.status::text = ANY(ARRAY['rascunho','enviada_revisao',
        'contrato_conferencia_gestor','contrato_ok_corretor','aguardando_assinatura',
        'contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']));
$$;
REVOKE ALL ON FUNCTION public.can_edit_sale_as_co_leader(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_as_co_leader(uuid) TO authenticated;

CREATE FUNCTION public.sale_management_capabilities(_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
   'can_manage', COALESCE(active AND manager AND accessible, false),
   'team_owner', COALESCE(active AND manager AND accessible AND (leader OR auxiliary), false),
   'can_edit', COALESCE(active AND manager AND accessible AND NOT public.is_sale_locked(_sale_id)
     AND (public.can_edit_sale_stage(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id)), false),
   'auxiliary', COALESCE(auxiliary, false)
 ) FROM (
   SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.ativo IS TRUE) active,
     public.has_any_role(auth.uid(), ARRAY['gestor','team_leader']::public.app_role[]) manager,
     public.can_view_sale(auth.uid(), _sale_id) OR public.can_manage_sale_as_co_leader(_sale_id) accessible,
     EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND public.is_lead_of(auth.uid(), s.corretor_id)) leader,
     public.can_manage_sale_as_co_leader(_sale_id) auxiliary
 ) capabilities;
$$;
REVOKE ALL ON FUNCTION public.sale_management_capabilities(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sale_management_capabilities(uuid) TO authenticated;

-- Somente o ramo novo ganha escrita. As policies existentes permanecem intactas.
CREATE POLICY co_leader_sale_update ON public.sales FOR UPDATE TO authenticated
USING (public.can_edit_sale_as_co_leader(id))
WITH CHECK (public.can_manage_sale_as_co_leader(id) AND NOT public.is_sale_locked(id));

CREATE POLICY co_leader_parties_write ON public.sale_parties FOR ALL TO authenticated
USING (public.can_edit_sale_as_co_leader(sale_id)) WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_payment_write ON public.sale_payment FOR ALL TO authenticated
USING (public.can_edit_sale_as_co_leader(sale_id)) WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_extras_write ON public.sale_commission_extras FOR ALL TO authenticated
USING (public.can_edit_sale_as_co_leader(sale_id)) WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_bank_read ON public.sale_bank_accounts FOR SELECT TO authenticated
USING (public.can_manage_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_bank_write ON public.sale_bank_accounts FOR ALL TO authenticated
USING (public.can_edit_sale_as_co_leader(sale_id)) WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_documents_read ON public.sale_documents FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.can_manage_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_documents_insert ON public.sale_documents FOR INSERT TO authenticated
WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_documents_update ON public.sale_documents FOR UPDATE TO authenticated
USING (deleted_at IS NULL AND public.can_edit_sale_as_co_leader(sale_id))
WITH CHECK (public.can_edit_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_comments_read ON public.sale_comments FOR SELECT TO authenticated
USING (public.can_manage_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_comments_insert ON public.sale_comments FOR INSERT TO authenticated
WITH CHECK (autor_id = auth.uid() AND public.can_manage_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_history_read ON public.sale_status_history FOR SELECT TO authenticated
USING (public.can_manage_sale_as_co_leader(sale_id));
CREATE POLICY co_leader_activity_read ON public.activity_logs FOR SELECT TO authenticated
USING (public.can_manage_sale_as_co_leader(sale_id));

-- Edição do espelho da própria venda, apenas antes do aceite financeiro.
-- Nenhuma permissão nova em pagamentos/recebimentos globais, perfis ou outras equipes.
CREATE POLICY co_leader_occurrence_write ON public.occurrences FOR ALL TO authenticated
USING (public.can_edit_sale_as_co_leader(sale_id))
WITH CHECK (public.can_edit_sale_as_co_leader(sale_id) AND NOT aceita_financeiro);
CREATE POLICY co_leader_commissions_write ON public.occurrence_commissions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_edit_sale_as_co_leader(o.sale_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_edit_sale_as_co_leader(o.sale_id)));
CREATE POLICY co_leader_partners_write ON public.occurrence_partners FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_edit_sale_as_co_leader(o.sale_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_edit_sale_as_co_leader(o.sale_id)));

-- Arquivos limitados ao bucket e à pasta UUID da venda autorizada.
CREATE POLICY co_leader_storage_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sale-documents' AND EXISTS (
 SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name, '/', 1)
 AND public.can_manage_sale_as_co_leader(s.id)));
CREATE POLICY co_leader_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sale-documents' AND EXISTS (
 SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name, '/', 1)
 AND public.can_edit_sale_as_co_leader(s.id)));
CREATE POLICY co_leader_storage_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'sale-documents' AND EXISTS (
 SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name, '/', 1)
 AND public.can_edit_sale_as_co_leader(s.id)))
WITH CHECK (bucket_id = 'sale-documents' AND EXISTS (
 SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name, '/', 1)
 AND public.can_edit_sale_as_co_leader(s.id)));

-- RLS consulta a linha persistida. Evitar troca de dono/id ou liberação do bloqueio
-- jurídico por alteração direta dessa linha no novo ramo de autorização.
CREATE FUNCTION public.enforce_co_leader_sale_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF public.can_manage_sale_as_co_leader(OLD.id)
    AND NOT public.can_view_sale(auth.uid(), OLD.id) THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id
      OR NEW.contrato_libera_assinatura IS DISTINCT FROM OLD.contrato_libera_assinatura THEN
     RAISE EXCEPTION 'A liderança auxiliar não pode transferir a venda nem alterar a liberação do jurídico.' USING ERRCODE = '42501';
   END IF;
   IF NOT public.can_edit_sale_as_co_leader(OLD.id) THEN
     RAISE EXCEPTION 'Venda somente leitura nesta etapa.' USING ERRCODE = '42501';
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'ocorrencia_concluida' THEN
     RAISE EXCEPTION 'A conclusão permanece sob responsabilidade do financeiro.' USING ERRCODE = '42501';
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text = 'aguardando_assinatura'
      AND OLD.status::text IN ('contrato_conferencia_gestor','contrato_ok_corretor') THEN
     IF OLD.contrato_libera_assinatura IS NOT TRUE THEN
       RAISE EXCEPTION 'Aguarde a liberação do jurídico para enviar à assinatura.' USING ERRCODE = '23514';
     END IF;
     IF NOT EXISTS (SELECT 1 FROM public.sale_documents d WHERE d.sale_id=OLD.id AND d.tipo='contrato' AND d.deleted_at IS NULL) THEN
       RAISE EXCEPTION 'Anexe o contrato antes de enviar à assinatura.' USING ERRCODE = '23514';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_co_leader_sale_scope() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_co_leader_sale_scope BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.enforce_co_leader_sale_scope();

-- A edição do espelho não autoriza aceite, baixa/recebimento nem conclusão financeira.
CREATE FUNCTION public.enforce_co_leader_occurrence_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF public.can_manage_sale_as_co_leader(NEW.sale_id)
    AND NOT public.can_view_sale(auth.uid(), NEW.sale_id) THEN
   IF NEW.aceita_financeiro OR NEW.status::text = 'concluida'
      OR NEW.prev_recebimento_recebido_em IS NOT NULL
      OR NEW.prev_recebimento_recebido_valor IS NOT NULL
      OR NEW.prev_recebimento2_recebido_em IS NOT NULL
      OR NEW.prev_recebimento2_recebido_valor IS NOT NULL
      OR NEW.prev_recebimento3_recebido_em IS NOT NULL
      OR NEW.prev_recebimento3_recebido_valor IS NOT NULL THEN
     RAISE EXCEPTION 'Aceite, recebimento e conclusão permanecem exclusivos do financeiro.' USING ERRCODE = '42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_co_leader_occurrence_scope() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_co_leader_occurrence_scope BEFORE INSERT OR UPDATE ON public.occurrences
FOR EACH ROW EXECUTE FUNCTION public.enforce_co_leader_occurrence_scope();

-- Alterações cirúrgicas das guardas do fluxo. Nenhum helper global é reescrito.
-- Falha fechada se a assinatura/guarda divergir; restante da definição fica intacto.
DO $migration$
DECLARE r record; definition text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.change_sale_status(uuid,text,text)', 'public.can_view_sale(auth.uid(), _sale_id)', '(public.can_view_sale(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1),
  ('public.validate_sale_status_transition()', 'public.is_lead_of(actor, old.corretor_id)', '(public.is_lead_of(actor, old.corretor_id) OR public.can_edit_sale_as_co_leader(old.id))', 2),
  ('public.enforce_sale_comissao_lock()', 'public.can_edit_sale_comissao(auth.uid(), OLD.id)', '(public.can_edit_sale_comissao(auth.uid(), OLD.id) OR public.can_edit_sale_as_co_leader(OLD.id))', 1),
  ('public.archive_sale_document(uuid)', 'public.can_view_sale(auth.uid(), _sale_id)', '(public.can_view_sale(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1),
  ('public.archive_sale_document(uuid)', 'public.can_edit_sale_stage(auth.uid(), _sale_id)', '(public.can_edit_sale_stage(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1),
  ('public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)', 'public.can_view_sale(auth.uid(), _sale_id)', '(public.can_view_sale(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1),
  ('public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)', 'public.can_edit_sale_stage(auth.uid(), _sale_id)', '(public.can_edit_sale_stage(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1),
  ('public.update_contrato_pendencia(uuid,text,boolean)', 'public.can_view_sale(auth.uid(), _sale_id)', '(public.can_view_sale(auth.uid(), _sale_id) OR public.can_edit_sale_as_co_leader(_sale_id))', 1)
 ) AS edits(signature, old_text, new_text, expected_count) LOOP
   definition := pg_get_functiondef(r.signature::regprocedure);
   IF (length(definition) - length(replace(definition, r.old_text, ''))) / length(r.old_text) <> r.expected_count
      OR position(r.new_text IN definition) > 0 THEN
     RAISE EXCEPTION 'Definição divergente: %', r.signature;
   END IF;
   EXECUTE replace(definition, r.old_text, r.new_text);
 END LOOP;
END;
$migration$;

COMMIT;

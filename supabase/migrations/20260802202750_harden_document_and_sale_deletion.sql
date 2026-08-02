-- 1) Storage do bucket sale-documents: INSERT/UPDATE/DELETE exigiam só can_view_sale (quem
-- consegue VER a venda já conseguia subir/apagar arquivo direto pela API do Storage, ignorando a
-- trava de etapa/travamento que a tela já aplicava). Alinha com o que a tabela sale_documents já
-- fazia certo (can_edit_sale_stage). SELECT continua igual — visualizar não muda.
DROP POLICY IF EXISTS docs_insert ON storage.objects;
CREATE POLICY docs_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'sale-documents'
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id::text = split_part(objects.name, '/', 1)
        AND public.can_edit_sale_stage((select auth.uid()), s.id)
    )
  );

DROP POLICY IF EXISTS docs_update ON storage.objects;
CREATE POLICY docs_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    bucket_id = 'sale-documents'
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id::text = split_part(objects.name, '/', 1)
        AND public.can_edit_sale_stage((select auth.uid()), s.id)
    )
  );

DROP POLICY IF EXISTS docs_delete ON storage.objects;
CREATE POLICY docs_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    bucket_id = 'sale-documents'
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id::text = split_part(objects.name, '/', 1)
        AND public.can_edit_sale_stage((select auth.uid()), s.id)
    )
  );

-- 2) sale_documents ganha arquivamento lógico — "excluir documento" na tela vai passar a marcar
-- deleted_at/deleted_by em vez de apagar a linha e o arquivo. Ninguém perde documento por engano.
ALTER TABLE public.sale_documents ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE public.sale_documents ADD COLUMN deleted_by UUID REFERENCES auth.users(id);

-- Documento arquivado some da consulta normal pra todo mundo, exceto admin/super_admin (auditoria).
-- sale_docs_update/insert/delete não mudam — já exigiam can_edit_sale_stage + trava corretamente.
DROP POLICY IF EXISTS sale_docs_select ON public.sale_documents;
CREATE POLICY sale_docs_select ON public.sale_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.can_view_sale((select auth.uid()), sale_id)
    AND (deleted_at IS NULL OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
  );

-- 3) Exclusão definitiva de venda só é permitida bem no início do fluxo (nada de contrato,
-- certidão ou ocorrência produzido ainda) — vale pra TODO MUNDO, inclusive admin/super_admin/
-- financeiro, que antes não tinham trava nenhuma e podiam apagar até venda com ocorrência
-- concluída. Depois disso, o caminho é Arquivar/Cancelar (muda status, preserva tudo).
DROP POLICY IF EXISTS delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    public.is_active_user((select auth.uid()))
    AND status = ANY (ARRAY['rascunho','devolvida_ajuste','enviada_revisao']::public.sale_status[])
    AND (
      public.has_any_role((select auth.uid()), ARRAY['super_admin','admin','financeiro']::public.app_role[])
      OR (corretor_id = (select auth.uid()))
      OR (public.has_role((select auth.uid()), 'gestor') AND public.is_lead_of((select auth.uid()), corretor_id))
    )
  );

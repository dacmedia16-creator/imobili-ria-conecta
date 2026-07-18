
ALTER TABLE public.sale_documents
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'none'
    CHECK (extraction_status IN ('none','pending','done','failed'));

CREATE TABLE IF NOT EXISTS public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.sale_documents(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  raw_json jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_extractions TO authenticated;
GRANT ALL ON public.document_extractions TO service_role;

ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view extractions if can view sale"
  ON public.document_extractions FOR SELECT TO authenticated
  USING (public.can_view_sale(auth.uid(), sale_id));

CREATE POLICY "insert extractions if can view sale"
  ON public.document_extractions FOR INSERT TO authenticated
  WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

CREATE POLICY "update extractions if can view sale"
  ON public.document_extractions FOR UPDATE TO authenticated
  USING (public.can_view_sale(auth.uid(), sale_id))
  WITH CHECK (public.can_view_sale(auth.uid(), sale_id));

CREATE POLICY "delete extractions if can view sale"
  ON public.document_extractions FOR DELETE TO authenticated
  USING (public.can_view_sale(auth.uid(), sale_id));

CREATE TRIGGER trg_document_extractions_updated_at
  BEFORE UPDATE ON public.document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_document_extractions_sale ON public.document_extractions(sale_id);

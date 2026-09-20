-- Auditoria mínima das consultas feitas pelo MAX Jurídico.
-- A tabela não é exposta ao cliente: somente o service role da Edge Function grava nela.
CREATE TABLE IF NOT EXISTS public.juridico_agent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name text NOT NULL CHECK (agent_name = 'max_juridico'),
  action text NOT NULL CHECK (action IN ('search', 'get')),
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.sale_documents(id) ON DELETE SET NULL,
  result_count integer NOT NULL CHECK (result_count >= 0),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS juridico_agent_audit_created_at_idx
  ON public.juridico_agent_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS juridico_agent_audit_sale_id_idx
  ON public.juridico_agent_audit (sale_id, created_at DESC);

ALTER TABLE public.juridico_agent_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.juridico_agent_audit FROM anon, authenticated;
GRANT ALL ON TABLE public.juridico_agent_audit TO service_role;

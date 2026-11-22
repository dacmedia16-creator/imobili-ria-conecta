-- Feedback ao Proprietário: lançamento MANUAL de tráfego pago (Meta Ads, Google Ads, Outro) por imóvel e período
-- (cartão t_f3f64be0, pedido de Denis 22/11/2026, tópico 6238).
-- ADITIVA: cria 1 tabela e 1 função de gatilho. NÃO altera portal_listing_snapshots, a coleta, nem nenhuma
-- função/política existente.
--
-- Ligação: pelo CÓDIGO do anúncio (listing_code), igual a owner_feedback_action_done — é a chave da tela /feedback
-- e a mesma usada pela regra de permissão. code_key (portal_code_key) junta as variações x/hífen/zeros.
-- Quem pode ler/criar/editar/apagar: a MESMA regra do Feedback (owner_feedback_can_edit): o corretor responsável
-- (captador atual quando há captação ligada; senão o corretor do anúncio), o gestor/team leader dele e o admin
-- da imobiliária. Isolamento por imobiliária, usuário ativo e módulo Feedback ligado são RESTRITIVOS.
-- Anon sem acesso. Valores: números >= 0 e fim >= início. O valor investido é dado interno: o app nunca o
-- coloca no PDF/WhatsApp/IA do proprietário (regra no código; o banco só guarda).
-- Rollback: supabase/rollback/20261224120000_feedback_trafego_pago.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.listing_paid_traffic_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_code text NOT NULL CHECK (length(btrim(listing_code)) BETWEEN 3 AND 60),
  code_key text NOT NULL,
  canal text NOT NULL CHECK (canal IN ('meta', 'google', 'outro')),
  inicio date NOT NULL,
  fim date NOT NULL,
  visualizacoes integer NOT NULL DEFAULT 0 CHECK (visualizacoes BETWEEN 0 AND 100000000),
  contatos integer NOT NULL DEFAULT 0 CHECK (contatos BETWEEN 0 AND 10000000),
  investimento numeric(12,2) CHECK (investimento IS NULL OR investimento BETWEEN 0 AND 10000000),
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_paid_traffic_periodo CHECK (fim >= inicio),
  CONSTRAINT listing_paid_traffic_periodo_max CHECK (fim - inicio <= 366)
);
CREATE INDEX IF NOT EXISTS listing_paid_traffic_org_key
  ON public.listing_paid_traffic_entries (organization_id, code_key, inicio);
CREATE INDEX IF NOT EXISTS listing_paid_traffic_created_by
  ON public.listing_paid_traffic_entries (created_by);
CREATE INDEX IF NOT EXISTS listing_paid_traffic_updated_by
  ON public.listing_paid_traffic_entries (updated_by);
COMMENT ON TABLE public.listing_paid_traffic_entries IS
  'Tráfego pago lançado à mão por imóvel e período (Feedback ao Proprietário, t_f3f64be0). investimento = interno.';

-- Auditoria e campos do servidor: code_key calculado, datas e autores do servidor; na edição não troca
-- imobiliária, anúncio, autor nem criação.
CREATE OR REPLACE FUNCTION public.listing_paid_traffic_audit()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.listing_code := btrim(NEW.listing_code);
    NEW.created_at := now();
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
  ELSIF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.listing_code IS DISTINCT FROM OLD.listing_code
     -- Autor só pode virar NULL (ON DELETE SET NULL quando o usuário é apagado); trocar por outro, não.
     OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Não é possível mudar o imóvel, a imobiliária ou o autor do lançamento' USING ERRCODE = '42501';
  END IF;
  NEW.code_key := public.portal_code_key(NEW.listing_code);
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.listing_paid_traffic_audit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_listing_paid_traffic_audit ON public.listing_paid_traffic_entries;
CREATE TRIGGER trg_listing_paid_traffic_audit BEFORE INSERT OR UPDATE ON public.listing_paid_traffic_entries
  FOR EACH ROW EXECUTE FUNCTION public.listing_paid_traffic_audit();

ALTER TABLE public.listing_paid_traffic_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_paid_traffic_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listing_paid_traffic_entries TO authenticated;
GRANT ALL ON public.listing_paid_traffic_entries TO service_role;

-- Restritivas: imobiliária da sessão, usuário ativo (exclui só-fotógrafo/só-Locação) e módulo Feedback ligado.
DROP POLICY IF EXISTS org_isolation ON public.listing_paid_traffic_entries;
CREATE POLICY org_isolation ON public.listing_paid_traffic_entries AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS usuario_ativo ON public.listing_paid_traffic_entries;
CREATE POLICY usuario_ativo ON public.listing_paid_traffic_entries AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
DROP POLICY IF EXISTS zz_mt_modulo_feedback ON public.listing_paid_traffic_entries;
CREATE POLICY zz_mt_modulo_feedback ON public.listing_paid_traffic_entries AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.owner_feedback_enabled())) WITH CHECK ((SELECT public.owner_feedback_enabled()));

-- Permissiva única: mesma regra das marcações do Feedback (responsável, gestor/TL dele, admin).
DROP POLICY IF EXISTS listing_paid_traffic_responsavel ON public.listing_paid_traffic_entries;
CREATE POLICY listing_paid_traffic_responsavel ON public.listing_paid_traffic_entries FOR ALL TO authenticated
  USING ((SELECT public.owner_feedback_can_edit(listing_code)))
  WITH CHECK ((SELECT public.owner_feedback_can_edit(listing_code)));

COMMIT;

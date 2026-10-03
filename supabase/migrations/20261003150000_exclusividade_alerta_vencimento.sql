-- Alerta semanal de vencimento das exclusividades (WhatsApp): registro de entregas por semana/destinatário,
-- para não repetir o aviso. Só o servidor (service_role) lê/grava.
-- Rollback: docs/sql/rollback/20261003150000_exclusividade_alerta_vencimento.rollback.sql
BEGIN;
CREATE TABLE public.exclusive_expiry_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  week_start date NOT NULL,
  recipient_id uuid NOT NULL,
  items integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, recipient_id)
);
ALTER TABLE public.exclusive_expiry_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusive_expiry_alert_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exclusive_expiry_alert_deliveries TO service_role;
COMMIT;

-- CATCH-UP: occurrence_commissions.sale_commission_extra_id existe em produção mas nenhuma
-- migration deste repositório a criava — a migration seguinte (20260727030000, índice) e
-- 20260809010000 (troca o FK pra ON DELETE CASCADE, documentando que ele "estava ON DELETE SET
-- NULL" antes) já assumem que ela existe. Quebra um replay do zero num Postgres limpo com "column
-- sale_commission_extra_id does not exist".
--
-- Recriada aqui como estava originalmente por essa mesma evidência (nullable, ON DELETE SET NULL)
-- — 20260809010000, que já existe, troca pra CASCADE depois, então esta migration não duplica
-- essa decisão. sale_commission_extras (tabela referenciada) já existe desde 20260722070000.
-- Puramente aditivo e idempotente (IF NOT EXISTS): a coluna já existe em produção com esse
-- formato, então rodar isso lá seria um no-op.
ALTER TABLE public.occurrence_commissions
  ADD COLUMN IF NOT EXISTS sale_commission_extra_id uuid REFERENCES public.sale_commission_extras(id) ON DELETE SET NULL;

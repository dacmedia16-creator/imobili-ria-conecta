-- Recuperado de supabase_migrations.schema_migrations (versão 20260727022436) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Financeiro precisa controlar o que ja foi recebido de fato x o que ainda esta previsto -- hoje
-- o relatorio "Fluxo de caixa" so compara a data prevista com a data de hoje ("Vencido"/"A vencer"),
-- sem nenhuma confirmacao real de que o dinheiro entrou. Acrescenta data+valor de recebimento
-- efetivo pra cada uma das 3 parcelas ja existentes (mesmo padrao de colunas, sem tabela nova).
ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS prev_recebimento_recebido_em date,
  ADD COLUMN IF NOT EXISTS prev_recebimento_recebido_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS prev_recebimento2_recebido_em date,
  ADD COLUMN IF NOT EXISTS prev_recebimento2_recebido_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS prev_recebimento3_recebido_em date,
  ADD COLUMN IF NOT EXISTS prev_recebimento3_recebido_valor numeric(14,2);

-- Trava por coluna (RLS nao faz granularidade de coluna): occ_write ja deixa financeiro/admin/
-- super_admin/gestor escreverem em occurrences -- sem essa trava, um gestor poderia dar baixa
-- num recebimento que e controle exclusivo do financeiro.
CREATE OR REPLACE FUNCTION public.enforce_occurrence_recebido_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (
    NEW.prev_recebimento_recebido_em IS DISTINCT FROM OLD.prev_recebimento_recebido_em
    OR NEW.prev_recebimento_recebido_valor IS DISTINCT FROM OLD.prev_recebimento_recebido_valor
    OR NEW.prev_recebimento2_recebido_em IS DISTINCT FROM OLD.prev_recebimento2_recebido_em
    OR NEW.prev_recebimento2_recebido_valor IS DISTINCT FROM OLD.prev_recebimento2_recebido_valor
    OR NEW.prev_recebimento3_recebido_em IS DISTINCT FROM OLD.prev_recebimento3_recebido_em
    OR NEW.prev_recebimento3_recebido_valor IS DISTINCT FROM OLD.prev_recebimento3_recebido_valor
  ) AND NOT public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente financeiro/admin pode registrar recebimento de comissao.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_occurrence_recebido_lock ON public.occurrences;
CREATE TRIGGER trg_enforce_occurrence_recebido_lock
BEFORE UPDATE ON public.occurrences
FOR EACH ROW EXECUTE FUNCTION public.enforce_occurrence_recebido_lock();

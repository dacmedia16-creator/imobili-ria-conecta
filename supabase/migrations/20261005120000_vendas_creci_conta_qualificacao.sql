-- Campos opcionais. A ausência de flag nas vendas anteriores mantém a inferência em leitura:
-- contas distintas por vendedor => individuais; iguais/uma só => conta única.
-- Nenhuma linha existente é atualizada ou excluída. RLS/GRANTs atuais permanecem inalterados.
ALTER TABLE public.sales
  ADD COLUMN contas_vendedores_individuais boolean,
  ADD COLUMN parceria_creci_tipo text CHECK (parceria_creci_tipo IN ('F', 'J')),
  ADD COLUMN parceria_creci text;

ALTER TABLE public.sale_parties
  ADD COLUMN nacionalidade text,
  ADD COLUMN estado_civil text,
  ADD COLUMN conjuge_nome text,
  ADD COLUMN conjuge_nacionalidade text,
  ADD COLUMN conjuge_profissao text,
  ADD COLUMN conjuge_rg text,
  ADD COLUMN conjuge_cpf text,
  ADD COLUMN conjuge_endereco text;

ALTER TABLE public.sale_commission_extras
  ADD COLUMN creci_tipo text CHECK (creci_tipo IN ('F', 'J')),
  ADD COLUMN creci text;
ALTER TABLE public.occurrence_commissions
  ADD COLUMN creci_tipo text CHECK (creci_tipo IN ('F', 'J')),
  ADD COLUMN creci text;
ALTER TABLE public.occurrence_partners
  ADD COLUMN creci_tipo text CHECK (creci_tipo IN ('F', 'J')),
  ADD COLUMN creci text;

-- O valor para conta única mora em sale_bank_accounts.parte='recebimento'. A chave
-- UNIQUE(sale_id,parte) já existe; as linhas vendedor_N legadas não são tocadas.
-- A FK composta (sale_id,organization_id) e o RLS existente continuam valendo.
NOTIFY pgrst, 'reload schema';

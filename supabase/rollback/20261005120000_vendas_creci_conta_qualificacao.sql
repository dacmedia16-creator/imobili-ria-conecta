-- Reversão EXCLUSIVAMENTE em homologação, após backup e retirada do código dependente.
-- Descarta valores que tenham sido criados nas colunas novas; NÃO toca em sale_bank_accounts.
BEGIN;
ALTER TABLE public.occurrence_partners DROP COLUMN creci_tipo, DROP COLUMN creci;
ALTER TABLE public.occurrence_commissions DROP COLUMN creci_tipo, DROP COLUMN creci;
ALTER TABLE public.sale_commission_extras DROP COLUMN creci_tipo, DROP COLUMN creci;
ALTER TABLE public.sale_parties DROP COLUMN nacionalidade, DROP COLUMN estado_civil,
  DROP COLUMN conjuge_nome, DROP COLUMN conjuge_nacionalidade, DROP COLUMN conjuge_profissao,
  DROP COLUMN conjuge_rg, DROP COLUMN conjuge_cpf, DROP COLUMN conjuge_endereco;
ALTER TABLE public.sales DROP COLUMN contas_vendedores_individuais,
  DROP COLUMN parceria_creci_tipo, DROP COLUMN parceria_creci;
COMMIT;
NOTIFY pgrst, 'reload schema';

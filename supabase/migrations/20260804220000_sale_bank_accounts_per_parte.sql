-- Cada vendedor/proprietário passa a ter sua própria conta bancária (antes era um registro único
-- por venda inteira, ignorando o 2º+ vendedor quando existia mais de um). `parte` identifica a
-- qual vendedor_N essa conta pertence, igual à convenção já usada em sale_documents/sale_parties.
ALTER TABLE public.sale_bank_accounts ADD COLUMN parte TEXT;
UPDATE public.sale_bank_accounts SET parte = 'vendedor_1' WHERE parte IS NULL;
ALTER TABLE public.sale_bank_accounts ALTER COLUMN parte SET NOT NULL;
ALTER TABLE public.sale_bank_accounts ADD CONSTRAINT sale_bank_accounts_sale_id_parte_key UNIQUE (sale_id, parte);

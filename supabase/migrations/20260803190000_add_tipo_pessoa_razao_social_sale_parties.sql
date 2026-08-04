-- Comprador/vendedor pode ser pessoa jurídica (CNPJ) — tipo_pessoa decide qual checklist de
-- documentos pessoais se aplica (RG/CPF/Certidão para física, Cartão CNPJ/Última Alteração
-- Contratual para jurídica). cpf_cnpj já existente passa a guardar o CNPJ nesse caso; só falta
-- a razão social, que não tem onde ir hoje.
ALTER TABLE public.sale_parties ADD COLUMN tipo_pessoa TEXT NOT NULL DEFAULT 'fisica' CHECK (tipo_pessoa IN ('fisica','juridica'));
ALTER TABLE public.sale_parties ADD COLUMN razao_social TEXT;

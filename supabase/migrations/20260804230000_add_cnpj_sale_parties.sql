-- Pessoa jurídica passa a exigir os MESMOS dados do representante legal (física) MAIS os dados da
-- empresa — não troca mais um pelo outro. cpf_cnpj (existente) passa a guardar sempre o CPF do
-- representante; cnpj (novo) guarda o CNPJ da empresa, coexistindo na mesma parte.
ALTER TABLE public.sale_parties ADD COLUMN cnpj TEXT;

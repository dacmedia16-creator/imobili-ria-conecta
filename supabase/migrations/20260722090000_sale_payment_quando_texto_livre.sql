-- Os campos "— data" do Pagamento viram texto livre ("Na assinatura do contrato", "30 dias após
-- a entrega das chaves"...) em vez de exigir uma data de calendário certa, que raramente se sabe
-- de antemão nesse momento da venda. Nenhum outro lugar do sistema lê essas colunas como data
-- (confirmado por busca no repo), então a conversão de tipo é segura — valores já preenchidos
-- viram a data em texto (ex.: "2026-08-15"), preservando o que já foi digitado.
ALTER TABLE public.sale_payment
  ALTER COLUMN entrada_data TYPE text USING entrada_data::text,
  ALTER COLUMN parcela1_data TYPE text USING parcela1_data::text,
  ALTER COLUMN parcela2_data TYPE text USING parcela2_data::text,
  ALTER COLUMN pagamento_final_data TYPE text USING pagamento_final_data::text;

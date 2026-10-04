-- Endereço do imóvel em partes (relatório por bairro/cidade). O texto livre imovel_endereco continua.
alter table public.sales
  add column if not exists imovel_cep text,
  add column if not exists imovel_logradouro text,
  add column if not exists imovel_numero text,
  add column if not exists imovel_complemento text,
  add column if not exists imovel_bairro text,
  add column if not exists imovel_cidade text,
  add column if not exists imovel_uf text;

alter table public.sales
  add constraint sales_imovel_cep_formato check (imovel_cep is null or imovel_cep ~ '^[0-9]{8}$'),
  add constraint sales_imovel_uf_formato check (imovel_uf is null or imovel_uf ~ '^[A-Z]{2}$');

create index if not exists sales_imovel_bairro_cidade_idx on public.sales (imovel_cidade, imovel_bairro);

-- 20261123120000 Locação cliente preenche: execute o script canônico
-- supabase/rollback/20261123120000_locacao_cliente_preenche.sql em transação,
-- após voltar o código do site. Ele restaura as funções anteriores e revoga links;
-- rascunhos/clientes da tabela locacao_links serão apagados. Documentos já
-- finalizados em locacao_documentos e no bucket privado NÃO são removidos.
-- Em produção: exporte as tabelas locacao_link_* antes; valide em homologação.
\ir ../../../supabase/rollback/20261123120000_locacao_cliente_preenche.sql

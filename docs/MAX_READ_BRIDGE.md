# Ponte de leitura do MAX

Objetivo: permitir consultas internas e auditáveis do MAX ao ADM MAX sem expor
`service_role`, liberar SQL arbitrário ou conceder escrita nas tabelas de negócio.

Primeiras operações permitidas:

- `count_active_corretores` — total de perfis ativos com papel `corretor`;
- `find_corretor` — busca limitada por nome, sem e-mail, telefone, documento ou banco.

Segurança:

- chamada servidor a servidor assinada por HMAC SHA-256;
- validade de 60 segundos;
- nonce único persistido para bloquear repetição;
- allowlist fixa de operações;
- auditoria sem payload, segredo ou PII;
- respostas com campos mínimos;
- nenhuma rota de escrita em dados de negócio.

Segredos necessários no ambiente seguro da Edge Function:

- `MAX_READ_HMAC_SECRET`;
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` fornecidos pelo Supabase.

O segredo correspondente do cliente deve ficar no ambiente do OpenClaw e nunca
ser enviado por Telegram, salvo no repositório ou registrado em logs.

Implantação exige aprovação, aplicação da migration, configuração do segredo,
deploy da função e testes positivo/negativos. Rollback: remover o deploy da
função; a tabela de auditoria pode permanecer inerte para preservar evidência.

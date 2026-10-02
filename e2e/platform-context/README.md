# Teste de telas — contexto do super-admin da plataforma (Parte 2/3)

Mock local de Supabase (GoTrue + PostgREST) com dados 100% fictícios, mais um roteiro Playwright.
Nenhuma chamada externa e nenhuma chave real.

1. `node e2e/platform-context/mock-supabase.mjs` (porta 54399)
2. `VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_PUBLISHABLE_KEY=mock-anon-key SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_PUBLISHABLE_KEY=mock-anon-key SUPABASE_SERVICE_ROLE_KEY=mock-service-key npx vite dev --host 127.0.0.1 --port 8091 --strictPort`
3. `OUT_DIR=/tmp/prints node e2e/platform-context/e2e.mjs` (precisa do pacote `playwright`; o caminho de `createRequire` no topo aponta para uma instalação local e deve ser ajustado)

Cenários: (a) super-admin abre no Painel; (b) entra na Única e numa 2ª imobiliária fictícia e a faixa mostra o nome certo; (c) Sair volta ao Painel; (d) contexto expirado volta ao Painel com aviso; (e) usuário comum não vê faixa, menu nem Painel.

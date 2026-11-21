# Qualidade no ADM MAX

Aprovado por Denis em 21/11/2026 (t_afb2ffe8). Ideias do fluxo do gstack (github.com/garrytan/gstack); o gstack
não é instalado.

## 1. Correção de erro: teste primeiro

- Em toda correção de erro, escreva ANTES um teste vitest que reproduz o erro e falha. Depois corrija e mostre o
  mesmo teste passando. Assim o erro não volta sem ninguém perceber.
- Exceção: erro puramente visual ou de texto (cor, espaço, rótulo, ortografia). Nesse caso basta o print
  antes/depois.
- Na entrega, cite o nome do teste e o resultado "falhou antes / passa depois".

## 2. Conferência logada depois de publicar

`npm run deploy:safe`, depois de publicar, abre as telas principais (Início, Vendas, Captações, Metas, Locação,
Financeiro) logado com a conta ADMIN de teste da REMAX - Conferência MAX e volta a versão anterior se alguma
quebrar (tela de erro, erro de JavaScript, erro 5xx, cair no login ou tela sem conteúdo).

- Script: `scripts/smoke-telas-logado.mjs`. Só leitura: escritas no banco são bloqueadas no navegador do teste;
  a ficha pessoal e o tour são dados como resolvidos só nesse navegador (a conta não muda).
- Configuração fora do repositório (sem segredos aqui): `/root/.config/max/deploy-smoke.env`
  (`SMOKE_SESSAO_CRIAR`, `SMOKE_SESSAO_ENCERRAR`, `PLAYWRIGHT_DIR`). Sem esse arquivo, só a validação pública roda.
- A sessão de teste é criada ANTES de publicar (se falhar, nada é publicado) e encerrada sempre no fim.
- Desligar numa emergência: `SMOKE_LOGADO=pular npm run deploy:safe`.
- Prints de falha: `.deploy/smoke-falhas/` (fora do git).
- Tempo: cerca de 20 s a mais no deploy.

## 3. CI no GitHub

`.github/workflows/ci.yml` roda testes + build em todo push na `main` e em todo PR, em segundo plano, no GitHub.
O lint roda só nos arquivos `.ts/.tsx` alterados e é informativo (o lint do repositório inteiro ainda não fecha).
O CI não publica, não usa segredos e não trava o fluxo: o portão de produção continua sendo o `deploy:safe`.
Custo: repositório público com runner padrão = gratuito, sem limite de minutos.

# Monitoramento do ADM MAX

Aprovado por Denis em 22/11/2026 (t_59e94d27, prioridade 2 do boletim t_9c02ccf5). Custo: R$ 0.

## 1. Monitor de queda (fora do repositório, já ligado)

- Na VPS: `/data/hermes-workspaces/max-tecnologia/monitor-adm/monitor_adm.py`, chamado a cada 5 min pelo
  crontab do root (`cron.sh`).
- Checa `https://app.somosunihub.com.br/` (passa pelo Worker) e `/manifest.webmanifest` (rota leve).
- Avisa no Telegram (grupo técnico, tópico 6238) só depois de **2 falhas seguidas** e avisa quando volta.
- Desligar: apagar a linha `monitor-adm` do `crontab -e`.

## 2. Erros do Worker (Workers Logs da Cloudflare)

- `wrangler.toml` → `[observability] enabled = true`. Plano grátis: até 0,5 GB/dia e 7 dias de retenção
  (passando do limite, a Cloudflare só para de guardar até 00:00 UTC, sem cobrar).
- `invocation_logs = false`: a Cloudflare não guarda a linha automática de cada pedido (URL, IP e cabeçalhos).
  Ficam só as linhas escritas pelo código.
- Os erros do servidor (`src/server.ts`, `src/start.ts`) saem como 1 linha JSON mascarada
  (`src/lib/log-seguro.ts`: e-mail, CPF, CNPJ, telefone, tokens e chaves viram marcadores).
- Onde ver: painel da Cloudflare → Workers → imobili-ria-conecta → Logs. Filtre por `tipo = erro`.

## 3. Erros do navegador

- `src/lib/erros-front.ts`: erros não tratados e a tela de erro mandam um resumo mascarado (mensagem,
  8 linhas de pilha, rota com ids trocados por `:id` e navegador resumido) para `POST /api/erros-front`.
  São no máximo 5 por página, sem repetir a mesma mensagem.
- `/api/erros-front` mascara de novo e só escreve 1 linha no Workers Logs. Não grava no banco e não
  envia nada para terceiros.

## 4. Resumo diário de erros (só avisa quando há erro)

- `scripts/resumo-erros-diario.ts` (texto em `src/lib/resumo-erros.ts`) lê o dia anterior (horário de Brasília):
  - Analytics da Cloudflare: 5xx e exceções do Worker;
  - Logs do Supabase: Edge Functions com 5xx, linhas de erro dentro das Edge Functions e 5xx da API.
- Dia sem erro: nenhuma mensagem. Se uma fonte não puder ser lida, o resumo avisa isso.
- Na VPS: `/data/hermes-workspaces/max-tecnologia/monitor-adm/resumo-erros.sh` (lê as credenciais que já
  existem na VPS). Sem `--enviar`, só mostra o texto.
- Ligar (depois da publicação): no crontab, adicionar
  `0 11 * * * /usr/bin/bash /data/hermes-workspaces/max-tecnologia/monitor-adm/resumo-erros.sh --enviar`
  (8h de Brasília).

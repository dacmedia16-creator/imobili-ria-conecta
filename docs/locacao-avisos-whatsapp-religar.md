# Avisos de WhatsApp da Locação — como estão e como religar

Publicado DESLIGADO em 16/11/2026 (cartão t_3194d2d4, autorização do Denis: "pode publicar sem WhatsApp").
**Religar só com nova autorização do Denis.**

## Como está agora
- Quando a gestora/contratos manda a minuta, cobra pendência, pede ajuste, devolve a locação ou registra um andamento
  "aguardando corretor", o banco grava um aviso na tabela `locacao_avisos` com situação **pendente**.
- O envio é feito pelo servidor do site (`src/lib/locacao-avisos.functions.ts`). Ele só envia se a variável do Worker
  **`LOCACAO_AVISOS_WHATSAPP` for exatamente `on`**. Hoje ela **não existe** no Worker, então o envio para logo na
  primeira linha, antes de mexer na fila e antes de ler a chave do ZionTalk. Resultado: nada sai e o aviso fica pendente.
- A chave do ZionTalk (`ZIONTALK_API_KEY`) **não foi alterada** e os avisos de **vendas** continuam iguais.
- Aviso pendente com mais de 24 h vira **expirado** sozinho na próxima vez que alguém mexer naquela locação.

## Antes de religar: o que fazer com os avisos acumulados (NÃO mandar em lote)
Se religar sem limpar, a próxima ação em cada locação mandaria até 5 avisos antigos (das últimas 24 h) de uma vez.
Por isso, **no mesmo momento de religar**, marque os pendentes antigos como expirados (não apaga nada, fica o histórico):

```sql
-- conferir quantos são
select status, count(*) from public.locacao_avisos group by status;
-- expirar os pendentes acumulados (rodar imediatamente antes de ligar a variável)
update public.locacao_avisos
   set status = 'expirado', erro = 'acumulado com o envio desligado (t_3194d2d4)'
 where status = 'pendente';
```

Só pule esse passo se o Denis decidir, por escrito, que os acumulados devem sair.

## Como religar (com autorização)
1. Rodar a limpeza acima e conferir que não ficou nenhum `pendente`.
2. No Cloudflare, Worker `imobili-ria-conecta` → Settings → Variables and Secrets → adicionar a variável de texto
   `LOCACAO_AVISOS_WHATSAPP` = `on` → Deploy.
   (ou pelo terminal, no clone da main: `npx wrangler secret put LOCACAO_AVISOS_WHATSAPP` e digitar `on`.)
   O `wrangler.toml` tem `keep_vars = true`, então o próximo `deploy:safe` não apaga a variável.
3. Teste controlado: uma ação numa locação de teste da Conferência MAX com o corretor de teste com telefone próprio;
   conferir `locacao_avisos.status = 'enviado'` só daquele aviso.

## Como desligar de novo
Apagar a variável `LOCACAO_AVISOS_WHATSAPP` (ou trocar para `off`) e fazer Deploy no painel. Efeito imediato,
sem mexer no código nem na chave.

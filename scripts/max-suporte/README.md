# MAX no canal "Ajuda e sugestões"

Pedido de Denis em 09/10/2026 (tópico 6238). Rascunho: nada é ligado sem o ok dele.

## Acesso (migration 20261009030000)

Papel Postgres próprio `max_suporte_bot`, que nasce **sem login**. Ele não usa service_role, não usa
a chave da IA e não é um usuário do app. Pode apenas executar 4 funções do schema `max_suporte`, que
fica fora da API REST:

| Função | O que faz |
|---|---|
| `pendentes(_desde, _limite)` | Chamados abertos cuja última mensagem pública é do usuário |
| `chamado(id)` | Chamado aberto, rota da tela, conversa e primeiro nome do autor. Não traz ids, e-mail, telefone nem print |
| `responder(id, texto, status)` | Grava resposta pública assinada "— MAX", muda o status para `respondido` ou `em_analise` e avisa o autor no sino |
| `mudar_status(id, status)` | Muda o status apenas para `em_analise` ou `respondido` |

O MAX **não pode**:

- ler tabelas;
- apagar ou editar mensagens;
- escrever nota interna;
- marcar um chamado como `resolvido`;
- ver o print;
- usar as RPCs do app, mesmo se tentar fingir ser da equipe.

Freios:

- não responde duas vezes seguidas;
- não responde chamado resolvido;
- envia no máximo 30 respostas por hora.

## Credencial

O arquivo `/root/.hermes/profiles/max/secrets/max-suporte.env` deve ter permissão 600 e ficar fora
do repositório. O script recusa o arquivo se a permissão estiver mais aberta. A senha nunca vai para
log, chat, comentário ou repositório: `ativar_credencial.py` gera a senha localmente e envia ao banco
somente o verificador SCRAM.

```
python3 scripts/max-suporte/ativar_credencial.py --alvo homolog
MAX_SUPORTE_PGHOST_PRODUCAO=<host do pooler> \
  python3 scripts/max-suporte/ativar_credencial.py --alvo producao --aprovado-por-denis
python3 scripts/max-suporte/ativar_credencial.py --alvo producao --desligar   # desliga na hora
```

## Verificador barato, a cada 15 minutos

`python3 scripts/max-suporte/max_suporte.py verificar` não usa IA. Ele faz 1 consulta e devolve uma
destas saídas:

- `fora_do_horario`: fora da janela das 8h às 20h em São Paulo; nesse caso, nem consulta o banco;
- `sem_novidade`: não há chamado novo nem resposta nova;
- uma linha por chamado, no formato `chamado N id=… tipo=… status=… ultima_msg_usuario=…`, ordenada.

A cron do Hermes usa esse comando como `monitor`. Quando a saída é igual à anterior, a IA não roda.
A IA só acorda quando um usuário escreve.

Depois que a IA cuida de um chamado:

- `responder ID arquivo.txt`: responde e o chamado sai da fila;
- `status ID em_analise` + `tratado ID`: o chamado foi encaminhado a Denis e sai da saída do
  verificador até o usuário escrever de novo.

## Testes e rollback

- Banco, em transação desfeita na homologação:
  `PGCONN=… bash supabase/tests/run-ajuda-acesso-max.sh` (35 verificações) e `… --rollback`.
- Script, sem banco: `python3 scripts/max-suporte/test_max_suporte.py`.
- Rollback: `supabase/rollback/20261009030000_ajuda_acesso_max.sql`.
- Para desligar na hora, sem rollback: `ALTER ROLE max_suporte_bot NOLOGIN;`.

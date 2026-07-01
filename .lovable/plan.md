## Problema

O erro na tela agora não é mais do `/auth` — é do sino de notificações (`NotificationBell`). O log diz:

> cannot add `postgres_changes` callbacks for realtime:notif-<user-id> after `subscribe()`.

Isso acontece porque `supabase.channel("notif-<user-id>")` reaproveita o canal já existente quando o efeito roda de novo (React Strict Mode roda o `useEffect` duas vezes em dev, e o TanStack Router remonta o layout ao trocar de rota). Na segunda execução, o canal antigo ainda existe com `subscribe()` chamado, e ao encadear `.on(...)` de novo o Realtime rejeita — jogando o erro para o error boundary do root, que mostra "This page didn't load".

## Correção

Editar **apenas** `src/components/NotificationBell.tsx`:

1. Gerar um nome de canal único por montagem (ex.: `notif-${user.id}-${crypto.randomUUID()}`) para não colidir com um canal ainda não removido.
2. Manter a mesma ordem `channel().on(...).subscribe()` e continuar removendo com `supabase.removeChannel(ch)` no cleanup.

Sem mexer em nenhum outro arquivo, sem tocar em RLS, tabela de notificações ou no `/auth`.

## Verificação

Depois da mudança: abrir `/dashboard`, confirmar que o sino aparece sem quebrar a página e que o console não mostra mais o erro `cannot add postgres_changes callbacks after subscribe()`.

## Problema
`src/routes/_authenticated/vendas.$id.tsx` faz `return` cedo na linha 87 (`if (loading || !sale) return ...`) e depois disso ainda declara vários `useCallback` (linhas 108 `saveResumo`, 133 `reload parties`, etc.). Isso viola as Regras dos Hooks — no primeiro render menos hooks são chamados; quando `loading` vira `false`, mais hooks aparecem e o React quebra com "Rendered more hooks than during the previous render", mostrando a tela "This page didn't load".

## Correção
Mover o `if (loading || !sale) return ...` para **depois** de todas as declarações de hooks do componente `SaleDetail`. Ou seja:

1. Manter todos os `useState`, `useCallback`, `useMemo`, `useEffect` no topo, sem returns antes deles.
2. Só depois de declarar tudo, renderizar condicionalmente:
   ```tsx
   if (loading || !sale) return <div>Carregando...</div>;
   return <>...conteúdo normal...</>;
   ```
3. Ajustar os `useCallback` que usam `sale` para lidar com `sale` possivelmente nulo (guard interno `if (!sale) return false;`) — já que agora rodam mesmo antes do sale carregar.

## Fora do escopo
- Não mexo em lógica de salvamento, wizard, ocorrência, RLS, comissões, dashboards.
- Só reordenação de hooks + guards mínimos para o TS/runtime.

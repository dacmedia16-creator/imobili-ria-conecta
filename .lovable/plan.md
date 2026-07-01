## Problema

A tela `/auth` está mostrando "This page didn't load" por causa de uma **hydration mismatch** (o HTML gerado no servidor não bate com o do cliente — o React reporta `<div>` vs `<Suspense>` no lugar do `<Tabs>`). Quando o React falha em hidratar, o `errorComponent` do root vira a tela cinza que você viu.

Nas outras rotas isso não acontece porque `_authenticated/route.tsx` já usa `ssr: false`. A rota `/auth` não tem essa opção — então roda SSR e quebra na hidratação.

## Correção

Editar **apenas** `src/routes/auth.tsx`:

- Adicionar `ssr: false` no `createFileRoute("/auth")({...})`, igual ao padrão já usado em `_authenticated/route.tsx`.

Isso faz `/auth` renderizar só no cliente, elimina o mismatch e a tela de login volta a aparecer normalmente. Não mexo em mais nada (nem no fluxo de login, nem no wizard, nem no cadastro).

## Verificação

Depois da mudança: recarregar `/auth` no preview e confirmar que o formulário Entrar/Criar conta aparece sem a tela de erro.
# RE/MAX Única Escolha — Portal Interno

Sistema interno (TanStack Start + Supabase) pra gestão de vendas, contratos e comissões. Deploy: Cloudflare Workers, domínio [unicaescolha.com.br](https://unicaescolha.com.br).

## Gerenciador de pacotes: Bun

O **Bun é o gerenciador oficial** deste projeto — é o que a Cloudflare usa pra buildar e publicar o deploy real. `bun.lock` é a fonte da verdade; sempre que `package.json` mudar, rode `bun install` e comite o `bun.lock` atualizado.

```sh
bun install
bun run dev      # servidor de desenvolvimento
bun run build    # build de produção (o mesmo que a Cloudflare roda)
bun run test     # testes (vitest)
```

`package-lock.json` também é versionado (pra quem prefere rodar `npm` localmente — editor, ferramentas, etc.), mas **não é o caminho de deploy**. `npm ci` pode se comportar diferente dependendo da versão do npm instalada (o algoritmo de resolução de *peerDependency* opcional do Nitro/`unstorage` mudou entre npm 10.x e 11.x, o que já causou falsos alarmes de "lockfile desatualizado" que não se confirmam no Bun). Se `npm ci` falhar mas `bun install --frozen-lockfile` passar, o problema é da versão do npm local, não do projeto — não regenere `package-lock.json` achando que vai corrigir algo real.

## Variáveis de ambiente

Veja `.env.example`. Em produção, as não-secretas ficam em `wrangler.toml` (`[vars]`); segredos reais (`SUPABASE_SERVICE_ROLE_KEY`, `ZIONTALK_API_KEY`, etc.) via `wrangler secret put`.

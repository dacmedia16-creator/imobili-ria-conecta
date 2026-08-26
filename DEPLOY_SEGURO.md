# Deploy Seguro ADM MAX

Toda publicação em produção deve partir exclusivamente da branch `main` do repositório oficial e usar:

```bash
npm run deploy:safe
```

Para validar sem publicar:

```bash
npm run deploy:check
```

O processo bloqueia a publicação quando o projeto é temporário ou incorreto, a branch não é `main`, existem mudanças sem commit, o código diverge de `origin/main`, ou testes, build e verificações críticas falham.

Depois do deploy, as páginas pública inicial e de especialistas são verificadas. Se a validação falhar e a versão anterior puder ser identificada, o Worker é revertido automaticamente.

Não use `npm run deploy`, `nitro deploy` ou `wrangler deploy` diretamente em produção.

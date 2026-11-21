<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Glossário do negócio

Antes de mudar regras ou telas, leia docs/GLOSSARIO.md e use esses termos.

## Correção de erro: teste primeiro

Em toda correção de erro, escreva ANTES um teste vitest que reproduz o erro e falha. Depois corrija e mostre o
mesmo teste passando. Exceção: erro puramente visual ou de texto (cor, espaço, rótulo, ortografia): basta o print
antes/depois. Na entrega, cite o nome do teste e o resultado "falhou antes / passa depois". Detalhes em
docs/QUALIDADE.md.

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bot, Check, Clock, Info, Landmark, ScrollText, X } from "lucide-react";
import { requireRoles } from "@/lib/route-access";
import {
  AREAS,
  ATENDENTE_IA,
  REGRAS_AUSENCIA,
  REGRAS_GERAIS,
  REGRAS_PAPEIS,
  SO_PLATAFORMA,
  menuComum,
  menuDoPapel,
  papeisQueConcede,
  podeVerRegrasPapeis,
  rotuloPapel,
  type RegraPapel,
} from "@/lib/regras-papeis";
import { PageHeader } from "@/components/visual/base";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Tela só de leitura (t_37becd0c, Denis 27/10/2026): descreve o que cada papel pode fazer.
// Não grava nada e não decide permissão: o texto vem de src/lib/regras-papeis.ts, conferido por
// teste contra as funções de permissão reais. Visível só para quem administra Usuários e perfis.
export const Route = createFileRoute("/_authenticated/admin/regras-papeis")({
  head: () => ({ meta: [{ title: "Regras de papéis" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, podeVerRegrasPapeis),
  component: RegrasPapeisPage,
});

function Lista({ itens, tipo }: { itens: string[]; tipo: "pode" | "nao" }) {
  if (itens.length === 0) return null;
  const Icone = tipo === "pode" ? Check : X;
  return (
    <ul className="space-y-1.5">
      {itens.map((t) => (
        <li key={t} className="flex items-start gap-2 text-sm">
          <Icone
            className={
              tipo === "pode"
                ? "mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                : "mt-0.5 h-4 w-4 shrink-0 text-red-600"
            }
            aria-label={tipo === "pode" ? "Pode" : "Não pode"}
          />
          <span className="min-w-0 break-words">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function CartaoPapel({ regra }: { regra: RegraPapel }) {
  const concede = papeisQueConcede(regra.papel);
  return (
    <AccordionItem
      value={regra.papel}
      className="rounded-xl border bg-card px-4 shadow-sm"
      data-testid={`papel-${regra.papel}`}
    >
      <AccordionTrigger className="gap-3 py-4 hover:no-underline">
        <span className="min-w-0 text-left">
          <span className="block text-base font-semibold">{rotuloPapel(regra.papel)}</span>
          <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
            {regra.resumo}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {AREAS.map((a) => {
            const d = regra.areas[a.id];
            if (d.pode.length === 0 && d.naoPode.length === 0) return null;
            return (
              <section key={a.id} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <h3 className="text-sm font-semibold">{a.titulo}</h3>
                <Lista itens={d.pode.map((i) => i.texto)} tipo="pode" />
                <Lista itens={d.naoPode.map((i) => i.texto)} tipo="nao" />
              </section>
            );
          })}
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <p>
            <span className="font-semibold">Pode dar estes papéis ao cadastrar alguém: </span>
            {concede.length > 0 ? concede.join(", ") : "nenhum"}.
          </p>
          <p className="mt-2">
            <span className="font-semibold">Itens do menu: </span>
            {menuDoPapel(regra.papel).join(" · ")}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Alguns itens só aparecem quando o módulo está ligado para a imobiliária.
          </p>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function Bloco({
  titulo,
  icone: Icone,
  itens,
  testid,
}: {
  titulo: string;
  icone: typeof Info;
  itens: string[];
  testid: string;
}) {
  return (
    <Card className="rounded-xl shadow-sm" data-testid={testid}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icone className="h-4 w-4 text-primary" aria-hidden />
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          {itens.map((t) => (
            <li key={t} className="break-words">
              {t}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RegrasPapeisPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={ScrollText}
        title="Regras de papéis"
        description="O que cada papel da imobiliária vê, pode fazer e não pode fazer no sistema. Esta tela é só para consulta: para mudar o papel de alguém, use Usuários e perfis."
        actions={
          <Button asChild variant="outline" className="gap-2">
            <Link to="/admin/usuarios">
              <ArrowLeft className="h-4 w-4" /> Voltar a Usuários e perfis
            </Link>
          </Button>
        }
      />

      <Bloco
        titulo="Para todos os papéis"
        icone={Info}
        itens={REGRAS_GERAIS}
        testid="regras-gerais"
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Papéis da imobiliária</h2>
        <p className="text-sm text-muted-foreground">
          Toque em um papel para ver os detalhes por área.
        </p>
        <Accordion type="multiple" className="space-y-3">
          {REGRAS_PAPEIS.map((r) => (
            <CartaoPapel key={r.papel} regra={r} />
          ))}
        </Accordion>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco
          titulo="Quando alguém está ausente"
          icone={Clock}
          itens={REGRAS_AUSENCIA}
          testid="regras-ausencia"
        />
        <Bloco
          titulo="Todo mundo logado"
          icone={Check}
          itens={[`Itens do menu de todos os papéis: ${menuComum().join(" · ")}.`]}
          testid="regras-comum"
        />
        <Bloco
          titulo="Só o Administrador da plataforma"
          icone={Landmark}
          itens={SO_PLATAFORMA}
          testid="regras-plataforma"
        />
        <Bloco titulo="Atendente de IA" icone={Bot} itens={ATENDENTE_IA} testid="regras-ia" />
      </div>
    </div>
  );
}

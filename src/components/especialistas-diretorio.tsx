import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Search,
  MapPin,
  MessageCircle,
  ArrowLeft,
  Users,
  Phone,
  Globe,
  Instagram,
  Building2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  whatsappSpecialistUrl,
  type PositioningRegion,
  type PublicSpecialist,
} from "@/lib/positioning";
import {
  listPublicOrgRegions,
  listPublicOrgSpecialists,
  type PublicAgency,
} from "@/lib/positioning-db";
import { agencyLocationLabel, specialistsCountLabel } from "@/lib/especialistas-publico";

/** Moldura comum das páginas públicas de especialistas (lista de imobiliárias e página de uma). */
export function EspecialistasShell({
  titulo,
  subtitulo,
  children,
  topo,
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  topo?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#071a44] via-[#0d2d6c] to-slate-100">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/" aria-label="UniHub — página inicial">
          <img
            src="/remax-logo-white.png"
            width={1600}
            height={756}
            alt="RE/MAX"
            className="h-11 w-auto"
          />
        </Link>
        <nav aria-label="Navegação principal" className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" asChild>
            <Link to="/">UniHub</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/auth">Área interna</Link>
          </Button>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-4xl px-4 pb-12 pt-8 text-center text-white sm:px-6 sm:pt-14">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <MapPin className="h-6 w-6" />
          </div>
          <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-5xl">{titulo}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-blue-100 sm:text-base">{subtitulo}</p>
          {topo}
        </section>
        <section className="min-h-[45vh] rounded-t-[2rem] bg-slate-100 px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-7xl">
            {children}
            <nav aria-label="Voltar" className="mt-10 text-center">
              <Button variant="ghost" asChild>
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao UniHub — todos os sistemas MAX
                </Link>
              </Button>
            </nav>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Cartões das imobiliárias publicadas: só nome, cidade e número de especialistas (sem logo). */
export function ImobiliariasLista({ agencies }: { agencies: PublicAgency[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {agencies.map((agency) => {
        const local = agencyLocationLabel(agency);
        return (
          <article key={agency.slug}>
          <Link
            to="/especialistas/$slug"
            params={{ slug: agency.slug }}
            className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a58a8]"
          >
            <Card className="h-full border-0 shadow-md transition-shadow group-hover:shadow-lg">
              <CardContent className="flex items-start gap-4 p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1a58a8]">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold text-slate-900 group-hover:text-[#1a58a8]">
                    {agency.nome}
                  </h3>
                  {local && <p className="mt-1 text-sm text-slate-500">{local}</p>}
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[#1a58a8]">
                    {specialistsCountLabel(agency.especialistas)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          </article>
        );
      })}
    </div>
  );
}

/** Página de UMA imobiliária: busca + filtro de região, só com os corretores dela. */
export function EspecialistasDaImobiliaria({
  agency,
  mostrarOutras,
  titulo,
  regioesIniciais,
  especialistasIniciais,
  rodape,
}: {
  agency: PublicAgency;
  mostrarOutras: boolean;
  /** h1 da página (SEO, t_e014564f). Padrão: "Especialistas — <imobiliária>". */
  titulo?: string;
  /** Vindos do servidor (SSR): a lista completa já sai no HTML; o navegador só busca ao filtrar. */
  regioesIniciais?: PositioningRegion[];
  especialistasIniciais?: PublicSpecialist[];
  /** Conteúdo depois da lista (ex.: perguntas frequentes). */
  rodape?: ReactNode;
}) {
  const slug = agency.slug;
  const temInicial = especialistasIniciais !== undefined;
  const [regions, setRegions] = useState<PositioningRegion[]>(regioesIniciais ?? []);
  const [specialists, setSpecialists] = useState<PublicSpecialist[]>(especialistasIniciais ?? []);
  const [search, setSearch] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [loading, setLoading] = useState(!temInicial);
  const [error, setError] = useState<string | null>(null);
  // Com dados do servidor, a primeira busca (sem filtro) seria repetida à toa: pula só ela.
  const pularPrimeiraBusca = useRef(temInicial);

  useEffect(() => {
    if (regioesIniciais !== undefined) return;
    let alive = true;
    listPublicOrgRegions(slug)
      .then((rows) => {
        if (alive) setRegions(rows);
      })
      .catch(() => {
        if (alive) setError("Não foi possível carregar as regiões agora.");
      });
    return () => {
      alive = false;
    };
  }, [slug, regioesIniciais]);

  useEffect(() => {
    if (pularPrimeiraBusca.current) {
      pularPrimeiraBusca.current = false;
      if (!search && selectedRegion === "all") return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listPublicOrgSpecialists(
          slug,
          search,
          selectedRegion === "all" ? null : Number(selectedRegion),
        );
        if (alive) setSpecialists(rows);
      } catch {
        if (alive) {
          setError("Não foi possível carregar os especialistas agora.");
          setSpecialists([]);
        }
      }
      if (alive) setLoading(false);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [slug, search, selectedRegion]);

  const activeRegion = useMemo(
    () => regions.find((region) => String(region.id) === selectedRegion),
    [regions, selectedRegion],
  );

  return (
    <EspecialistasShell
      titulo={titulo ?? `Especialistas em imóveis — ${agency.nome}`}
      subtitulo="Busque pelo bairro, condomínio, cidade ou nome do corretor e fale diretamente com quem conhece a região."
      topo={
        <div className="mx-auto mt-8 grid max-w-3xl gap-3 rounded-2xl bg-white p-3 text-left shadow-2xl sm:grid-cols-[1fr_1fr]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Nome, bairro ou condomínio"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome, bairro ou condomínio"
              className="pl-9 text-foreground"
            />
          </div>
          <Select value={selectedRegion} onValueChange={setSelectedRegion}>
            <SelectTrigger aria-label="Região" className="text-foreground">
              <SelectValue placeholder="Todas as regiões" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as regiões</SelectItem>
              {regions.map((region) => (
                <SelectItem key={region.id} value={String(region.id)}>
                  {region.nome} — {region.cidade}
                  {region.zona ? ` / ${region.zona}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {activeRegion
              ? `Especialistas em ${activeRegion.nome}`
              : `Corretores especialistas da ${agency.nome}`}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {loading
              ? "Buscando…"
              : `${specialists.length} ${specialists.length === 1 ? "corretor encontrado" : "corretores encontrados"}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(search || selectedRegion !== "all") && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setSelectedRegion("all");
              }}
            >
              Limpar filtros
            </Button>
          )}
          {mostrarOutras && (
            <Button variant="outline" asChild>
              <Link to="/especialistas">
                <Building2 className="mr-2 h-4 w-4" /> Outras imobiliárias
              </Link>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!error && !loading && specialists.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Users className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 font-medium text-slate-800">Nenhum especialista encontrado</h3>
          <p className="mt-1 text-sm text-slate-500">
            Tente outra região ou faça uma busca mais ampla.
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {specialists.map((specialist) => (
          <article key={specialist.id}>
          <Card className="h-full overflow-hidden border-0 shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 ring-2 ring-blue-100">
                  <AvatarImage src={specialist.avatar_url ?? undefined} alt={specialist.nome} />
                  <AvatarFallback className="bg-[#123a7a] text-lg text-white">
                    {specialist.nome[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold text-slate-900">
                    {specialist.nome}
                  </h3>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#1a58a8]">
                    Corretor especialista
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {specialist.regioes.map((region) => (
                  <span
                    key={region.id}
                    className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800"
                  >
                    {region.nome}
                  </span>
                ))}
              </div>
              <div className="mt-5 space-y-2 text-sm text-slate-600">
                {specialist.telefone && (
                  <a
                    href={whatsappSpecialistUrl(specialist)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline"
                  >
                    <Phone className="h-4 w-4 shrink-0" /> <span>{specialist.telefone}</span>
                  </a>
                )}
                {specialist.pagina_pessoal_url && (
                  <a
                    href={specialist.pagina_pessoal_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline"
                  >
                    <Globe className="h-4 w-4 shrink-0" /> <span>Página pessoal</span>
                  </a>
                )}
                {specialist.instagram_url && (
                  <a
                    href={specialist.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline"
                  >
                    <Instagram className="h-4 w-4 shrink-0" /> <span>Instagram</span>
                  </a>
                )}
              </div>
              {specialist.telefone && (
                <Button className="mt-6 w-full bg-[#128c4a] hover:bg-[#0f7a40]" asChild>
                  <a
                    href={whatsappSpecialistUrl(specialist, activeRegion?.nome)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" /> Falar pelo WhatsApp
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
          </article>
        ))}
      </div>
      {rodape}
    </EspecialistasShell>
  );
}

/** Perguntas frequentes da página pública (texto em ESPECIALISTAS_FAQ; t_e014564f). Sem JS: <details>. */
export function EspecialistasFaq({ itens }: { itens: readonly { pergunta: string; resposta: string }[] }) {
  return (
    <section aria-labelledby="faq-especialistas" className="mx-auto mt-14 max-w-3xl">
      <h2 id="faq-especialistas" className="text-xl font-semibold text-slate-900">
        Perguntas frequentes sobre os especialistas
      </h2>
      <div className="mt-4 divide-y rounded-2xl bg-white shadow-sm">
        {itens.map((item) => (
          <details key={item.pergunta} className="group p-5">
            <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
              <h3 className="inline text-base">{item.pergunta}</h3>
            </summary>
            <p className="mt-2 text-sm text-slate-600">{item.resposta}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, MapPin, MessageCircle, ArrowLeft, Users, Phone, Globe, Instagram } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  parseSpecialistRegions,
  whatsappSpecialistUrl,
  type PositioningRegion,
  type PublicSpecialist,
} from "@/lib/positioning";

export const Route = createFileRoute("/especialistas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Especialistas por região — RE/MAX Única Escolha" },
      { name: "description", content: "Encontre corretores RE/MAX Única Escolha por bairro, condomínio ou cidade." },
    ],
  }),
  component: SpecialistsPage,
});

function SpecialistsPage() {
  const [regions, setRegions] = useState<PositioningRegion[]>([]);
  const [specialists, setSpecialists] = useState<PublicSpecialist[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("list_public_positioning_regions").then(({ data, error: catalogError }) => {
      if (catalogError) { setError("Não foi possível carregar as regiões agora."); return; }
      setRegions(data ?? []);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const { data, error: specialistsError } = await supabase.rpc("list_public_specialists", {
        _search: search.trim() || undefined,
        _region_id: selectedRegion === "all" ? undefined : Number(selectedRegion),
      });
      if (specialistsError) {
        setError("Não foi possível carregar os especialistas agora.");
        setSpecialists([]);
      } else {
        setSpecialists((data ?? []).map((row) => ({ ...row, regioes: parseSpecialistRegions(row.regioes) })));
      }
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, selectedRegion]);

  const activeRegion = useMemo(
    () => regions.find((region) => String(region.id) === selectedRegion),
    [regions, selectedRegion],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#071a44] via-[#0d2d6c] to-slate-100">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/" aria-label="Voltar ao Hub Única Escolha">
          <img src="/remax-logo-white.png" alt="RE/MAX Única Escolha" className="h-11 w-auto" />
        </Link>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/auth">Área interna</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-12 pt-8 text-center text-white sm:px-6 sm:pt-14">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <MapPin className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Encontre um especialista na sua região</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-blue-100 sm:text-base">
            Busque pelo bairro, condomínio, cidade ou nome do corretor e fale diretamente com quem conhece a região.
          </p>

          <div className="mx-auto mt-8 grid max-w-3xl gap-3 rounded-2xl bg-white p-3 text-left shadow-2xl sm:grid-cols-[1fr_1fr]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, bairro ou condomínio"
                className="pl-9 text-foreground"
              />
            </div>
            <Select value={selectedRegion} onValueChange={setSelectedRegion}>
              <SelectTrigger className="text-foreground"><SelectValue placeholder="Todas as regiões" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as regiões</SelectItem>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={String(region.id)}>
                    {region.nome} — {region.cidade}{region.zona ? ` / ${region.zona}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="min-h-[45vh] rounded-t-[2rem] bg-slate-100 px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {activeRegion ? `Especialistas em ${activeRegion.nome}` : "Especialistas disponíveis"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {loading ? "Buscando..." : `${specialists.length} ${specialists.length === 1 ? "corretor encontrado" : "corretores encontrados"}`}
                </p>
              </div>
              {(search || selectedRegion !== "all") && (
                <Button variant="ghost" onClick={() => { setSearch(""); setSelectedRegion("all"); }}>
                  Limpar filtros
                </Button>
              )}
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

            {!error && !loading && specialists.length === 0 && (
              <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
                <Users className="mx-auto h-10 w-10 text-slate-300" />
                <h3 className="mt-3 font-medium text-slate-800">Nenhum especialista encontrado</h3>
                <p className="mt-1 text-sm text-slate-500">Tente outra região ou faça uma busca mais ampla.</p>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {specialists.map((specialist) => (
                <Card key={specialist.id} className="overflow-hidden border-0 shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-16 w-16 ring-2 ring-blue-100">
                        <AvatarImage src={specialist.avatar_url ?? undefined} alt={specialist.nome} />
                        <AvatarFallback className="bg-[#123a7a] text-lg text-white">{specialist.nome[0]?.toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-slate-900">{specialist.nome}</h3>
                        <p className="text-xs font-medium uppercase tracking-wide text-[#1a58a8]">Corretor especialista</p>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {specialist.regioes.map((region) => (
                        <span key={region.id} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
                          {region.nome}
                        </span>
                      ))}
                    </div>
                    <div className="mt-5 space-y-2 text-sm text-slate-600">
                      <a href={whatsappSpecialistUrl(specialist)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline">
                        <Phone className="h-4 w-4 shrink-0" /> <span>{specialist.telefone}</span>
                      </a>
                      {specialist.pagina_pessoal_url && (
                        <a href={specialist.pagina_pessoal_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline">
                          <Globe className="h-4 w-4 shrink-0" /> <span>Página pessoal</span>
                        </a>
                      )}
                      {specialist.instagram_url && (
                        <a href={specialist.instagram_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-[#1a58a8] hover:underline">
                          <Instagram className="h-4 w-4 shrink-0" /> <span>Instagram</span>
                        </a>
                      )}
                    </div>
                    <Button className="mt-6 w-full bg-[#128c4a] hover:bg-[#0f7a40]" asChild>
                      <a
                        href={whatsappSpecialistUrl(specialist, activeRegion?.nome)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="mr-2 h-4 w-4" /> Falar pelo WhatsApp
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-10 text-center">
              <Button variant="ghost" asChild><Link to="/"><ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Hub</Link></Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

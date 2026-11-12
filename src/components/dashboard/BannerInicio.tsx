// Banner rotativo no topo do Início (cartão t_75786f5c). Troca sozinho a cada 5 s, bolinhas para navegar à mão.
// Sem banner = não renderiza nada (nem espaço). A arte aparece inteira (proporção 3:1, sem corte no celular).
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import { BANNER_INTERVALO_MS, linkInterno, type BannerAtivo } from "@/lib/home-banners";
import { bannersDoInicio } from "@/lib/home-banners.functions";

function Arte({ banner }: { banner: BannerAtivo }) {
  const img = (
    <img
      src={banner.url}
      alt={banner.titulo}
      className="h-full w-full object-contain"
      loading="eager"
      draggable={false}
    />
  );
  const caixa = "block aspect-[3/1] w-full overflow-hidden rounded-2xl border bg-muted";
  if (!banner.link) return <div className={caixa}>{img}</div>;
  if (linkInterno(banner.link)) {
    return (
      <Link to={banner.link} className={caixa} aria-label={banner.titulo}>
        {img}
      </Link>
    );
  }
  return (
    <a
      href={banner.link}
      target="_blank"
      rel="noopener noreferrer"
      className={caixa}
      aria-label={banner.titulo}
    >
      {img}
    </a>
  );
}

/** Parte visual: recebe a lista pronta (facilita teste). */
export function BannerCarrossel({
  banners,
  intervaloMs = BANNER_INTERVALO_MS,
}: {
  banners: BannerAtivo[];
  intervaloMs?: number;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [atual, setAtual] = useState(0);
  const [giro, setGiro] = useState(0); // muda a cada clique na bolinha: reinicia a contagem dos 5 s
  const total = banners.length;

  useEffect(() => {
    if (!api) return;
    const sel = () => setAtual(api.selectedScrollSnap());
    sel();
    api.on("select", sel);
    api.on("reInit", sel);
    return () => {
      api.off("select", sel);
      api.off("reInit", sel);
    };
  }, [api]);

  useEffect(() => {
    if (!api || total < 2) return;
    const t = window.setInterval(() => api.scrollNext(), intervaloMs);
    return () => window.clearInterval(t);
  }, [api, total, intervaloMs, giro]);

  const irPara = useCallback(
    (i: number) => {
      api?.scrollTo(i);
      setAtual(i);
      setGiro((g) => g + 1);
    },
    [api],
  );

  if (!total) return null;

  return (
    <section aria-label="Avisos da imobiliária" data-testid="banner-inicio">
      <Carousel setApi={setApi} opts={{ loop: total > 1, align: "start" }}>
        <CarouselContent>
          {banners.map((b) => (
            <CarouselItem key={b.id}>
              <Arte banner={b} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
      {total > 1 && (
        <div className="mt-2 flex justify-center gap-2">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => irPara(i)}
              aria-label={`Mostrar banner ${i + 1} de ${total}: ${b.titulo}`}
              aria-current={i === atual ? "true" : undefined}
              className={cn(
                "h-2.5 rounded-full transition-all",
                i === atual
                  ? "w-6 bg-primary"
                  : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Busca os banners do usuário logado. Falha ou lista vazia = nada aparece (nunca atrapalha o Início). */
export function BannerInicio() {
  const carregar = useServerFn(bannersDoInicio);
  const [banners, setBanners] = useState<BannerAtivo[]>([]);
  useEffect(() => {
    let vivo = true;
    carregar()
      .then((l) => {
        if (vivo) setBanners(Array.isArray(l) ? l : []);
      })
      .catch(() => {
        if (vivo) setBanners([]);
      });
    return () => {
      vivo = false;
    };
  }, [carregar]);
  return <BannerCarrossel banners={banners} />;
}

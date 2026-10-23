import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PlayCircle } from "lucide-react";
import { linkDoVideoWiki } from "@/lib/wiki-max/videos.functions";
import { errorMessage } from "@/lib/errors";
import type { WikiVideoChave } from "@/lib/wiki-max/videos";

/**
 * Player simples da Wiki MAX. Até a pessoa clicar, mostra só a capa (nenhum byte do vídeo é
 * baixado). No clique, pede o link temporário ao servidor e abre o <video> nativo com controles
 * (preload="metadata", playsInline para o iPhone não forçar tela cheia).
 */
export function WikiVideo({
  chave,
  capaUrl,
  titulo,
  legenda,
  duracao,
}: {
  chave: WikiVideoChave;
  capaUrl?: string;
  titulo?: string;
  legenda: string;
  duracao: string;
}) {
  const pedirLink = useServerFn(linkDoVideoWiki);
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const assistir = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await pedirLink({ data: { chave } });
      setUrl(r.url);
    } catch (e) {
      setErro(errorMessage(e, "Vídeo indisponível no momento."));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <figure className="space-y-1" data-testid={`wiki-video-${chave}`}>
      {titulo && <h3 className="text-sm font-semibold">🎬 {titulo}</h3>}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-black">
        {url ? (
          <video
            src={url}
            poster={capaUrl}
            controls
            autoPlay
            playsInline
            preload="metadata"
            controlsList="nodownload"
            className="h-full w-full"
            aria-label={titulo ?? legenda}
            onError={() =>
              setErro("Não foi possível tocar o vídeo. Recarregue a página e tente de novo.")
            }
          />
        ) : (
          <button
            type="button"
            onClick={assistir}
            disabled={carregando}
            className="group absolute inset-0 flex items-center justify-center"
            aria-label={`Assistir: ${titulo ?? legenda}`}
          >
            {capaUrl && (
              <img
                src={capaUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <span className="relative flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
              <PlayCircle className="h-5 w-5" aria-hidden />
              {carregando ? "Carregando…" : `Assistir ao vídeo (${duracao})`}
            </span>
          </button>
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {titulo ? legenda : `🎬 ${legenda}`}
      </figcaption>
      {erro && (
        <p role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      )}
    </figure>
  );
}

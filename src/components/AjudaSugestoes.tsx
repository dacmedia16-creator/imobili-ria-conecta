/**
 * Botão "Ajuda e sugestões" (no topo, ao lado do sino; não flutua sobre a tela) e o
 * formulário: Erro / Dúvida / Ideia, texto, print opcional com tarja e a tela automática.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy, ImagePlus, Eraser, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { errorMessage } from "@/lib/errors";
import { criarChamado } from "@/lib/ajuda-sugestoes.functions";
import { nomeDaTela, PRINT_MAX_BYTES, rotaSemIds, type TipoChamado } from "@/lib/ajuda-sugestoes";

const OPCOES: { tipo: TipoChamado; emoji: string; titulo: string; sub: string }[] = [
  { tipo: "erro", emoji: "🐞", titulo: "Relatar erro", sub: "algo não funcionou" },
  { tipo: "duvida", emoji: "❓", titulo: "Tirar dúvida", sub: "como faço…" },
  { tipo: "sugestao", emoji: "💡", titulo: "Dar ideia", sub: "melhoria" },
];

const PERGUNTA: Record<TipoChamado, string> = {
  erro: "O que aconteceu? O que você esperava que acontecesse?",
  duvida: "Qual é a sua dúvida?",
  sugestao: "Qual é a sua ideia?",
};

const LADO_MAX = 1600;

type Tarja = { x: number; y: number; w: number; h: number };

/** Editor simples: arraste sobre a imagem para cobrir nomes, CPF, telefone e valores. */
function EditorTarja({
  img,
  tarjas,
  setTarjas,
}: {
  img: HTMLImageElement;
  tarjas: Tarja[];
  setTarjas: (t: Tarja[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [rascunho, setRascunho] = useState<Tarja | null>(null);

  const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala);
  const h = Math.round(img.height * escala);

  const desenhar = (canvas: HTMLCanvasElement | null, extra: Tarja | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.fillStyle = "#000";
    for (const t of [...tarjas, ...(extra ? [extra] : [])]) ctx.fillRect(t.x, t.y, t.w, t.h);
  };

  const ponto = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  const ret = (a: { x: number; y: number }, b: { x: number; y: number }): Tarja => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <canvas
      ref={(c) => {
        (ref as { current: HTMLCanvasElement | null }).current = c;
        desenhar(c, rascunho);
      }}
      width={w}
      height={h}
      data-testid="ajuda-print-canvas"
      className="w-full cursor-crosshair touch-none rounded-md border"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        inicio.current = ponto(e);
      }}
      onPointerMove={(e) => {
        if (!inicio.current) return;
        const t = ret(inicio.current, ponto(e));
        setRascunho(t);
        desenhar(ref.current, t);
      }}
      onPointerUp={(e) => {
        if (!inicio.current) return;
        const t = ret(inicio.current, ponto(e));
        inicio.current = null;
        setRascunho(null);
        if (t.w > 4 && t.h > 4) setTarjas([...tarjas, t]);
      }}
    />
  );
}

async function carregarImagem(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // a imagem já decodificada continua utilizável no canvas
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Gera o print final (com as tarjas gravadas nos pixels) em JPEG, já reduzido. */
function exportarPrint(img: HTMLImageElement, tarjas: Tarja[]): string {
  const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar o print.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  for (const t of tarjas) ctx.fillRect(t.x, t.y, t.w, t.h);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";
}

export function AjudaSugestoesBotao({ compacto = false }: { compacto?: boolean } = {}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoChamado>("erro");
  const [texto, setTexto] = useState("");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tarjas, setTarjas] = useState<Tarja[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const criar = useServerFn(criarChamado);

  const tela = nomeDaTela(pathname);
  const rota = rotaSemIds(pathname);

  const limpar = () => {
    setTipo("erro");
    setTexto("");
    setImg(null);
    setTarjas([]);
    setEnviado(null);
  };

  const escolherArquivo = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("O print deve ser PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > PRINT_MAX_BYTES * 3) {
      toast.error("Imagem muito grande.");
      return;
    }
    try {
      setImg(await carregarImagem(file));
      setTarjas([]);
    } catch {
      toast.error("Não foi possível abrir a imagem.");
    }
  };

  const enviar = async () => {
    if (texto.trim().length < 5) {
      toast.error("Escreva pelo menos 5 caracteres.");
      return;
    }
    setEnviando(true);
    try {
      const r = await criar({
        data: {
          tipo,
          texto: texto.trim(),
          telaRota: rota,
          telaNome: tela,
          userAgent: navigator.userAgent.slice(0, 400),
          print: img
            ? { base64: exportarPrint(img, tarjas), contentType: "image/jpeg" }
            : undefined,
        },
      });
      setEnviado(r.numero ?? 0);
      setTexto("");
      setImg(null);
      setTarjas([]);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível enviar o chamado."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          limpar();
          setAberto(true);
        }}
        size={compacto ? "icon" : "sm"}
        className="gap-2 rounded-full bg-amber-500 font-semibold text-white shadow-md hover:bg-amber-600 print:hidden"
        aria-label="Ajuda e sugestões"
        title="Ajuda e sugestões"
        data-testid="ajuda-botao"
      >
        <LifeBuoy className="h-5 w-5" />
        {!compacto && <span>Ajuda e sugestões</span>}
      </Button>
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Ajuda e sugestões</SheetTitle>
            <SheetDescription>
              Vai direto para a equipe MAX. A resposta aparece no sino 🔔.
            </SheetDescription>
          </SheetHeader>

          {enviado !== null ? (
            <div className="mt-6 space-y-4" data-testid="ajuda-enviado">
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                Chamado {enviado ? `#${enviado} ` : ""}enviado. A equipe MAX vai responder e você
                recebe o aviso no sino.
              </p>
              <div className="flex gap-2">
                <Button asChild variant="outline" onClick={() => setAberto(false)}>
                  <Link to="/ajuda">Ver meus chamados</Link>
                </Button>
                <Button variant="ghost" onClick={limpar}>
                  Abrir outro
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium">O que você quer fazer?</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup">
                  {OPCOES.map((o) => (
                    <button
                      key={o.tipo}
                      type="button"
                      role="radio"
                      aria-checked={tipo === o.tipo}
                      onClick={() => setTipo(o.tipo)}
                      className={`rounded-md border p-2 text-left text-xs ${tipo === o.tipo ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                    >
                      <span className="block text-base">{o.emoji}</span>
                      <span className="block font-semibold">{o.titulo}</span>
                      <span className="block text-muted-foreground">{o.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="ajuda-texto" className="mb-1 block text-sm font-medium">
                  {PERGUNTA[tipo]}
                </label>
                <Textarea
                  id="ajuda-texto"
                  rows={5}
                  maxLength={4000}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>

              <div>
                <p className="mb-1 text-sm font-medium">Print da tela (opcional)</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void escolherArquivo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {img ? (
                  <div className="space-y-2">
                    <EditorTarja img={img} tarjas={tarjas} setTarjas={setTarjas} />
                    <p className="text-xs text-muted-foreground">
                      Arraste sobre a imagem para passar uma tarja preta em nomes, CPF, telefone e
                      valores.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!tarjas.length}
                        onClick={() => setTarjas(tarjas.slice(0, -1))}
                      >
                        <Eraser className="mr-1 h-4 w-4" /> Desfazer tarja
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setImg(null);
                          setTarjas([]);
                        }}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Tirar print
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => inputRef.current?.click()}
                    >
                      <ImagePlus className="mr-1 h-4 w-4" /> Anexar imagem
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tire o print pelo celular ou computador e anexe aqui. Antes de enviar você
                      pode passar uma tarja sobre nomes, CPF, telefone e valores.
                    </p>
                  </div>
                )}
              </div>

              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                🔒 Evite mandar CPF, RG, telefone ou dados de clientes no texto ou no print. O print
                só é visto por você e pela equipe MAX.
              </p>

              <div>
                <p className="mb-1 text-sm font-medium">Onde você estava (preenchido sozinho)</p>
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2 text-xs">
                  <span className="flex items-center gap-1 font-medium">
                    <MapPin className="h-3.5 w-3.5" /> {tela}
                  </span>
                  <span className="truncate text-muted-foreground">{rota}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vai junto também o navegador/aparelho (ajuda a achar o erro). Nenhum dado de
                  cliente é coletado sozinho.
                </p>
              </div>

              <div className="flex items-center justify-end">
                <Button onClick={enviar} disabled={enviando} data-testid="ajuda-enviar">
                  {enviando ? "Enviando…" : "Enviar chamado"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

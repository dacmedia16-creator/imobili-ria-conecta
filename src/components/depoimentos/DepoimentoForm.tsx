// Formulário do depoimento (t_c7cfaf00). Usado no convite (modal) e na rota /depoimento.
// Passo 1: nota. 4–5: depoimento + autorização opcional; 1–3: "o que podemos melhorar" (interno).
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Lock, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DEP_LIMITES,
  DEP_PERGUNTA_FRASE,
  DEP_PERGUNTA_MELHORAR,
  DEP_PERGUNTA_MUDOU,
  DEP_PERGUNTA_NOTA,
  DEP_PERGUNTA_TAREFA,
  caminhoDaNota,
  depFormVazio,
  destinoDoEnvio,
  erroDoForm,
  type DepForm,
  type DepSituacao,
} from "@/lib/depoimentos";
import { enviarDepoimento, enviarFotoCadastro } from "@/lib/depoimentos-db";

type SituacaoOk = Extract<DepSituacao, { pode_enviar: true }>;

const ROTULO_NOTA = ["", "Quase nada", "Pouco", "Mais ou menos", "Ajudou bastante", "Ajudou muito"];

export function Estrelas({
  valor,
  onChange,
  tamanho = "h-9 w-9",
}: {
  valor: number | null;
  onChange?: (n: number) => void;
  tamanho?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ativo = hover ?? valor ?? 0;
  if (!onChange)
    return (
      <span className="inline-flex gap-0.5" aria-label={`${valor ?? 0} de 5 estrelas`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`${tamanho} ${n <= (valor ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
            aria-hidden
          />
        ))}
      </span>
    );
  return (
    <div role="radiogroup" aria-label={DEP_PERGUNTA_NOTA} className="flex gap-1" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          aria-label={`${n} de 5 — ${ROTULO_NOTA[n]}`}
          data-nota={n}
          className="rounded-md p-1 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
        >
          <Star
            className={`${tamanho} ${n <= ativo ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}

function iniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Prévia do cartão como vai aparecer na página de vendas. */
export function PreviaVitrine({
  previa,
  fotoUrl,
  nota,
  frase,
  texto,
}: {
  previa: SituacaoOk["previa"];
  fotoUrl: string | null;
  nota: number;
  frase: string;
  texto: string;
}) {
  return (
    <figure className="rounded-xl border bg-muted/30 p-4" data-testid="previa-vitrine">
      <Estrelas valor={nota} tamanho="h-4 w-4" />
      {frase.trim() ? (
        <blockquote className="mt-2 text-base font-semibold leading-snug">“{frase.trim()}”</blockquote>
      ) : null}
      {texto.trim() ? (
        <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{texto.trim()}</p>
      ) : null}
      <figcaption className="mt-3 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {fotoUrl ? <AvatarImage src={fotoUrl} alt="" /> : null}
          <AvatarFallback>{iniciais(previa.nome_exibicao)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 text-sm leading-tight">
          <div className="font-semibold">{previa.nome_exibicao}</div>
          <div className="text-muted-foreground">
            {previa.papel} · {previa.imobiliaria}
            {previa.cidade ? ` · ${previa.cidade}` : ""}
          </div>
        </div>
      </figcaption>
    </figure>
  );
}

export function DepoimentoForm({
  situacao,
  userId,
  origem,
  onEnviado,
  rodape,
}: {
  situacao: SituacaoOk;
  userId: string;
  origem: "convite" | "link";
  onEnviado: (r: { publicavel: boolean }) => void;
  /** Botões extras ("Agora não" / "Não quero") ao lado do enviar. */
  rodape?: React.ReactNode;
}) {
  const [f, setF] = useState<DepForm>(depFormVazio);
  const [enviando, setEnviando] = useState(false);
  const [foto, setFoto] = useState<string | null>(situacao.previa.foto_url);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputFoto = useRef<HTMLInputElement>(null);
  const caminho = caminhoDaNota(f.nota);
  const destino = destinoDoEnvio(f);
  const set = <K extends keyof DepForm>(k: K, v: DepForm[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => setFoto(situacao.previa.foto_url), [situacao.previa.foto_url]);

  const trocarFoto = async (arq: File | undefined) => {
    if (!arq) return;
    if (!/^image\/(jpeg|png|webp)$/.test(arq.type) || arq.size > 5 * 1024 * 1024) {
      toast.error("Use uma foto JPG, PNG ou WebP de até 5 MB.");
      return;
    }
    setEnviandoFoto(true);
    try {
      setFoto(await enviarFotoCadastro(userId, arq));
      toast.success("Foto do cadastro atualizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  };

  const enviar = async () => {
    const erro = erroDoForm(f);
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      const r = await enviarDepoimento(f, situacao.termo.versao, origem);
      onEnviado({ publicavel: r.publicavel });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar agora.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-base font-semibold">{DEP_PERGUNTA_NOTA}</Label>
        <Estrelas valor={f.nota} onChange={(n) => set("nota", n)} />
        {f.nota ? <p className="text-sm text-muted-foreground">{ROTULO_NOTA[f.nota]}</p> : null}
      </div>

      {caminho === "melhorar" ? (
        <div className="space-y-2">
          <Label htmlFor="dep-melhorar">{DEP_PERGUNTA_MELHORAR}</Label>
          <Textarea
            id="dep-melhorar"
            rows={4}
            maxLength={DEP_LIMITES.melhorar}
            value={f.melhorar}
            onChange={(e) => set("melhorar", e.target.value)}
            placeholder="Conte com sinceridade. Isso vai direto para a equipe do ADM MAX."
          />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Fica só com a equipe do ADM MAX. Não é publicado.
          </p>
        </div>
      ) : null}

      {caminho === "depoimento" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="dep-mudou">
              {DEP_PERGUNTA_MUDOU} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="dep-mudou"
              rows={3}
              maxLength={DEP_LIMITES.mudou}
              value={f.mudou}
              onChange={(e) => set("mudou", e.target.value)}
              placeholder="Ex.: hoje acompanho todas as minhas vendas num lugar só."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dep-tarefa">
              {DEP_PERGUNTA_TAREFA} <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="dep-tarefa"
              rows={2}
              maxLength={DEP_LIMITES.tarefa}
              value={f.tarefa}
              onChange={(e) => set("tarefa", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dep-frase">
              {DEP_PERGUNTA_FRASE} <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="dep-frase"
              rows={2}
              maxLength={DEP_LIMITES.frase}
              value={f.frase}
              onChange={(e) => set("frase", e.target.value)}
              placeholder="Ex.: Organiza a venda do começo ao fim."
            />
            <p className="text-xs text-muted-foreground">
              {f.frase.trim().length}/{DEP_LIMITES.frase}
            </p>
          </div>

          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="dep-autorizo"
                checked={f.autorizo}
                onCheckedChange={(v) => set("autorizo", v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="dep-autorizo" className="text-sm font-normal leading-snug">
                {situacao.termo.texto}
              </Label>
            </div>
            {f.autorizo ? (
              <>
                <PreviaVitrine
                  previa={situacao.previa}
                  fotoUrl={foto}
                  nota={f.nota ?? 5}
                  frase={f.frase}
                  texto={f.mudou}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={inputFoto}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void trocarFoto(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={enviandoFoto}
                    onClick={() => inputFoto.current?.click()}
                  >
                    <Camera className="mr-1.5 h-4 w-4" aria-hidden />
                    {enviandoFoto ? "Enviando…" : foto ? "Trocar foto" : "Enviar uma foto"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {foto ? "Foto do seu cadastro." : "Sem foto: aparecem as suas iniciais."}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Passa por análise antes de aparecer. Você pode retirar quando quiser em /depoimento.
                </p>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden /> Sem marcar, fica só como feedback interno.
              </p>
            )}
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {rodape}
        <Button type="button" onClick={() => void enviar()} disabled={enviando || caminho === "nenhum"}>
          {enviando ? "Enviando…" : destino === "vitrine" ? "Enviar depoimento" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}

export function DepoimentoObrigado({ publicavel }: { publicavel: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
      <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden />
      <p className="text-lg font-semibold">Obrigado!</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {publicavel
          ? "Seu depoimento vai passar por uma análise rápida antes de aparecer na página do ADM MAX."
          : "Sua resposta foi registrada e vai direto para a equipe do ADM MAX."}
      </p>
    </div>
  );
}

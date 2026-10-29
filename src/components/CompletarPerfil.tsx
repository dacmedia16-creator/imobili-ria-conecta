import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ImageUp, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { profileRegistrations } from "@/lib/exclusive-captures-db";
import { storageOrganizationPath } from "@/lib/storage-org";
import {
  DATA_NASCIMENTO_MIN,
  dataNascimentoMaxima,
  erroCampoDataNascimento,
} from "@/lib/data-nascimento";
import { minhaDataNascimento, salvarMinhaDataNascimento } from "@/lib/data-nascimento-db";
import {
  CAMPO_LABEL,
  camposFaltando,
  candidatoPerfilOuLembrete,
  chaveLembreteAdiado,
  idDaSessao,
  lembreteAdiadoNestaSessao,
  modoCompletarPerfil,
  normalizarCpf,
  type PerfilParaCompletar,
} from "@/lib/completar-perfil";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Estado = "carregando" | "liberado" | "completar" | "lembrete";

/** "Agora não" vale até o próximo login: guarda o session_id do login atual (sem ele, só na aba). */
function lerAdiado(userId: string, sessaoAtual: string | null): boolean {
  try {
    if (sessaoAtual)
      return lembreteAdiadoNestaSessao(
        window.localStorage.getItem(chaveLembreteAdiado(userId)),
        sessaoAtual,
      );
    return window.sessionStorage.getItem(chaveLembreteAdiado(userId)) === "1";
  } catch {
    return false;
  }
}

function gravarAdiado(userId: string, sessaoAtual: string | null) {
  try {
    if (sessaoAtual) window.localStorage.setItem(chaveLembreteAdiado(userId), sessaoAtual);
    else window.sessionStorage.setItem(chaveLembreteAdiado(userId), "1");
  } catch {
    /* sem armazenamento: o lembrete só some até recarregar a página */
  }
}

/**
 * Porteiro do acesso (t_9e90351e + t_e951a6f1):
 * - corretor novo com perfil incompleto → tela "Complete seu perfil" obrigatória, até salvar tudo;
 * - corretor antigo com perfil incompleto → o mesmo formulário como LEMBRETE, com "Agora não"
 *   (volta a aparecer no próximo login enquanto o perfil estiver incompleto).
 * Qualquer falha ao ler o perfil libera o acesso (nunca trava ninguém por erro).
 */
export function CompletarPerfilGate({ children }: { children: ReactNode }) {
  const {
    user,
    session,
    roles,
    loading,
    platformAdmin,
    platformContext,
    platformReady,
    impersonation,
  } = useAuth();
  const sessaoAtual = idDaSessao(session?.access_token);
  const [estado, setEstado] = useState<Estado>("carregando");
  const [perfil, setPerfil] = useState<PerfilParaCompletar | null>(null);
  /** Data já gravada (AAAA-MM-DD) ou null. Falha ao ler = null (o campo aparece, não trava ninguém). */
  const [nascimento, setNascimento] = useState<string | null>(null);
  const [nascimentoLido, setNascimentoLido] = useState(false);
  const userId = user?.id;
  const createdAt = user?.created_at;
  const forcar =
    (user?.app_metadata as { completar_perfil?: unknown } | undefined)?.completar_perfil === true;

  const candidato =
    !loading &&
    platformReady &&
    Boolean(userId) &&
    candidatoPerfilOuLembrete({
      roles,
      platformAdmin,
      emVisaoDaPlataforma: Boolean(platformContext),
      vendoComo: Boolean(impersonation),
    });
  const rolesKey = roles.join(",");

  useEffect(() => {
    if (loading || !platformReady) return;
    if (!candidato || !userId) {
      setEstado("liberado");
      return;
    }
    let vivo = true;
    setEstado("carregando");
    (async () => {
      try {
        const [{ data, error }, registros, dataNasc] = await Promise.all([
          supabase
            .from("profiles")
            .select("nome, telefone, avatar_url")
            .eq("id", userId)
            .maybeSingle(),
          profileRegistrations(),
          // undefined = não deu para ler (nunca trava por isso); null = sem data gravada.
          minhaDataNascimento(userId).catch(() => undefined),
        ]);
        if (error || !data) throw error ?? new Error("perfil não encontrado");
        const meu = registros.find((r) => r.user_id === userId);
        const p: PerfilParaCompletar = {
          nome: data.nome,
          telefone: data.telefone,
          avatar_url: data.avatar_url,
          cpf: meu?.cpf ?? null,
          creci: meu?.creci ?? null,
        };
        if (!vivo) return;
        setPerfil(p);
        setNascimento(dataNasc ?? null);
        setNascimentoLido(dataNasc !== undefined);
        const modo = modoCompletarPerfil({
          roles,
          platformAdmin,
          emVisaoDaPlataforma: Boolean(platformContext),
          vendoComo: Boolean(impersonation),
          createdAt,
          forcar,
          perfil: p,
          semDataNascimento: dataNasc === null,
        });
        if (modo === "obrigatorio") setEstado("completar");
        else if (modo === "lembrete" && !lerAdiado(userId, sessaoAtual)) setEstado("lembrete");
        else setEstado("liberado");
      } catch {
        if (vivo) setEstado("liberado");
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, platformReady, candidato, userId, createdAt, forcar, rolesKey, sessaoAtual]);

  // Quem não é candidato (admin, gestor, plataforma…) vê o sistema direto, sem tela de espera.
  if (!candidato) return <>{children}</>;
  if (estado === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (estado === "completar" && perfil) {
    return (
      <CompletarPerfilTela
        perfil={perfil}
        nascimento={nascimento}
        nascimentoObrigatorio={nascimentoLido && !nascimento}
        onConcluir={() => setEstado("liberado")}
      />
    );
  }
  if (estado === "lembrete" && perfil && userId) {
    return (
      <CompletarPerfilTela
        perfil={perfil}
        nascimento={nascimento}
        onConcluir={() => setEstado("liberado")}
        onAgoraNao={() => {
          gravarAdiado(userId, sessaoAtual);
          setEstado("liberado");
        }}
      />
    );
  }
  return <>{children}</>;
}

function CompletarPerfilTela({
  perfil,
  nascimento,
  nascimentoObrigatorio = false,
  onConcluir,
  onAgoraNao,
}: {
  perfil: PerfilParaCompletar;
  /** Data de nascimento já gravada (AAAA-MM-DD) ou null. */
  nascimento: string | null;
  /** Só na tela obrigatória (conta nova) de quem ainda não tem data. No lembrete, sempre opcional. */
  nascimentoObrigatorio?: boolean;
  onConcluir: () => void;
  /** Presente só no modo lembrete (conta antiga): deixa entrar sem completar. */
  onAgoraNao?: () => void;
}) {
  const { user, signOut } = useAuth();
  const [nome, setNome] = useState(perfil.nome ?? "");
  const [telefone, setTelefone] = useState(perfil.telefone ?? "");
  const [cpf, setCpf] = useState(perfil.cpf ?? "");
  const [creci, setCreci] = useState(perfil.creci ?? "");
  const [remaxId, setRemaxId] = useState("");
  const [dataNasc, setDataNasc] = useState(nascimento ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(perfil.avatar_url);
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const atual: PerfilParaCompletar = {
    nome,
    telefone,
    avatar_url: foto ? "nova" : avatarUrl,
    cpf,
    creci,
  };
  const faltando = camposFaltando(atual);
  const erro = (campo: (typeof faltando)[number]) => tentouSalvar && faltando.includes(campo);
  // Data de nascimento (t_dff88e75): obrigatória só no 1º acesso (tela obrigatória) de quem ainda
  // não tem data; no lembrete de conta antiga é opcional.
  const nascObrigatoria = nascimentoObrigatorio && !onAgoraNao;
  const erroNasc = erroCampoDataNascimento(dataNasc, nascObrigatoria);

  const escolherFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!TIPOS_FOTO.includes(file.type)) {
      toast.error("Use uma foto em JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("Foto muito grande (máx. 5 MB).");
      return;
    }
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setFoto(file);
  };

  const salvar = async () => {
    if (!user) return;
    setTentouSalvar(true);
    if (faltando.length > 0) {
      const nomes = faltando.map((c) => CAMPO_LABEL[c]);
      if (erroNasc && !dataNasc.trim()) nomes.push("Data de nascimento");
      toast.error(`Falta preencher: ${nomes.join(", ")}.`);
      return;
    }
    if (erroNasc) {
      toast.error(erroNasc);
      return;
    }
    const rid = remaxId.replace(/\D/g, "");
    if (rid && rid.length !== 9) {
      toast.error("O ID RE/MAX tem 9 números (ex.: 630601272). Deixe em branco se não tiver.");
      return;
    }
    setSalvando(true);
    try {
      // Data primeiro: o banco valida de novo (1900..hoje, 16 anos); se recusar, nada mais é gravado.
      const nasc = dataNasc.trim();
      if (nasc && nasc !== (nascimento ?? "")) await salvarMinhaDataNascimento(nasc);
      let url = avatarUrl;
      if (foto) {
        // Mesmo caminho e bucket da tela "Meu acesso".
        const path = await storageOrganizationPath(`${user.id}/avatar`);
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, foto, { upsert: true, contentType: foto.type });
        if (upErr) throw new Error("Não foi possível enviar a foto. Tente de novo.");
        url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?t=${Date.now()}`;
      }
      const patch: {
        nome: string;
        telefone: string;
        cpf: string | null;
        creci: string | null;
        avatar_url: string | null;
        remax_id?: string;
      } = {
        nome: nome.trim().replace(/\s+/g, " "),
        telefone: telefone.trim(),
        cpf: normalizarCpf(cpf),
        creci: creci.trim() || null, // CRECI opcional (t_5c4bd214): vazio grava null.
        avatar_url: url,
      };
      if (rid) patch.remax_id = rid;
      const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
      if (error) {
        if (/profiles_remax_id_(org_)?uniq|duplicate/i.test(error.message))
          throw new Error(
            "Esse ID RE/MAX já está em outro cadastro. Deixe em branco e fale com o administrador.",
          );
        // Gatilho do padrão 630 (t_b98f3e4b): só recusa quando o ID muda.
        if (/ID RE\/MAX invalido/i.test(error.message))
          throw new Error("O ID RE/MAX tem 9 números e começa com 630 (ex.: 630601272).");
        if (/cpf/i.test(error.message)) throw new Error("CPF inválido. Confira os números.");
        if (/creci/i.test(error.message))
          throw new Error("CRECI inválido. Use só letras, números e - . /");
        throw new Error("Não foi possível salvar agora. Tente de novo.");
      }
      setAvatarUrl(url);
      setFoto(null);
      toast.success("Perfil completo. Bem-vindo(a)!");
      onConcluir();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  const inicial = (nome || user?.email || "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <div
      className="min-h-screen bg-muted/40 px-4 py-6 sm:py-10"
      data-testid={onAgoraNao ? "lembrete-perfil" : "completar-perfil"}
    >
      <div className="mx-auto w-full max-w-md space-y-5 rounded-2xl border bg-background p-5 shadow-sm sm:p-7">
        <div className="space-y-1 text-center">
          <img src="/remax-icon.png" alt="RE/MAX" className="mx-auto h-10 w-10 object-contain" />
          <h1 className="text-xl font-semibold tracking-tight">Complete seu perfil</h1>
          <p className="text-sm text-muted-foreground">
            {onAgoraNao
              ? "Seu perfil ainda está incompleto. Coloque sua foto e confira seus dados. Leva menos de um minuto."
              : "Antes de começar, preencha seus dados e coloque uma foto. Leva menos de um minuto."}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Avatar
            className={`h-28 w-28 ring-2 ring-offset-2 ring-offset-background ${erro("foto") ? "ring-destructive" : "ring-primary/20"}`}
          >
            <AvatarImage src={preview ?? avatarUrl ?? undefined} alt="Sua foto de perfil" />
            <AvatarFallback className="text-3xl">
              {preview || avatarUrl ? inicial : <UserRound className="h-12 w-12 opacity-50" />}
            </AvatarFallback>
          </Avatar>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={escolherFoto}
            data-testid="foto-camera"
          />
          <input
            ref={galeriaRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={escolherFoto}
            data-testid="foto-galeria"
          />
          <div className="grid w-full grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}>
              <Camera className="h-4 w-4" aria-hidden /> Tirar foto
            </Button>
            <Button type="button" variant="outline" onClick={() => galeriaRef.current?.click()}>
              <ImageUp className="h-4 w-4" aria-hidden /> Da galeria
            </Button>
          </div>
          <p className={`text-xs ${erro("foto") ? "text-destructive" : "text-muted-foreground"}`}>
            Foto obrigatória: rosto visível, de frente.
          </p>
        </div>

        <div className="space-y-4">
          <Campo id="cp-nome" label="Nome completo" erro={erro("nome")} dica="Nome e sobrenome.">
            <Input
              id="cp-nome"
              autoComplete="name"
              value={nome}
              maxLength={120}
              onChange={(e) => setNome(e.target.value)}
            />
          </Campo>
          <Campo id="cp-email" label="E-mail">
            <Input id="cp-email" value={user?.email ?? ""} disabled readOnly />
          </Campo>
          <Campo
            id="cp-telefone"
            label="Telefone (WhatsApp)"
            erro={erro("telefone")}
            dica="Com DDD."
          >
            <Input
              id="cp-telefone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(15) 99123-4567"
              value={telefone}
              maxLength={20}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo
              id="cp-cpf"
              label="CPF"
              erro={erro("cpf")}
              dica={erro("cpf") ? "CPF inválido." : undefined}
            >
              <Input
                id="cp-cpf"
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={cpf}
                maxLength={14}
                onChange={(e) => setCpf(e.target.value)}
              />
            </Campo>
            <Campo
              id="cp-creci"
              label="CRECI (opcional)"
              erro={erro("creci")}
              dica={erro("creci") ? "CRECI inválido. Use só letras, números e - . /" : undefined}
            >
              <Input
                id="cp-creci"
                placeholder="Ex.: 123456-F"
                value={creci}
                maxLength={50}
                onChange={(e) => setCreci(e.target.value)}
              />
            </Campo>
          </div>
          <Campo
            id="cp-nascimento"
            label={nascObrigatoria ? "Data de nascimento" : "Data de nascimento (opcional)"}
            erro={tentouSalvar && Boolean(erroNasc)}
            dica={
              tentouSalvar && erroNasc
                ? erroNasc
                : "Seus colegas veem só o dia e o mês, no aniversário. O ano fica com você e a gestão."
            }
          >
            <Input
              id="cp-nascimento"
              type="date"
              autoComplete="bday"
              min={DATA_NASCIMENTO_MIN}
              max={dataNascimentoMaxima()}
              value={dataNasc}
              onChange={(e) => setDataNasc(e.target.value)}
              data-testid="cp-nascimento"
            />
          </Campo>
          <Campo
            id="cp-remax"
            label="ID RE/MAX (opcional)"
            dica="9 números. Deixe em branco se ainda não tiver."
          >
            <Input
              id="cp-remax"
              inputMode="numeric"
              placeholder="Ex.: 630601272"
              value={remaxId}
              maxLength={9}
              onChange={(e) => setRemaxId(e.target.value.replace(/\D/g, ""))}
            />
          </Campo>
        </div>

        <Button className="h-11 w-full text-base" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar e entrar"}
        </Button>
        {onAgoraNao ? (
          <Button
            variant="outline"
            className="h-11 w-full text-base"
            onClick={onAgoraNao}
            disabled={salvando}
            data-testid="lembrete-agora-nao"
          >
            Agora não
          </Button>
        ) : null}
        <button
          type="button"
          className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => void signOut().then(() => window.location.assign("/auth"))}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Sair
        </button>
      </div>
    </div>
  );
}

function Campo({
  id,
  label,
  erro,
  dica,
  children,
}: {
  id: string;
  label: string;
  erro?: boolean;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={erro ? "text-destructive" : undefined}>
        {label}
        {erro ? " — obrigatório" : ""}
      </Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

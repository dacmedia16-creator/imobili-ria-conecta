import { useEffect, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import {
  PRIMEIRA_MSG_PADRAO,
  iaConfigMudou,
  previaPrimeiraMensagem,
  validarIaConfig,
  type IaConfig,
} from "@/lib/leads-ia";
import { lerIaConfig, nomeImobiliaria, salvarIaConfig, salvarRoteiroIa } from "@/lib/leads-db";

/** Salva a IA se houver alteração pendente. false = não salvou (erro já avisado na tela). */
export type SalvarIaPendente = () => Promise<boolean>;

/**
 * IA de atendimento: ligar/desligar, nome, 1ª mensagem e lembretes (só administrador; o banco confere).
 * `salvarPendenteRef`: a janela de configuração usa para gravar também a IA quando o botão do rodapé é
 * clicado com alteração pendente aqui (t_71832765: o nome digitado se perdia ao clicar em "Salvar prazos").
 */
export function LeadsIaConfig({
  open,
  salvarPendenteRef,
}: {
  open: boolean;
  salvarPendenteRef?: MutableRefObject<SalvarIaPendente | null>;
}) {
  const [c, setC] = useState<IaConfig | null>(null);
  // Último valor lido/gravado no banco, para saber se há alteração não salva.
  const [salvo, setSalvo] = useState<IaConfig | null>(null);
  const [org, setOrg] = useState<string>("sua imobiliária");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    lerIaConfig()
      .then((v) => {
        setC(v);
        setSalvo(v);
      })
      .catch(() => {
        setC(null);
        setSalvo(null);
      });
    nomeImobiliaria()
      .then((n) => n && setOrg(n))
      .catch(() => undefined);
  }, [open]);

  const pendente = !!c && !!salvo && iaConfigMudou(salvo, c);

  const salvar = async (): Promise<boolean> => {
    if (!c) return true;
    const erro = validarIaConfig(c);
    if (erro) {
      toast.error(erro);
      return false;
    }
    setBusy(true);
    try {
      await salvarIaConfig(c);
      await salvarRoteiroIa(c);
      setSalvo(c);
      toast.success(c.ia_ativa ? "IA de atendimento ligada." : "IA de atendimento salva (desligada).");
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar a IA."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Atualizado a cada render: o rodapé chama sempre com o valor que está na tela agora.
  if (salvarPendenteRef) salvarPendenteRef.current = pendente ? salvar : null;

  if (!c) return null;

  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">IA de atendimento</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor="cfg-ia-ativa" className="text-xs">
            {c.ia_ativa ? "Ligada" : "Desligada"}
          </Label>
          <Switch
            id="cfg-ia-ativa"
            checked={c.ia_ativa}
            onCheckedChange={(v) => setC({ ...c, ia_ativa: v })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Ligada, a IA manda a 1ª mensagem de todo lead novo, responde as dúvidas com os dados da captação e faz no
        máximo 3 perguntas (comprar ou alugar, faixa de valor e forma de pagamento). Quando um dado não está na
        captação, ela avisa que vai confirmar com o corretor: nunca estima preço nem condição. Visita é sempre
        pré-agendamento, confirmado pelo corretor. Proprietário, parceiro ou fornecedor vai direto para a equipe.{" "}
        {c.ia_canal === "teste"
          ? "Modo teste: nenhuma mensagem é enviada ao cliente. Teste a conversa no detalhe do lead."
          : "Canal WhatsApp (ZionTalk) ligado pela plataforma."}
      </p>
      <div className="grid gap-1">
        <Label htmlFor="cfg-ia-nome">Nome com que a IA se apresenta</Label>
        <Input
          id="cfg-ia-nome"
          maxLength={40}
          value={c.ia_nome}
          onChange={(e) => setC({ ...c, ia_nome: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="cfg-ia-primeira">1ª mensagem (uma só, sem link, terminando com pergunta)</Label>
        <Textarea
          id="cfg-ia-primeira"
          maxLength={400}
          value={c.ia_primeira_msg ?? ""}
          placeholder={PRIMEIRA_MSG_PADRAO}
          onChange={(e) => setC({ ...c, ia_primeira_msg: e.target.value })}
        />
        <p className="text-[11px] text-muted-foreground">
          Deixe vazio para usar o texto padrão. Use {"{nome}"} (cliente), {"{assistente}"} (nome da IA),{" "}
          {"{imobiliaria}"} e {"{imovel}"} (tipo e bairro da captação).
        </p>
      </div>
      <p className="rounded-md bg-muted/50 p-2 text-xs">
        <span className="font-medium">Prévia: </span>
        {previaPrimeiraMensagem(c, org, "Maria Silva", "no apartamento do bairro Centro")}
      </p>
      <div className="flex items-start justify-between gap-2 rounded-md border p-2">
        <div>
          <Label htmlFor="cfg-ia-reengajar" className="text-xs font-medium">
            Lembrete para quem não respondeu
          </Label>
          <p className="text-[11px] text-muted-foreground">
            2 lembretes: depois de ~24 h, citando o imóvel; depois de ~72 h, com 1 imóvel parecido. Para quando o
            cliente responde, recusa ou pede SAIR. Respeita o limite diário e o intervalo do chip. Só funciona com o
            WhatsApp ligado pela plataforma.
          </p>
        </div>
        <Switch
          id="cfg-ia-reengajar"
          checked={c.ia_reengajar === true}
          onCheckedChange={(v) => setC({ ...c, ia_reengajar: v })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void salvar()}>
          Salvar IA
        </Button>
        {pendente && (
          <span className="text-xs text-amber-700" role="status">
            Alterações da IA ainda não salvas.
          </span>
        )}
      </div>
    </section>
  );
}

// Ficha de abertura da locação pelo CORRETOR (t_28e583e2; substitui o Google Forms "formulário cadastral").
// Etapa 1 (Pré-análise): imóvel, valores, garantia, modalidade, proprietário, locatário, corretor responsável e
// captador, observações. Ao enviar, a locação entra na esteira (aprovação da gestora). Nenhum documento aqui e
// nada é enviado ao cliente. O banco repete toda validação (locacao_salvar_pre / locacao_enviar_pre).
import { useEffect, useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GARANTIA_LABEL,
  MOBILIA_LABEL,
  faltasFicha,
  faltasPreAnalise,
  fichaParaBanco,
  pctPorTaxa,
  type ContextoLocacao,
  type FichaLocacao,
  type LocacaoDetalhe as Detalhe,
  type Pessoa,
} from "@/lib/locacao";
import { corretoresLocacao, enviarPreAnalise, salvarPreAnalise } from "@/lib/locacao-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  d: Detalhe;
  ctx: ContextoLocacao;
  busy: boolean;
  rodar: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  editavel: boolean;
  aConfirmar: ReactNode;
  aviso: ReactNode;
};

// Mesma conversão da pré-análise de antes: vírgula vira ponto decimal.
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const numDec = num;

export function FichaAbertura({ d, ctx, busy, rodar, editavel, aConfirmar, aviso }: Props) {
  const [f, setF] = useState(() => ({
    ...d.candidato,
    endereco: d.endereco,
    tipo: d.tipo,
    garantia: d.garantia,
    aluguel: d.aluguel ? String(d.aluguel) : "",
    condominio: d.condominio ? String(d.condominio) : "",
    iptu: d.iptu ? String(d.iptu) : "",
    taxaAdm: String(d.taxaAdm),
    parceria: d.parceria,
    captadorId: d.captadorId ?? "",
    metragem: d.ficha.metragem ? String(d.ficha.metragem) : "",
  }));
  const [fi, setFi] = useState<FichaLocacao>(() => d.ficha);
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    if (!editavel) return;
    let vivo = true;
    corretoresLocacao()
      .then((l) => {
        if (!vivo) return;
        setPessoas(
          (Array.isArray(l) ? l : [])
            .map((x) => x as { id?: unknown; nome?: unknown })
            .filter((x) => typeof x.id === "string")
            .map((x) => ({ id: String(x.id), nome: typeof x.nome === "string" ? x.nome : "—" })),
        );
      })
      .catch(() => setPessoas([]));
    return () => {
      vivo = false;
    };
  }, [editavel]);

  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const setFicha = <K extends keyof FichaLocacao>(k: K, v: FichaLocacao[K]) =>
    setFi((x) => ({ ...x, [k]: v }));
  const setProp = (k: "nome" | "telefone" | "email", v: string) =>
    setFi((x) => ({ ...x, proprietario: { ...x.proprietario, [k]: v } }));

  const fichaAtual: FichaLocacao = { ...fi, metragem: numDec(f.metragem) };
  const candidato = {
    cpf: f.cpf,
    nome: f.nome,
    nascimento: f.nascimento,
    telefone: f.telefone,
    email: f.email,
  };
  const dados = () => ({
    candidato,
    endereco: f.endereco,
    tipo: f.tipo,
    garantia: f.garantia,
    aluguel: num(f.aluguel),
    condominio: num(f.condominio),
    iptu: num(f.iptu),
    taxa_adm: numDec(f.taxaAdm),
    parceria: f.parceria,
    captador_id: f.captadorId || null,
    ficha: fichaParaBanco(fichaAtual),
  });
  const faltas = [
    ...faltasPreAnalise({ candidato, endereco: f.endereco, aluguel: num(f.aluguel) }),
    ...faltasFicha(fichaAtual, f.captadorId || null),
  ];
  const taxas = Object.keys(ctx.config.tabelaTaxa)
    .map(Number)
    .sort((a, b) => b - a);

  const campo = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`pre-${k}`}>{label}</Label>
      <Input
        id={`pre-${k}`}
        disabled={!editavel}
        value={String(f[k])}
        onChange={(e) => set(k, e.target.value)}
        {...extra}
      />
    </div>
  );
  const pessoaSel = (id: string, label: string, valor: Pessoa, onChange: (p: Pessoa) => void) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={SELECT}
        disabled={!editavel}
        value={valor}
        onChange={(e) => onChange(e.target.value === "pj" ? "pj" : "pf")}
      >
        <option value="pf">Pessoa física (PF)</option>
        <option value="pj">Pessoa jurídica (PJ)</option>
      </select>
    </div>
  );
  // O captador atual pode não estar na lista (ex.: tela só leitura): mostra pelo nome do detalhe.
  const opcoesCaptador =
    d.captadorId && !pessoas.some((p) => p.id === d.captadorId)
      ? [{ id: d.captadorId, nome: d.captadorNome ?? "—" }, ...pessoas]
      : pessoas;

  return (
    <div className="space-y-3" data-testid="locacao-ficha">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Imóvel</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fi-imovel">ID do imóvel</Label>
              <Input
                id="fi-imovel"
                disabled={!editavel}
                maxLength={40}
                value={fi.imovelId}
                onChange={(e) => setFicha("imovelId", e.target.value)}
              />
            </div>
            {campo("metragem", "Metragem (m²)", { inputMode: "decimal" })}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="fi-mobilia">Mobília</Label>
              <select
                id="fi-mobilia"
                className={SELECT}
                disabled={!editavel}
                value={fi.mobilia}
                onChange={(e) => setFicha("mobilia", e.target.value as FichaLocacao["mobilia"])}
              >
                <option value="">—</option>
                {Object.entries(MOBILIA_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">{campo("endereco", "Endereço do imóvel")}</div>
            <div className="space-y-1">
              <Label htmlFor="pre-tipo">
                Modalidade
                {aConfirmar}
              </Label>
              <select
                id="pre-tipo"
                className={SELECT}
                disabled={!editavel}
                value={f.tipo}
                onChange={(e) => set("tipo", e.target.value)}
              >
                <option value="residencial">Residencial</option>
                <option value="comercial">Comercial</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Contrato misto: como marcar ainda não foi definido.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Valores e garantia</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {campo("aluguel", "Aluguel (R$)", { inputMode: "decimal" })}
            {campo("iptu", "IPTU mensal (R$)", { inputMode: "decimal" })}
            {campo("condominio", "Condomínio (R$)", { inputMode: "decimal" })}
            <div className="space-y-1">
              <Label htmlFor="pre-taxa">Taxa de administração</Label>
              <select
                id="pre-taxa"
                className={SELECT}
                disabled={!editavel}
                value={f.taxaAdm}
                onChange={(e) => set("taxaAdm", e.target.value)}
              >
                {taxas.map((t) => (
                  <option key={t} value={String(t)}>
                    {t}% → corretor recebe {pctPorTaxa(t, ctx.config.tabelaTaxa)}% do 1º aluguel
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pre-garantia">
                Garantia
                {aConfirmar}
              </Label>
              <select
                id="pre-garantia"
                className={SELECT}
                disabled={!editavel}
                value={f.garantia}
                onChange={(e) => set("garantia", e.target.value)}
              >
                {Object.entries(GARANTIA_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fi-garantia-outra">Outra garantia (opcional)</Label>
              <Input
                id="fi-garantia-outra"
                disabled={!editavel}
                maxLength={300}
                placeholder="Ex.: CredPago, título de capitalização"
                value={fi.garantiaOutra}
                onChange={(e) => setFicha("garantiaOutra", e.target.value)}
              />
            </div>
            {f.garantia === "fiador" &&
              pessoaSel("fi-fiador-pessoa", "Fiador é", fi.fiadorPessoa, (p) =>
                setFicha("fiadorPessoa", p),
              )}
            <div className="space-y-1">
              <Label htmlFor="pre-parceria">Tem parceria (outra imobiliária/corretor)?</Label>
              <select
                id="pre-parceria"
                className={SELECT}
                disabled={!editavel}
                value={f.parceria ? "1" : "0"}
                onChange={(e) => set("parceria", e.target.value === "1")}
              >
                <option value="0">Não</option>
                <option value="1">Sim</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Locatário (candidato)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {pessoaSel("fi-loc-pessoa", "Locatário é", fi.locatarioPessoa, (p) =>
              setFicha("locatarioPessoa", p),
            )}
            {campo("cpf", "CPF (do locatário ou do responsável)", {
              inputMode: "numeric",
              placeholder: "000.000.000-00",
            })}
            <div className="sm:col-span-2">
              {campo(
                "nome",
                fi.locatarioPessoa === "pj" ? "Responsável pela empresa" : "Nome completo",
              )}
            </div>
            {campo("nascimento", "Data de nascimento", { type: "date" })}
            {campo("telefone", "Telefone", { inputMode: "tel" })}
            <div className="sm:col-span-2">{campo("email", "E-mail", { type: "email" })}</div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="fi-loc-endereco">Endereço residencial atual completo</Label>
              <Input
                id="fi-loc-endereco"
                disabled={!editavel}
                maxLength={300}
                value={fi.locatarioEndereco}
                onChange={(e) => setFicha("locatarioEndereco", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Proprietário</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {pessoaSel("fi-prop-pessoa", "Proprietário é", fi.proprietarioPessoa, (p) =>
              setFicha("proprietarioPessoa", p),
            )}
            <div className="space-y-1">
              <Label htmlFor="fi-prop-nome">
                {fi.proprietarioPessoa === "pj" ? "Razão social / representante" : "Nome"}
              </Label>
              <Input
                id="fi-prop-nome"
                disabled={!editavel}
                maxLength={200}
                value={fi.proprietario.nome}
                onChange={(e) => setProp("nome", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fi-prop-tel">Telefone</Label>
              <Input
                id="fi-prop-tel"
                disabled={!editavel}
                inputMode="tel"
                maxLength={200}
                value={fi.proprietario.telefone}
                onChange={(e) => setProp("telefone", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fi-prop-email">E-mail</Label>
              <Input
                id="fi-prop-email"
                disabled={!editavel}
                type="email"
                maxLength={200}
                value={fi.proprietario.email}
                onChange={(e) => setProp("email", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Corretores</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Corretor responsável</Label>
              <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                {d.corretorNome}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fi-captador">Corretor captador</Label>
              <select
                id="fi-captador"
                className={SELECT}
                disabled={!editavel}
                value={f.captadorId}
                onChange={(e) => set("captadorId", e.target.value)}
              >
                <option value="">—</option>
                {opcoesCaptador.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.id === d.corretorId ? " (o próprio responsável)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Responsável e captador diferentes: comissão meio a meio (só registrado aqui; o cálculo
              vem numa próxima entrega).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Observações e tratativas</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="fi-obs" className="sr-only">
              Observações e tratativas
            </Label>
            <Textarea
              id="fi-obs"
              disabled={!editavel}
              maxLength={2000}
              rows={5}
              placeholder="Isenção, descontos, acordos entre as partes…"
              value={fi.observacoes}
              onChange={(e) => setFicha("observacoes", e.target.value)}
            />
          </CardContent>
        </Card>
      </div>
      {aviso}
      {editavel && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void rodar(() => salvarPreAnalise(d.id, dados()), "Ficha salva")}
          >
            Salvar rascunho
          </Button>
          <Button
            disabled={busy || faltas.length > 0}
            title={faltas.length ? `Falta: ${faltas.join(", ")}` : undefined}
            onClick={() =>
              void rodar(async () => {
                await salvarPreAnalise(d.id, dados());
                await enviarPreAnalise(d.id);
              }, "Enviada à gestora de locação")
            }
          >
            <Send className="mr-1 h-4 w-4" /> Enviar ficha à gestora
          </Button>
        </div>
      )}
      {editavel && faltas.length > 0 && (
        <p className="text-right text-xs text-muted-foreground" data-testid="locacao-ficha-faltas">
          Falta preencher: {faltas.join(", ")}.
        </p>
      )}
    </div>
  );
}

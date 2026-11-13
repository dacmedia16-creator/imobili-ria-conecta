// Pré-aprovação da locação (etapa 1), maquete aprovada por Denis em 13/11 (t_b2ce1207; seguro.png e fiador.png).
// Ordem: quem preenche (corretor ou link do cliente) → garantia (6 opções) → imóvel → locatário → fiador (só na
// garantia fiador) → aviso → enviar à gestora. SOMENTE dados: nenhum anexo é obrigatório; o anexo da matrícula do
// fiador é opcional. Trocar a garantia grava na hora e muda o que é exigido (aqui e no link do cliente). O resto da
// ficha cadastral (t_28e583e2) fica em "Dados complementares" e não trava o envio. O banco repete toda validação
// (locacao_salvar_pre / locacao_enviar_pre / locacao_pre_faltando).
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Paperclip, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GARANTIA_LABEL,
  MOBILIA_LABEL,
  faltasPreAprovacao,
  fichaParaBanco,
  pctPorTaxa,
  pedeRendaLocatario,
  reaisNumero,
  reaisParaBanco,
  reaisParaTela,
  type ContextoLocacao,
  type FichaLocacao,
  type Garantia,
  type LocacaoDetalhe as Detalhe,
  type Pessoa,
} from "@/lib/locacao";
import {
  abrirDocumento,
  anexarDocumento,
  corretoresLocacao,
  enviarPreAnalise,
  removerDocumento,
  salvarPreAnalise,
} from "@/lib/locacao-db";
import { errorMessage } from "@/lib/errors";
import {
  LocacaoPreLinks,
  preLinksProntos,
  type StatusPreLink,
} from "@/components/locacao/LocacaoPreLinks";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";
const GARANTIAS = Object.keys(GARANTIA_LABEL) as Garantia[];
const COM_OBSERVACAO = new Set<Garantia>(["loft", "titulo_capitalizacao", "outras"]);

type Props = {
  d: Detalhe;
  ctx: ContextoLocacao;
  busy: boolean;
  rodar: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  editavel: boolean;
  aConfirmar: ReactNode;
  aviso: ReactNode;
};

const numDec = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const reais = (v: number, mostrarZero: boolean) => (v > 0 || mostrarZero ? reaisParaTela(v) : "");

/** Item da lista do fiador que recebe o anexo opcional da matrícula. Espelho de locacao_pre_item_matricula(). */
export function itemMatricula(ctx: ContextoLocacao, fiadorPessoa: Pessoa): string | null {
  const docs = ctx.config.documentos;
  const lista =
    fiadorPessoa === "pj" && docs.fiador_pj?.length ? docs.fiador_pj : (docs.fiador ?? []);
  return lista.find((x) => /matr[ií]cula/i.test(x)) ?? null;
}

function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      {children}
    </span>
  );
}

function Radio({
  ativo,
  label,
  onClick,
  disabled,
}: {
  ativo: boolean;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70 ${
        ativo ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      {label}
      <span
        aria-hidden
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
          ativo ? "border-primary bg-primary" : "border-slate-300"
        }`}
      >
        {ativo && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  );
}

export function FichaAbertura({ d, ctx, busy, rodar, editavel, aConfirmar, aviso }: Props) {
  // Pré-aprovação já salva (tem CEP): condomínio/IPTU 0 aparecem como "0,00", não como campo vazio.
  const preSalva = !!d.ficha.cep;
  const [f, setF] = useState(() => ({
    ...d.candidato,
    renda: reaisParaTela(d.candidato.renda),
    endereco: d.endereco,
    tipo: d.tipo,
    garantia: d.garantia,
    aluguel: reais(d.aluguel, false),
    condominio: reais(d.condominio, preSalva),
    iptu: reais(d.iptu, preSalva),
    taxaAdm: String(d.taxaAdm),
    parceria: d.parceria,
    captadorId: d.captadorId ?? "",
    metragem: d.ficha.metragem ? String(d.ficha.metragem) : "",
  }));
  const [fi, setFi] = useState<FichaLocacao>(() => ({
    ...d.ficha,
    fiador: { ...d.ficha.fiador, renda: reaisParaTela(d.ficha.fiador.renda) },
  }));
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [links, setLinks] = useState<StatusPreLink | null>(null);
  const [versaoLinks, setVersaoLinks] = useState(0);
  const [trocando, setTrocando] = useState(false);

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
  const setFiador = (k: keyof FichaLocacao["fiador"], v: string) =>
    setFi((x) => ({ ...x, fiador: { ...x.fiador, [k]: v } }));

  const garantia = f.garantia as Garantia;
  const fiador = garantia === "fiador";
  const candidato = {
    cpf: f.cpf.trim(),
    nome: f.nome,
    nascimento: f.nascimento,
    telefone: f.telefone,
    email: f.email.trim(),
    renda: reaisParaBanco(f.renda),
  };
  const fiadorBanco = {
    ...fi.fiador,
    cpf: fi.fiador.cpf.trim(),
    renda: reaisParaBanco(fi.fiador.renda),
  };
  const fichaAtual: FichaLocacao = { ...fi, metragem: numDec(f.metragem), fiador: fiadorBanco };
  const dados = () => ({
    candidato,
    endereco: f.endereco,
    tipo: f.tipo,
    garantia: f.garantia,
    aluguel: reaisNumero(f.aluguel) ?? 0,
    condominio: reaisNumero(f.condominio) ?? 0,
    iptu: reaisNumero(f.iptu) ?? 0,
    taxa_adm: numDec(f.taxaAdm),
    parceria: f.parceria,
    captador_id: f.captadorId || null,
    ficha: fichaParaBanco(fichaAtual),
  });
  const faltas = faltasPreAprovacao({
    garantia,
    cep: fi.cep,
    endereco: f.endereco,
    aluguel: reaisNumero(f.aluguel) ?? 0,
    condominio: reaisNumero(f.condominio),
    iptu: reaisNumero(f.iptu),
    candidato,
    fiador: fiadorBanco,
    observacao: fi.garantiaOutra,
  });
  const linksOk = preLinksProntos(links, garantia);
  const taxas = Object.keys(ctx.config.tabelaTaxa)
    .map(Number)
    .sort((a, b) => b - a);
  const gestora = ctx.pessoas.gestora?.[0]?.split(" ")[0];
  const matItem = fiador ? itemMatricula(ctx, fi.fiadorPessoa) : null;
  const anexosMat = matItem ? d.documentos.filter((x) => x.item === matItem) : [];

  // Trocar a garantia grava na hora: o link do cliente passa a pedir os campos da nova garantia.
  const trocarGarantia = (g: Garantia) => {
    if (g === garantia) return;
    const antes = garantia;
    set("garantia", g);
    if (!editavel) return;
    setTrocando(true);
    salvarPreAnalise(d.id, { garantia: g })
      .then(() => {
        setVersaoLinks((v) => v + 1);
        toast.success(`Garantia: ${GARANTIA_LABEL[g]}. Os campos exigidos foram ajustados.`);
      })
      .catch((e) => {
        set("garantia", antes);
        toast.error(errorMessage(e, "Não foi possível trocar a garantia."));
      })
      .finally(() => setTrocando(false));
  };

  const anexarMatricula = (arquivo?: File) => {
    if (!arquivo || !matItem) return;
    void rodar(async () => {
      await salvarPreAnalise(d.id, dados());
      await anexarDocumento(d.id, matItem, arquivo);
    }, "Matrícula anexada");
  };

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
  const dinheiro = { inputMode: "decimal", placeholder: "0,00" };
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
      <p className="text-sm text-muted-foreground" data-testid="locacao-pre-subtitulo">
        Pré-aprovação · <b>{GARANTIA_LABEL[garantia]}</b> ·{" "}
        {fiador ? "campos se ajustam à garantia." : "somente dados, sem anexos obrigatórios."}
      </p>

      <LocacaoPreLinks
        key={versaoLinks}
        id={d.id}
        garantia={garantia}
        editavel={editavel && !trocando}
        onStatus={setLinks}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Garantia da locação
            {aConfirmar}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ao trocar a garantia, a lista de campos exigidos muda automaticamente.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            role="radiogroup"
            aria-label="Garantia da locação"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="locacao-pre-garantias"
          >
            {GARANTIAS.map((g) => (
              <Radio
                key={g}
                ativo={garantia === g}
                label={g === "loft" ? "Loft / antiga CredPago" : GARANTIA_LABEL[g]}
                disabled={!editavel || busy || trocando}
                onClick={() => trocarGarantia(g)}
              />
            ))}
          </div>
          {COM_OBSERVACAO.has(garantia) && (
            <div className="space-y-1">
              <Label htmlFor="fi-garantia-outra">
                Observação {garantia === "outras" ? "(qual garantia)" : "(opcional)"}
              </Label>
              <Textarea
                id="fi-garantia-outra"
                disabled={!editavel}
                maxLength={300}
                rows={2}
                placeholder={
                  garantia === "outras"
                    ? "Ex.: caucionamento de imóvel, carta fiança…"
                    : "Ex.: nº da aprovação, condições combinadas…"
                }
                value={fi.garantiaOutra}
                onChange={(e) => setFicha("garantiaOutra", e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Imóvel</CardTitle>
          <Etiqueta>Obrigatório em todas as garantias</Etiqueta>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="fi-cep">CEP</Label>
            <Input
              id="fi-cep"
              disabled={!editavel}
              inputMode="numeric"
              maxLength={9}
              placeholder="00000-000"
              value={fi.cep}
              onChange={(e) => setFicha("cep", e.target.value)}
            />
          </div>
          {campo("endereco", "Endereço", { maxLength: 300 })}
          {campo("aluguel", "Aluguel (R$)", dinheiro)}
          {campo("condominio", "Condomínio (R$)", dinheiro)}
          {campo("iptu", "IPTU (R$)", dinheiro)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Locatário</CardTitle>
          <Etiqueta>Dados para pré-aprovação</Etiqueta>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {campo("cpf", "CPF", { inputMode: "numeric", placeholder: "000.000.000-00" })}
          {campo(
            "nome",
            fi.locatarioPessoa === "pj" ? "Responsável pela empresa" : "Nome completo",
          )}
          {campo("nascimento", "Nascimento", { type: "date" })}
          {campo("telefone", "Telefone", { inputMode: "tel" })}
          {campo("email", "E-mail", { type: "email" })}
          {pedeRendaLocatario(garantia) && campo("renda", "Renda mensal (R$)", dinheiro)}
        </CardContent>
      </Card>

      {fiador && (
        <Card data-testid="locacao-pre-fiador">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">Fiador</CardTitle>
            <Etiqueta>Número da matrícula obrigatório</Etiqueta>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fia-nome">Nome completo</Label>
              <Input
                id="fia-nome"
                disabled={!editavel}
                maxLength={200}
                value={fi.fiador.nome}
                onChange={(e) => setFiador("nome", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fia-cpf">CPF</Label>
              <Input
                id="fia-cpf"
                disabled={!editavel}
                inputMode="numeric"
                placeholder="000.000.000-00"
                maxLength={14}
                value={fi.fiador.cpf}
                onChange={(e) => setFiador("cpf", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fia-renda">Renda mensal (R$)</Label>
              <Input
                id="fia-renda"
                disabled={!editavel}
                inputMode="decimal"
                placeholder="0,00"
                value={fi.fiador.renda}
                onChange={(e) => setFiador("renda", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fia-matricula">Número da matrícula do imóvel</Label>
              <Input
                id="fia-matricula"
                disabled={!editavel}
                maxLength={200}
                value={fi.fiador.matricula}
                onChange={(e) => setFiador("matricula", e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="fia-matricula-arquivo">Anexar matrícula (opcional)</Label>
              {anexosMat.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <button
                    type="button"
                    className="truncate text-primary underline-offset-2 hover:underline"
                    onClick={() =>
                      void abrirDocumento(a.id).catch((e) =>
                        toast.error(errorMessage(e, "Não foi possível abrir.")),
                      )
                    }
                  >
                    {a.nomeArquivo}
                  </button>
                  {editavel && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Remover matrícula"
                      disabled={busy}
                      onClick={() => void rodar(() => removerDocumento(a.id), "Matrícula removida")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {matItem ? (
                <Input
                  id="fia-matricula-arquivo"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  disabled={!editavel || busy}
                  onChange={(e) => {
                    anexarMatricula(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  A lista de documentos do fiador desta imobiliária não tem item de matrícula.
                </p>
              )}
            </div>
            {pessoaSel("fi-fiador-pessoa", "Fiador é", fi.fiadorPessoa, (p) =>
              setFicha("fiadorPessoa", p),
            )}
          </CardContent>
        </Card>
      )}

      <div
        className="rounded-lg bg-primary/5 p-3 text-sm text-primary"
        data-testid="locacao-pre-aviso-garantia"
      >
        {fiador
          ? "Fiador: informe o número da matrícula. O arquivo da matrícula é opcional nesta etapa."
          : `${GARANTIA_LABEL[garantia]}: somente esses dados são obrigatórios agora. Nenhum documento é exigido para enviar a pré-aprovação.`}
      </div>

      <details className="rounded-xl border bg-background" data-testid="locacao-ficha-complementar">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
          Dados complementares da ficha (não travam o envio)
        </summary>
        <div className="grid grid-cols-1 gap-3 p-3 pt-0 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Imóvel e valores</CardTitle>
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
              <div className="space-y-1">
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
              </div>
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
              <CardTitle className="text-sm">Locatário e proprietário</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {pessoaSel("fi-loc-pessoa", "Locatário é", fi.locatarioPessoa, (p) =>
                setFicha("locatarioPessoa", p),
              )}
              <div className="space-y-1">
                <Label htmlFor="fi-loc-endereco">Endereço residencial atual do locatário</Label>
                <Input
                  id="fi-loc-endereco"
                  disabled={!editavel}
                  maxLength={300}
                  value={fi.locatarioEndereco}
                  onChange={(e) => setFicha("locatarioEndereco", e.target.value)}
                />
              </div>
              {pessoaSel("fi-prop-pessoa", "Proprietário é", fi.proprietarioPessoa, (p) =>
                setFicha("proprietarioPessoa", p),
              )}
              <div className="space-y-1">
                <Label htmlFor="fi-prop-nome">
                  {fi.proprietarioPessoa === "pj"
                    ? "Razão social / representante"
                    : "Nome do proprietário"}
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
                <Label htmlFor="fi-prop-tel">Telefone do proprietário</Label>
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
                <Label htmlFor="fi-prop-email">E-mail do proprietário</Label>
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
                Responsável e captador diferentes: comissão meio a meio (só registrado aqui; o
                cálculo vem numa próxima entrega).
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
                rows={4}
                placeholder="Isenção, descontos, acordos entre as partes…"
                value={fi.observacoes}
                onChange={(e) => setFicha("observacoes", e.target.value)}
              />
            </CardContent>
          </Card>
        </div>
      </details>

      {aviso}
      {editavel && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy || trocando}
            onClick={() => void rodar(() => salvarPreAnalise(d.id, dados()), "Pré-aprovação salva")}
          >
            Salvar rascunho
          </Button>
          <Button
            disabled={busy || trocando || faltas.length > 0 || !linksOk}
            title={
              faltas.length
                ? `Falta: ${faltas.join(", ")}`
                : !linksOk
                  ? "Aguarde o envio de todas as partes pelo link"
                  : undefined
            }
            data-testid="locacao-pre-enviar"
            onClick={() =>
              void rodar(async () => {
                await salvarPreAnalise(d.id, dados());
                await enviarPreAnalise(d.id);
              }, "Enviada à gestora de locação")
            }
          >
            <Send className="mr-1 h-4 w-4" /> Enviar para {gestora ?? "a gestora"}
          </Button>
        </div>
      )}
      {editavel && (faltas.length > 0 || !linksOk) && (
        <p className="text-right text-xs text-muted-foreground" data-testid="locacao-ficha-faltas">
          {faltas.length ? `Falta preencher: ${faltas.join(", ")}.` : ""}
          {!linksOk ? " Aguardando o envio pelo link do cliente." : ""}
        </p>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Pencil, Power, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { guardPlatformRoute } from "./plataforma.imobiliarias";
import {
  listPlatformUsersFn,
  platformResetPasswordFn,
  platformSetActiveFn,
  platformSetRoleFn,
  platformUpdateUserFn,
} from "@/lib/platform-users.functions";
import type { PlatformUserRow } from "@/lib/platform-users.server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/plataforma/usuarios")({
  head: () => ({ meta: [{ title: "Usuários — Plataforma" }] }),
  beforeLoad: guardPlatformRoute,
  component: PlatformUsers,
});

const ROLE_OPTIONS: AppRole[] = [
  "corretor",
  "gestor",
  "team_leader",
  "juridico",
  "financeiro",
  "lancamento",
  "staff",
  "admin",
  "super_admin",
];

type Situacao = "todos" | "ativos" | "inativos" | "nunca" | "30d";
type Action =
  | { kind: "senha"; user: PlatformUserRow }
  | { kind: "ativo"; user: PlatformUserRow }
  | { kind: "papeis"; user: PlatformUserRow }
  | { kind: "editar"; user: PlatformUserRow };

const DAY = 86_400_000;

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function lastAccessLabel(iso: string | null) {
  if (!iso) return "Nunca entrou";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / DAY);
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (days <= 0) return `Hoje (${data})`;
  if (days === 1) return `Ontem (${data})`;
  return `Há ${days} dias (${data})`;
}

function PlatformUsers() {
  const { user: me } = useAuth();
  const listFn = useServerFn(listPlatformUsersFn);
  const [rows, setRows] = useState<PlatformUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [org, setOrg] = useState("todas");
  const [papel, setPapel] = useState("todos");
  const [situacao, setSituacao] = useState<Situacao>("todos");
  const [action, setAction] = useState<Action | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listFn());
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível carregar os usuários."));
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const orgs = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.organizationId, r.organizationNome])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.nome} ${r.email ?? ""}`.toLowerCase().includes(q)) return false;
      if (org !== "todas" && r.organizationId !== org) return false;
      if (papel !== "todos" && !r.roles.includes(papel as never)) return false;
      if (situacao === "ativos" && !r.ativo) return false;
      if (situacao === "inativos" && r.ativo) return false;
      if (situacao === "nunca" && (r.lastSignInAt || !r.ativo)) return false;
      if (situacao === "30d") {
        if (!r.ativo) return false;
        if (r.lastSignInAt && Date.now() - new Date(r.lastSignInAt).getTime() < 30 * DAY)
          return false;
      }
      return true;
    });
  }, [rows, busca, org, papel, situacao]);

  const resumo = useMemo(() => {
    const ativos = rows.filter((r) => r.ativo);
    return {
      total: rows.length,
      ativos: ativos.length,
      nunca: ativos.filter((r) => !r.lastSignInAt).length,
      semAcesso30: ativos.filter(
        (r) => r.lastSignInAt && Date.now() - new Date(r.lastSignInAt).getTime() >= 30 * DAY,
      ).length,
    };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6" aria-hidden /> Usuários da plataforma
          </h1>
          <p className="text-sm text-muted-foreground">
            Todos os usuários de todas as imobiliárias. Toda alteração pede motivo e fica na
            auditoria da imobiliária do usuário.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/plataforma/imobiliarias">Voltar ao Painel da Plataforma</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ["Usuários cadastrados", resumo.total, "todos"],
            ["Ativos", resumo.ativos, "ativos"],
            ["Ativos que nunca entraram", resumo.nunca, "nunca"],
            ["Sem acesso há 30+ dias", resumo.semAcesso30, "30d"],
          ] as [string, number, Situacao][]
        ).map(([label, n, s]) => (
          <button
            key={label}
            type="button"
            onClick={() => setSituacao(s)}
            className={`rounded-lg border p-3 text-left transition hover:bg-muted ${situacao === s ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <div className="text-2xl font-semibold">{n}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input
            placeholder="Buscar por nome ou e-mail"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar"
          />
          <Select value={org} onValueChange={setOrg}>
            <SelectTrigger aria-label="Imobiliária">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as imobiliárias</SelectItem>
              {orgs.map(([id, nome]) => (
                <SelectItem key={id} value={id}>
                  {nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={papel} onValueChange={setPapel}>
            <SelectTrigger aria-label="Papel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os papéis</SelectItem>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={situacao} onValueChange={(v) => setSituacao(v as Situacao)}>
            <SelectTrigger aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as situações</SelectItem>
              <SelectItem value="ativos">Ativos</SelectItem>
              <SelectItem value="inativos">Desativados</SelectItem>
              <SelectItem value="nunca">Ativos que nunca entraram</SelectItem>
              <SelectItem value="30d">Sem acesso há 30+ dias</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {loading ? "Carregando…" : `${filtered.length} usuário(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Usuário</th>
                <th className="p-3">Imobiliária</th>
                <th className="p-3">Papéis</th>
                <th className="p-3">Situação</th>
                <th className="p-3">Último acesso</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={`${u.organizationId}:${u.id}`} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{u.nome}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="p-3">{u.organizationNome}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && (
                          <span className="text-xs text-muted-foreground">Sem papel</span>
                        )}
                        {u.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {ROLE_LABEL[r as AppRole] ?? r}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      {u.ativo ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativo</Badge>
                      ) : (
                        <Badge variant="destructive">Desativado</Badge>
                      )}
                    </td>
                    <td
                      className={`p-3 text-xs ${!u.lastSignInAt ? "font-medium text-amber-700" : ""}`}
                    >
                      {lastAccessLabel(u.lastSignInAt)}
                    </td>
                    <td className="p-3">
                      {isMe ? (
                        <span className="block text-right text-xs text-muted-foreground">
                          Sua conta — use Meu acesso
                        </span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Editar dados"
                            onClick={() => setAction({ kind: "editar", user: u })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Trocar senha"
                            onClick={() => setAction({ kind: "senha", user: u })}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Papéis"
                            onClick={() => setAction({ kind: "papeis", user: u })}
                          >
                            <ShieldCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={u.ativo ? "Desativar" : "Ativar"}
                            className={u.ativo ? "text-destructive" : "text-emerald-700"}
                            onClick={() => setAction({ kind: "ativo", user: u })}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nenhum usuário com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {action && (
        <ActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ActionDialog({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: () => void;
}) {
  const resetFn = useServerFn(platformResetPasswordFn);
  const activeFn = useServerFn(platformSetActiveFn);
  const roleFn = useServerFn(platformSetRoleFn);
  const updateFn = useServerFn(platformUpdateUserFn);
  const u = action.user;
  const [motivo, setMotivo] = useState("");
  const [password, setPassword] = useState(() => genPassword());
  const [nome, setNome] = useState(u.nome);
  const [email, setEmail] = useState(u.email ?? "");
  const [telefone, setTelefone] = useState(u.telefone ?? "");
  const [roles, setRoles] = useState<string[]>(u.roles);
  const [saving, setSaving] = useState(false);
  const motivoOk = motivo.trim().length >= 5;

  const title = {
    senha: "Trocar senha",
    ativo: u.ativo ? "Desativar usuário" : "Ativar usuário",
    papeis: "Papéis do usuário",
    editar: "Editar dados",
  }[action.kind];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivoOk) return;
    setSaving(true);
    try {
      const m = motivo.trim();
      if (action.kind === "senha") {
        await resetFn({ data: { userId: u.id, password, motivo: m } });
        toast.success("Senha trocada. Passe a senha nova ao usuário por um canal seguro.");
      } else if (action.kind === "ativo") {
        await activeFn({ data: { userId: u.id, ativo: !u.ativo, motivo: m } });
        toast.success(u.ativo ? "Usuário desativado." : "Usuário ativado.");
      } else if (action.kind === "editar") {
        await updateFn({
          data: { userId: u.id, nome, email, telefone: telefone || null, motivo: m },
        });
        toast.success("Dados atualizados.");
      } else {
        const add = roles.filter((r) => !u.roles.includes(r as never));
        const del = u.roles.filter((r) => !roles.includes(r));
        for (const r of add)
          await roleFn({ data: { userId: u.id, role: r as never, grant: true, motivo: m } });
        for (const r of del)
          await roleFn({ data: { userId: u.id, role: r as never, grant: false, motivo: m } });
        toast.success(add.length + del.length ? "Papéis atualizados." : "Nada mudou.");
      }
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível salvar."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {u.nome} — {u.organizationNome}
            </DialogDescription>
          </DialogHeader>

          {action.kind === "senha" && (
            <div className="space-y-1">
              <Label htmlFor="pu-pass">Nova senha</Label>
              <div className="flex gap-2">
                <Input
                  id="pu-pass"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={72}
                  required
                />
                <Button type="button" variant="outline" onClick={() => setPassword(genPassword())}>
                  Gerar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Copie antes de salvar. Peça ao usuário para trocar em "Meu acesso".
              </p>
            </div>
          )}

          {action.kind === "ativo" && (
            <p className="text-sm">
              {u.ativo
                ? "O usuário deixa de conseguir usar o sistema até ser ativado de novo. Nada é apagado."
                : "O usuário volta a conseguir entrar no sistema."}
            </p>
          )}

          {action.kind === "editar" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="pu-nome">Nome</Label>
                <Input
                  id="pu-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pu-email">E-mail (é o login)</Label>
                <Input
                  id="pu-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pu-tel">Telefone</Label>
                <Input id="pu-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
              </div>
            </div>
          )}

          {action.kind === "papeis" && (
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={(e) =>
                      setRoles((cur) =>
                        e.target.checked ? [...cur, r] : cur.filter((x) => x !== r),
                      )
                    }
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          )}

          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/30">
            <Label htmlFor="pu-motivo">Motivo (obrigatório)</Label>
            <Input
              id="pu-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={300}
              placeholder="Ex.: pedido do administrador da imobiliária"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Fica registrado na auditoria de {u.organizationNome} com o seu nome.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving || !motivoOk}
              variant={action.kind === "ativo" && u.ativo ? "destructive" : "default"}
            >
              {saving ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

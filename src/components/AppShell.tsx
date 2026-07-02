import { Link, useRouter } from "@tanstack/react-router";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Building2, Home, FileText, Users, LogOut, Bell, ShieldCheck } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, roles, signOut, hasAny } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  const nav = [
    { to: "/", label: "Dashboard", icon: Home, show: true },
    { to: "/vendas", label: "Vendas", icon: FileText, show: true },
    { to: "/notificacoes", label: "Notificações", icon: Bell, show: true },
    { to: "/perfil", label: "Meu acesso", icon: ShieldCheck, show: true },
    { to: "/admin/usuarios", label: "Usuários", icon: Users, show: hasAny(["admin","super_admin"]) },
  ];

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="font-semibold">Portal Imobiliária</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.filter(n => n.show).map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent font-medium" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="mb-1 truncate font-medium text-sidebar-foreground">{user?.email}</div>
          <div className="mb-2 text-muted-foreground">{roles.map(r => ROLE_LABEL[r]).join(", ") || "Sem papel"}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>
      <main className="md:pl-60">
        <div className="mx-auto max-w-6xl p-4 md:p-8">
          <div className="mb-2 flex justify-end md:hidden"><NotificationBell /></div>
          <div className="mb-4 hidden justify-end md:flex"><NotificationBell /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

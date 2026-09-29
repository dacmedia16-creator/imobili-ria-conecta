export type ContaMaxErrorCode =
  | "SEM_TICKET"
  | "TIMEOUT_PONTE"
  | "TIMEOUT_SESSAO"
  | "PONTE_401"
  | "PONTE_ERRO"
  | "SEM_TOKEN"
  | "SESSAO_ERRO";

export type ContaMaxFailure = { code: ContaMaxErrorCode; message: string; at: Date };

const messages: Record<ContaMaxErrorCode, string> = {
  SEM_TICKET: "O passe de acesso não foi encontrado.",
  TIMEOUT_PONTE: "A validação do acesso demorou demais. Tente de novo.",
  TIMEOUT_SESSAO: "A criação da sessão demorou demais. Tente de novo.",
  PONTE_401: "O passe de acesso não foi aceito. Tente entrar novamente.",
  PONTE_ERRO: "Não foi possível concluir o acesso pela Conta MAX.",
  SEM_TOKEN: "Não foi possível concluir o acesso pela Conta MAX.",
  SESSAO_ERRO: "Não foi possível concluir a sessão pela Conta MAX.",
};

export function startContaMaxBridge(options: {
  ticket: string | null;
  returnTo: string | null;
  invoke: (ticket: string) => Promise<{
    data: { access_token?: string; refresh_token?: string } | null;
    error: { context?: { status?: number } } | null;
  }>;
  setSession: (tokens: {
    access_token: string;
    refresh_token: string;
  }) => Promise<{ error: unknown }>;
  navigate: (to: "/reservas-salas" | "/dashboard") => Promise<unknown>;
  onError: (failure: ContaMaxFailure) => void;
  timeoutMs?: number;
}): () => void {
  let active = true;
  let phase: "ponte" | "sessao" = "ponte";
  const timer = options.ticket
    ? setTimeout(
        () => fail(phase === "ponte" ? "TIMEOUT_PONTE" : "TIMEOUT_SESSAO"),
        options.timeoutMs ?? 15_000,
      )
    : undefined;
  const fail = (code: ContaMaxErrorCode) => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    options.onError({ code, message: messages[code], at: new Date() });
  };

  if (!options.ticket) {
    fail("SEM_TICKET");
    return () => {
      active = false;
    };
  }

  const ticket = options.ticket;
  void (async () => {
    try {
      const { data, error } = await options.invoke(ticket);
      if (!active) return;
      if (error) {
        fail(error.context?.status === 401 ? "PONTE_401" : "PONTE_ERRO");
        return;
      }
      if (!data?.access_token || !data?.refresh_token) {
        fail("SEM_TOKEN");
        return;
      }
      phase = "sessao";
      const { error: sessionError } = await options.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (!active) return;
      if (sessionError) {
        fail("SESSAO_ERRO");
        return;
      }
      active = false;
      clearTimeout(timer);
      await options.navigate(
        options.returnTo === "/reservas-salas" ? "/reservas-salas" : "/dashboard",
      );
    } catch {
      fail(phase === "ponte" ? "PONTE_ERRO" : "SESSAO_ERRO");
    }
  })();

  return () => {
    active = false;
    clearTimeout(timer);
  };
}

export function retryContaMaxLogin(options: {
  supabaseUrl: string | undefined;
  homolog: boolean;
  returnTo: string | null;
  storage: Pick<Storage, "removeItem">;
  signOut: () => Promise<unknown>;
  replace: (url: string) => void;
}) {
  // A renovação presa pode manter o lock do SDK: não espere signOut para sair da página.
  try {
    void options.signOut().catch(() => {});
  } catch {
    /* seguir para o login */
  }
  try {
    if (options.supabaseUrl) {
      const ref = new URL(options.supabaseUrl).hostname.split(".")[0];
      options.storage.removeItem(`sb-${ref}-auth-token`);
    }
  } catch {
    /* armazenamento indisponível: o redirecionamento continua */
  }
  const url = new URL("https://conta-max-poc.dacmedia16.workers.dev/login");
  url.searchParams.set("app", options.homolog ? "adm-max-homolog" : "adm-max");
  if (options.returnTo === "/reservas-salas") url.searchParams.set("return_to", options.returnTo);
  options.replace(url.toString());
}

import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { routerAuth } from "./lib/route-access";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    // auth: login + cargos para as guardas beforeLoad (ver src/lib/route-access.ts).
    context: { queryClient, auth: routerAuth },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

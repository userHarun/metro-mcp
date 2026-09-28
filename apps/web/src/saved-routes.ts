import { z } from "zod";
import { routeSchema, type Route } from "./api";

export const savedRoutesKey = "metro-saved-routes";
const maxSavedRoutes = 5;

export function loadSavedRoutes(storage?: Pick<Storage, "getItem">): Route[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(savedRoutesKey);
    if (!raw) return [];
    const parsed = z.array(routeSchema).max(maxSavedRoutes).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function addSavedRoute(routes: Route[], route: Route): Route[] {
  if (routes.some((saved) => saved.routeId === route.routeId)) return routes;
  return [...routes, route].slice(-maxSavedRoutes);
}

export function removeSavedRoute(routes: Route[], routeId: string): Route[] {
  return routes.filter((route) => route.routeId !== routeId);
}

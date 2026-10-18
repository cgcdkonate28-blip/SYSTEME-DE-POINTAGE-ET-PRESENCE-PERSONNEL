import { NextResponse } from "next/server";
import { getSession, rolesDepuisReferer } from "@/lib/adminSession";

type Ctx = { params: Promise<{ chemin: string[] }> };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function creerRelais(prefixe: string, roles: string[] | "referer") {
  return async function relayer(req: Request, ctx: Ctx) {
    const s = await getSession(roles === "referer" ? rolesDepuisReferer(req) : roles);
    if (!s) return NextResponse.json({ detail: "Non autorisé" }, { status: 401 });

    const { chemin } = await ctx.params;
    const recherche = new URL(req.url).search;
    const url = `http://127.0.0.1:8000/${prefixe}/${chemin.map(encodeURIComponent).join("/")}${recherche}`;
    const corps = req.method === "GET" || req.method === "DELETE" ? undefined : await req.text();
    // On ne retente que les lectures : jamais une écriture (paiement, message, séance).
    const essais = req.method === "GET" ? 3 : 1;

    for (let i = 0; i < essais; i++) {
      try {
        const r = await fetch(url, {
          method: req.method,
          headers: {
            "X-Token": process.env.INTERNAL_TOKEN ?? "",
            "X-Admin-Id": s.id,
            "X-Admin-Role": s.role,
            "Content-Type": "application/json",
          },
          body: corps,
          cache: "no-store",
        });
        const texte = await r.text();
        // Un refus du service Python n'est PAS une session expirée : on ne déconnecte pas.
        if (r.status === 401)
          return NextResponse.json(
            { detail: "Le service Python a refusé le jeton interne : vérifie INTERNAL_TOKEN dans les deux fichiers .env" },
            { status: 500 }
          );
        if (r.status >= 500 && i < essais - 1) {
          await pause(400);
          continue;
        }
        try {
          return NextResponse.json(JSON.parse(texte), { status: r.status });
        } catch {
          return NextResponse.json({ detail: `Service : erreur ${r.status}` }, { status: 502 });
        }
      } catch {
        if (i < essais - 1) {
          await pause(400);
          continue;
        }
        return NextResponse.json({ detail: "Service injoignable (port 8000)" }, { status: 503 });
      }
    }
    return NextResponse.json({ detail: "Erreur inconnue" }, { status: 500 });
  };
}
import { NextResponse } from "next/server";
import { creerJeton, nomCookie } from "@/lib/adminSession";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const ACCUEIL: Record<string, string> = {
  RH: "/admin/rh",
  Scolarite: "/admin/scolarite",
  Paie: "/admin/paie",
  DirectionGenerale: "/admin/direction",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const nom = String(body.nom ?? "").trim();
  const cle = norm(String(body.cle ?? ""));

  const echec = async () => {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ ok: false, raison: "Nom ou clé incorrect" }, { status: 401 });
  };

  if (!process.env.ADMIN_SESSION_SECRET)
    return NextResponse.json({ ok: false, raison: "Configuration manquante : ADMIN_SESSION_SECRET" }, { status: 500 });
  if (!nom || !cle) return echec();

  const cles: Record<string, string> = {
    RH: norm(process.env.ADMIN_CLE_RH ?? ""),
    Scolarite: norm(process.env.ADMIN_CLE_SCOLARITE ?? ""),
    Paie: norm(process.env.ADMIN_CLE_PAIE ?? ""),
    DirectionGenerale: norm(process.env.ADMIN_CLE_DG ?? ""),
  };

  let agent: { id: string; nom: string; prenom: string; role: string };
  try {
    const r = await fetch(`http://127.0.0.1:8000/rh/identifier?nom=${encodeURIComponent(nom)}`, {
      headers: { "X-Token": process.env.INTERNAL_TOKEN ?? "" },
      cache: "no-store",
    });
    if (r.status === 404) return echec();
    if (!r.ok) return NextResponse.json({ ok: false, raison: `Service : erreur ${r.status}` }, { status: 502 });
    agent = await r.json();
  } catch {
    return NextResponse.json({ ok: false, raison: "Service injoignable (port 8000)" }, { status: 503 });
  }

  if (!cles[agent.role] || cles[agent.role] !== cle) return echec();
  if (!ACCUEIL[agent.role])
    return NextResponse.json({ ok: false, raison: "L'espace de ce groupe n'est pas encore ouvert" }, { status: 403 });

  const res = NextResponse.json({ ok: true, redirect: ACCUEIL[agent.role] });
  res.cookies.set(nomCookie(agent.role), creerJeton({ id: agent.id, nom: agent.nom, prenom: agent.prenom, role: agent.role }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 3600,
  });
  res.cookies.set("admin_session", "", { path: "/", maxAge: 0 });
  return res;
}
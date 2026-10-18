import { cookies } from "next/headers";
import { connection } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE = "admin_session"; // ancien cookie unique, supprimé à la connexion
export const ROLES = ["RH", "Scolarite", "Paie", "DirectionGenerale"];
export const nomCookie = (role: string) => `admin_session_${role}`;
export type Session = { id: string; nom: string; prenom: string; role: string; exp: number };

const secret = () => (process.env.ADMIN_SESSION_SECRET ?? "").trim();
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function creerJeton(s: Omit<Session, "exp">) {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + 8 * 3600 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function lireJeton(jeton?: string): Session | null {
  if (!jeton || !secret()) return null;
  const [payload, sig] = jeton.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString());
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

// Cherche une session valide parmi les rôles demandés (un cookie par espace).
export async function getSession(roles: string[] = ROLES) {
  await connection();
  const jar = await cookies();
  for (const r of roles) {
    const s = lireJeton(jar.get(nomCookie(r))?.value);
    if (s && s.role === r) return s;
  }
  return null;
}

// Déduit l'espace de la page d'où vient la requête (pour la messagerie et la déconnexion).
export function rolesDepuisReferer(req: Request): string[] {
  try {
    const p = new URL(req.headers.get("referer") ?? "").pathname;
    if (p.startsWith("/admin/rh")) return ["RH", "DirectionGenerale"];
    if (p.startsWith("/admin/scolarite")) return ["Scolarite", "DirectionGenerale"];
    if (p.startsWith("/admin/paie")) return ["Paie", "DirectionGenerale"];
    if (p.startsWith("/admin/direction")) return ["DirectionGenerale"];
  } catch {
    /* pas de referer */
  }
  return ROLES;
}
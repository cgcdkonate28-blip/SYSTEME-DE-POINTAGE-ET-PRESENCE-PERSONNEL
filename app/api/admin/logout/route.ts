import { NextResponse } from "next/server";
import { getSession, rolesDepuisReferer, nomCookie } from "@/lib/adminSession";

export async function POST(req: Request) {
  const s = await getSession(rolesDepuisReferer(req));
  const res = NextResponse.json({ ok: true });
  if (s) res.cookies.set(nomCookie(s.role), "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set("admin_session", "", { path: "/", maxAge: 0 });
  return res;
}
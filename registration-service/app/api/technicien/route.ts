import { NextResponse } from "next/server";
import { createHash } from "crypto";

const norm = (s?: string) =>
  (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export async function GET() {
  const k = norm(process.env.TECHNICIEN_KEY);
  return NextResponse.json({
    version: "v3",
    cle_lue_par_le_serveur: k.length > 0,
    longueur: k.length,
    debut: k.slice(0, 2),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const attendue = norm(process.env.TECHNICIEN_KEY);
  const recue = norm(body.cle);

  if (!attendue) {
    return NextResponse.json(
      { ok: false, raison: "Clé absente côté serveur : relance npm run dev" },
      { status: 500 }
    );
  }
  if (recue !== attendue) {
    return NextResponse.json(
      {
        ok: false,
        raison: `Clé incorrecte (serveur : ${attendue.length} car., reçue : ${recue.length} car.)`,
      },
      { status: 401 }
    );
  }

  const jeton = createHash("sha256").update(attendue + "eigsi").digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("tech_ok", jeton, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  return res;
}

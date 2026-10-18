import { NextResponse } from "next/server";
import { estTechnicien } from "@/lib/techAuth";

export async function POST(req: Request) {
  if (!(await estTechnicien()))
    return NextResponse.json({ detail: "Non autorisé" }, { status: 401 });
  try {
    const r = await fetch("http://127.0.0.1:8000/inscrire", {
      method: "POST",
      headers: { "X-Token": process.env.INTERNAL_TOKEN ?? "" },
      body: await req.formData(),
    });
    const d = await r.json().catch(() => ({ detail: "Réponse invalide du service" }));
    return NextResponse.json(d, { status: r.status });
  } catch {
    return NextResponse.json({ detail: "Service d'inscription injoignable (port 8000)" }, { status: 503 });
  }
}


import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { matricule } = await req.json().catch(() => ({}));
  if (!/^EIGSI-\d{6}$/.test(matricule ?? ""))
    return NextResponse.json({ detail: "Carte non reconnue" }, { status: 400 });
  try {
    const r = await fetch(`http://127.0.0.1:8000/agent/${matricule}`, {
      headers: { "X-Token": process.env.INTERNAL_TOKEN ?? "" },
      cache: "no-store",
    });
    const texte = await r.text();
    try {
      return NextResponse.json(JSON.parse(texte), { status: r.status });
    } catch {
      return NextResponse.json({ detail: `Service : erreur ${r.status}` }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ detail: "Service injoignable (port 8000)" }, { status: 503 });
  }
}

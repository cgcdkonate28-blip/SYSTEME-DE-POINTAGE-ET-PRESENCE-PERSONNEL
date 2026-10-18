import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const r = await fetch("http://127.0.0.1:8000/pointer", {
      method: "POST",
      headers: { "X-Token": process.env.INTERNAL_TOKEN ?? "" },
      body: await req.formData(),
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

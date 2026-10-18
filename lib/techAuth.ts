import { cookies } from "next/headers";
import { createHash } from "crypto";

const norm = (s?: string) =>
  (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

export async function estTechnicien() {
  const cle = norm(process.env.TECHNICIEN_KEY);
  if (!cle) return false;
  const attendu = createHash("sha256").update(cle + "eigsi").digest("hex");
  return (await cookies()).get("tech_ok")?.value === attendu;
}
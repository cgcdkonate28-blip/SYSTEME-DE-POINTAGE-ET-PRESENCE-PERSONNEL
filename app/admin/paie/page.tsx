import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/adminSession";
import PaieClient from "./PaieClient";

async function Garde() {
  const s = await getSession(["Paie", "DirectionGenerale"]);
  if (!s) redirect("/admin/connexion");
  return <PaieClient nom={s.nom} prenom={s.prenom} role={s.role} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Garde />
    </Suspense>
  );
}

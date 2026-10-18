import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/adminSession";
import DirectionClient from "./DirectionClient";

async function Garde() {
  const s = await getSession(["DirectionGenerale"]);
  if (!s) redirect("/admin/connexion");
  return <DirectionClient nom={s.nom} prenom={s.prenom} role={s.role} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Garde />
    </Suspense>
  );
}

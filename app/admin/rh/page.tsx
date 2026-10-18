import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/adminSession";
import RhClient from "./RhClient";

async function Garde() {
  const s = await getSession(["RH", "DirectionGenerale"]);
  if (!s) redirect("/admin/connexion");
  return <RhClient nom={s.nom} prenom={s.prenom} role={s.role} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <Garde />
    </Suspense>
  );
}

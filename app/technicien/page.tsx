import { Suspense } from "react";
import { cookies } from "next/headers";
import { estTechnicien } from "@/lib/techAuth";
import TechnicienClient from "./TechnicienClient";

async function Garde() {
  if (await estTechnicien()) return <TechnicienClient />;
  const cookiePresent = (await cookies()).has("tech_ok");
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-2xl bg-slate-900 p-8 text-center">
        <h1 className="text-xl font-bold">Acces refuse</h1>
        <p className="mt-3 text-white/70">
          {cookiePresent
            ? "Un cookie existe mais il est invalide : supprime-le et reconnecte-toi."
            : "Aucun cookie d'acces : saisis la cle depuis la page d'accueil."}
        </p>
        <a href="/" className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-2 font-semibold">
          Retour a l'accueil
        </a>
      </div>
    </main>
  );
}

export default function Technicien() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <Garde />
    </Suspense>
  );
}
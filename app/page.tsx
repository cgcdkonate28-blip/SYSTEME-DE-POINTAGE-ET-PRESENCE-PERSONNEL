"use client";
import { useEffect, useRef, useState } from "react";
import Pointage from "@/components/Pointage";
import { useRouter } from "next/navigation";

const MESSAGES = [
  "BIENVENUE À L'EIGSI",
  "ÉCOLE D'INGÉNIEUR",
  "RÉPERTOIRE DU PERSONNEL",
  "GESTION ET POINTAGE DU PERSONNEL",
];

function Typewriter() {
  const [i, setI] = useState(0);
  const [txt, setTxt] = useState("");
  const [del, setDel] = useState(false);

  useEffect(() => {
    const full = MESSAGES[i];
    let delay = del ? 35 : 80;
    if (!del && txt === full) delay = 1800;
    const t = setTimeout(() => {
      if (!del && txt === full) setDel(true);
      else if (del && txt === "") {
        setDel(false);
        setI((i + 1) % MESSAGES.length);
      } else {
        setTxt(del ? full.slice(0, txt.length - 1) : full.slice(0, txt.length + 1));
      }
    }, delay);
    return () => clearTimeout(t);
  }, [txt, del, i]);

  return (
    <span>
      {txt}
      <span className="animate-pulse">|</span>
    </span>
  );
}

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [modePointage, setModePointage] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [nom, setNom] = useState("");
  const [cleAdmin, setCleAdmin] = useState("");
  const [cleTech, setCleTech] = useState("");
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = true;
      v.play().catch(() => {});
    }
  }, []);

  async function entrerTechnicien(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    const r = await fetch("/api/technicien", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle: cleTech }),
    });
    if (r.ok) window.location.href = "/technicien";
    else setErreur("Clé incorrecte");
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden text-white">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="fixed inset-0 z-0 h-full w-full object-cover"
      >
        <source src="/videos/fond.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none fixed inset-0 z-0 bg-black/40" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-10 px-6 text-center">
        {!modePointage ? (
          <>
            <h1 className="min-h-[3rem] text-2xl font-bold tracking-widest sm:text-4xl">
              <Typewriter />
            </h1>
            <button
              onClick={() => { window.location.href = "/admin/connexion"; }}
              className="rounded-full bg-blue-600 px-10 py-3 text-lg font-semibold shadow-lg transition hover:bg-blue-500"
            >
              Connexion
            </button>
          </>
        ) : (
          <Pointage />
        )}
      </div>

      {/* Switch caché ON/OFF (bas droite) */}
      <button
        onClick={() => setModePointage(!modePointage)}
        title="Mode"
        className="fixed bottom-4 right-4 z-20 flex h-6 w-11 items-center rounded-full bg-white/20 p-0.5 opacity-10 transition hover:opacity-70"
      >
        <span
          className={`h-5 w-5 rounded-full bg-white transition-transform ${
            modePointage ? "translate-x-5" : ""
          }`}
        />
      </button>

      {/* Clé à molette cachée (bas gauche) */}
      <button
        onClick={() => {
          setErreur("");
          setCleTech("");
          setTechOpen(true);
        }}
        title="Espace technicien"
        className="fixed bottom-4 left-16 z-20 text-xl opacity-10 transition hover:opacity-70"
      >
        🔧
      </button>

      {/* Modale connexion admin */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              alert("Connexion admin : à brancher sur la base de données");
            }}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-slate-900 p-8"
          >
            <h2 className="text-xl font-bold">Connexion</h2>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Nom"
              className="w-full rounded-lg bg-slate-800 px-4 py-2 outline-none"
            />
            <input
              value={cleAdmin}
              onChange={(e) => setCleAdmin(e.target.value)}
              type="password"
              placeholder="Clé spéciale"
              className="w-full rounded-lg bg-slate-800 px-4 py-2 outline-none"
            />
            <div className="flex gap-3">
              <button type="submit" className="flex-1 rounded-lg bg-blue-600 py-2 font-semibold">
                Se connecter
              </button>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                className="flex-1 rounded-lg bg-slate-700 py-2"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale espace technicien */}
      {techOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={entrerTechnicien}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-slate-900 p-8"
          >
            <h2 className="text-xl font-bold">Espace technicien</h2>
            <input
              value={cleTech}
              onChange={(e) => setCleTech(e.target.value)}
              type="password"
              placeholder="Clé technicien"
              autoFocus
              className="w-full rounded-lg bg-slate-800 px-4 py-2 outline-none"
            />
            {erreur && <p className="text-sm text-red-400">{erreur}</p>}
            <div className="flex gap-3">
              <button type="submit" className="flex-1 rounded-lg bg-blue-600 py-2 font-semibold">
                Entrer
              </button>
              <button
                type="button"
                onClick={() => setTechOpen(false)}
                className="flex-1 rounded-lg bg-slate-700 py-2"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}




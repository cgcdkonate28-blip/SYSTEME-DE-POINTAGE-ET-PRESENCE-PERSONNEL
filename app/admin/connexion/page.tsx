"use client";
import { useState } from "react";

export default function Connexion() {
  const [nom, setNom] = useState("");
  const [cle, setCle] = useState("");
  const [voir, setVoir] = useState(false);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function valider(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom, cle }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) window.location.href = d.redirect ?? "/admin/rh";
      else setErreur(d.raison ?? `Erreur ${r.status}`);
    } catch {
      setErreur("Le serveur ne répond pas");
    }
    setEnvoi(false);
  }

  return (
    <div className="relative min-h-screen bg-white text-gray-900 overflow-hidden flex items-center justify-center px-4">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-25 bg-blue-400 animate-pulse" />
      <div
        className="absolute top-1/3 -right-32 w-96 h-96 rounded-full blur-3xl opacity-25 bg-slate-400 animate-pulse"
        style={{ animationDelay: "1s" }}
      />
      <form
        onSubmit={valider}
        className="relative z-10 w-full max-w-sm bg-white/85 backdrop-blur border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-slate-700 flex items-center justify-center text-xl text-white shadow-lg">
            🛡️
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-widest">EIGSI</p>
            <h1 className="text-xl font-extrabold leading-tight">Espace administrateur</h1>
          </div>
        </div>
        <input
          required
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Ton nom"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
        />
        <input
          required
          value={cle}
          onChange={(e) => setCle(e.target.value)}
          type={voir ? "text" : "password"}
          placeholder="Clé de ton groupe"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={voir} onChange={(e) => setVoir(e.target.checked)} />
          Afficher la clé
        </label>
        {erreur && <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}
        <button
          type="submit"
          disabled={envoi}
          className="w-full rounded-xl bg-gradient-to-br from-blue-500 to-slate-700 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {envoi ? "Connexion…" : "Se connecter"}
        </button>
        <a href="/" className="block text-center text-sm text-gray-400 hover:text-gray-600">
          ← Retour à l'accueil
        </a>
      </form>
    </div>
  );
}
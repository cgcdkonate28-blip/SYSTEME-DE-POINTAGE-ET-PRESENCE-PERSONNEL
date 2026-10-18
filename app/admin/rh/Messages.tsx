"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = {
  id_message: string;
  expediteur_role: string;
  expediteur_nom: string;
  destinataire: string;
  sujet: string | null;
  contenu: string;
  cree_le: string;
  lu?: boolean;
};

const GROUPES: [string, string][] = [
  ["RH", "Ressources humaines"],
  ["Scolarite", "Scolarité"],
  ["Paie", "Service de paie"],
  ["DirectionGenerale", "Direction générale"],
];
const libelle = (v: string) => (v === "Tous" ? "Tous les services" : GROUPES.find((g) => g[0] === v)?.[1] ?? v);

const CHAMP = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500";
const BOUTON =
  "rounded-xl bg-gradient-to-br from-blue-500 to-slate-700 px-5 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-50";
const JSON_H = { "Content-Type": "application/json" };

const quand = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Africa/Casablanca",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (r.status === 401) {
    window.location.href = "/admin/connexion";
    throw new Error("Session expirée");
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
  return d;
}

export default function Messagerie({ role }: { role: string }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [onglet, setOnglet] = useState<"recus" | "envoyes" | "ecrire">("recus");
  const [recus, setRecus] = useState<Msg[]>([]);
  const [envoyes, setEnvoyes] = useState<Msg[]>([]);
  const [nonLus, setNonLus] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [frais, setFrais] = useState<string[]>([]);
  const vus = useRef<Set<string> | null>(null);

  const [dest, setDest] = useState("");
  const [sujet, setSujet] = useState("");
  const [texte, setTexte] = useState("");
  const [msg, setMsg] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const options: [string, string][] = [...GROUPES.filter(([v]) => v !== role), ["Tous", "Tous les services"]];

  const chargerRecus = useCallback(async () => {
    try {
      const d = await api("/api/admin/messages/recus");
      const liste: Msg[] = d.messages ?? [];
      if (vus.current === null) {
        vus.current = new Set(liste.map((m) => m.id_message));
        const n = d.non_lus ?? 0;
        if (n > 0) setToast(`📩 Tu as ${n} message${n > 1 ? "s" : ""} non lu${n > 1 ? "s" : ""}`);
      } else {
        const nouveaux = liste.filter((m) => !vus.current!.has(m.id_message));
        nouveaux.forEach((m) => vus.current!.add(m.id_message));
        const aLire = nouveaux.filter((m) => !m.lu);
        if (aLire.length > 0) {
          const m = aLire[0];
          setToast(`📩 Nouveau message de ${libelle(m.expediteur_role)}${m.sujet ? " : " + m.sujet : ""}`);
        }
      }
      setRecus(liste);
      setNonLus(d.non_lus ?? 0);
    } catch {
      /* on réessaiera au prochain tour */
    }
  }, []);

  const chargerEnvoyes = useCallback(async () => {
    try {
      const d = await api("/api/admin/messages/envoyes");
      setEnvoyes(d.messages ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    chargerRecus();
    const t = setInterval(chargerRecus, 8000);
    return () => clearInterval(t);
  }, [chargerRecus]);

  useEffect(() => {
    if (ouvert && onglet === "envoyes") chargerEnvoyes();
  }, [ouvert, onglet, chargerEnvoyes]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!ouvert || onglet !== "recus") return;
    const ids = recus.filter((m) => !m.lu).map((m) => m.id_message);
    if (ids.length === 0) return;
    setFrais((f) => Array.from(new Set([...f, ...ids])));
    api("/api/admin/messages/lu", { method: "POST", headers: JSON_H, body: JSON.stringify({ ids }) })
      .then(chargerRecus)
      .catch(() => {});
  }, [ouvert, onglet, recus, chargerRecus]);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setEnvoi(true);
    try {
      await api("/api/admin/messages/envoyer", {
        method: "POST",
        headers: JSON_H,
        body: JSON.stringify({ destinataire: dest, sujet, contenu: texte }),
      });
      setMsg("✅ Message envoyé : il apparaît chez le destinataire en quelques secondes.");
      setSujet("");
      setTexte("");
      await chargerEnvoyes();
    } catch (err) {
      setMsg("❌ " + (err as Error).message);
    }
    setEnvoi(false);
  }

  function ouvrirDepuisToast() {
    setOuvert(true);
    setOnglet("recus");
    setToast(null);
    setTimeout(() => conteneur.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  const onglets: ["recus" | "envoyes" | "ecrire", string][] = [
    ["recus", `📥 Reçus${nonLus > 0 ? ` (${nonLus})` : ""}`],
    ["envoyes", "📤 Envoyés"],
    ["ecrire", "✏️ Écrire"],
  ];

  return (
    <>
      {toast && (
        <button
          onClick={ouvrirDepuisToast}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[92vw] rounded-2xl bg-slate-800 text-white px-5 py-3 shadow-xl text-sm font-semibold"
        >
          {toast}
        </button>
      )}

      <div
        ref={conteneur}
        className="bg-white/85 backdrop-blur border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <button onClick={() => setOuvert(!ouvert)} className="w-full flex items-center justify-between px-5 py-4 text-left">
          <span className="font-bold">
            ✉️ Messages
            {nonLus > 0 && (
              <span className="ml-2 rounded-full bg-red-500 text-white text-xs font-bold px-2 py-0.5">{nonLus}</span>
            )}
          </span>
          <span className={`text-gray-400 transition-transform ${ouvert ? "rotate-180" : ""}`}>⌄</span>
        </button>

        {ouvert && (
          <div className="px-5 pb-5 pt-4 space-y-4 border-t border-gray-100">
            <div className="flex gap-2">
              {onglets.map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setOnglet(k)}
                  className={`flex-1 rounded-xl py-2 text-sm font-semibold border ${
                    onglet === k ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-600"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            {onglet === "recus" && (
              <div className="space-y-2">
                {recus.length === 0 && <p className="text-sm text-gray-500">Aucun message reçu pour le moment.</p>}
                {recus.map((m) => (
                  <div
                    key={m.id_message}
                    className={`rounded-xl border p-3 ${
                      frais.includes(m.id_message) || !m.lu ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span>
                        De <b>{libelle(m.expediteur_role)}</b> ({m.expediteur_nom})
                        {m.destinataire === "Tous" ? " · pour tous les services" : ""}
                      </span>
                      <span className="shrink-0">{quand(m.cree_le)}</span>
                    </div>
                    {frais.includes(m.id_message) && (
                      <span className="inline-block mt-1 rounded-full bg-red-500 text-white text-[10px] font-bold px-2 py-0.5">
                        Nouveau
                      </span>
                    )}
                    {m.sujet && <p className="mt-1 font-bold">{m.sujet}</p>}
                    <p className="mt-1 text-sm whitespace-pre-wrap">{m.contenu}</p>
                  </div>
                ))}
              </div>
            )}

            {onglet === "envoyes" && (
              <div className="space-y-2">
                {envoyes.length === 0 && <p className="text-sm text-gray-500">Aucun message envoyé.</p>}
                {envoyes.map((m) => (
                  <div key={m.id_message} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span>
                        À <b>{libelle(m.destinataire)}</b> (par {m.expediteur_nom})
                      </span>
                      <span className="shrink-0">{quand(m.cree_le)}</span>
                    </div>
                    {m.sujet && <p className="mt-1 font-bold">{m.sujet}</p>}
                    <p className="mt-1 text-sm whitespace-pre-wrap">{m.contenu}</p>
                  </div>
                ))}
              </div>
            )}

            {onglet === "ecrire" && (
              <form onSubmit={envoyer} className="space-y-3">
                <label className="block text-sm text-gray-600">
                  Destinataire
                  <select required value={dest} onChange={(e) => setDest(e.target.value)} className={CHAMP}>
                    <option value="">— Choisir un service —</option>
                    {options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {v === "Tous" ? "📢 Tous les services" : l}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  value={sujet}
                  onChange={(e) => setSujet(e.target.value)}
                  maxLength={120}
                  placeholder="Sujet (facultatif)"
                  className={CHAMP}
                />
                <textarea
                  required
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="Écris ton message ici…"
                  className={CHAMP}
                />
                <button type="submit" disabled={envoi} className={BOUTON}>
                  {envoi ? "Envoi…" : "Envoyer le message"}
                </button>
                {msg && <p className="text-sm">{msg}</p>}
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}
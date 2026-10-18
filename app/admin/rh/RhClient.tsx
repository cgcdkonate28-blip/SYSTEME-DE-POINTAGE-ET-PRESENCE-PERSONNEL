"use client";
import { useCallback, useEffect, useState } from "react";
import Historique from "./Historique";
import Messagerie from "./Messages";

type Horaire = { heure_debut: string; heure_fin: string; jours: string[] };
type Absence = { id_absence: string; type: string; date_debut: string; date_fin: string; motif: string | null };
type Agent = {
  id_personnel: string;
  nom: string;
  prenom: string | null;
  profession: string | null;
  matricule: string;
  horaire: Horaire;
  absences: Absence[];
};
type Statut = "ok" | "retard" | "absent" | "attendu" | "autorise" | "repos";
type Ligne = { id: string; nom: string; prenom: string | null; profession: string | null; statut: Statut; detail: string; depart_anticipe?: boolean; commentaire?: string | null };
type Presence = { date: string; maintenant: string; lignes: Ligne[] };

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const HEURES: string[] = [];
for (let h = 5; h <= 22; h++) {
  for (const m of [0, 15, 30, 45]) {
    if (h === 22 && m > 0) break;
    HEURES.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}
const TYPES: [string, string][] = [
  ["conge", "Congé"],
  ["suspension", "Suspension"],
  ["maladie", "Arrêt maladie"],
  ["mission", "Mission à l'extérieur"],
  ["autre", "Autre absence autorisée"],
  ["depart_autorise", "Départ anticipé autorisé (ce jour-là)"],
];

const CHAMP = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500";
const BOUTON =
  "rounded-xl bg-gradient-to-br from-blue-500 to-slate-700 px-5 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-50";
const BOUTON2 = "rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50";

const STYLE: Record<Statut, { titre: string; emoji: string; boite: string; pastille: string }> = {
  ok: { titre: "À l'heure", emoji: "🟢", boite: "bg-green-50 border-green-200 text-green-800", pastille: "bg-green-500" },
  retard: { titre: "En retard", emoji: "🟠", boite: "bg-orange-50 border-orange-200 text-orange-800", pastille: "bg-orange-500" },
  absent: { titre: "Absents (n'ont pas pointé)", emoji: "🔴", boite: "bg-red-50 border-red-200 text-red-800", pastille: "bg-red-500" },
  attendu: { titre: "Pas encore attendus (dans la marge de 20 min)", emoji: "⏳", boite: "bg-gray-50 border-gray-200 text-gray-700", pastille: "bg-gray-400" },
  autorise: { titre: "Absence autorisée (congé, suspension…)", emoji: "🔵", boite: "bg-blue-50 border-blue-200 text-blue-800", pastille: "bg-blue-500" },
  repos: { titre: "Ne travaillent pas aujourd'hui", emoji: "⚪", boite: "bg-slate-50 border-slate-200 text-slate-600", pastille: "bg-slate-400" },
};
const ORDRE: Statut[] = ["ok", "retard", "absent", "attendu", "autorise", "repos"];

const joli = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const nomComplet = (a: { nom: string; prenom?: string | null }) =>
  joli(a.prenom && a.prenom !== "-" ? `${a.prenom} ${a.nom}` : a.nom);
const dateFr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const libType = (t: string) => TYPES.find((x) => x[0] === t)?.[1] ?? t;
const avec = (v: string) => (HEURES.includes(v) ? HEURES : [...HEURES, v].sort());

async function appel(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (r.status === 401) {
    window.location.href = "/admin/connexion";
    throw new Error("Session expirée");
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
  return d;
}
const JSON_H = { "Content-Type": "application/json" };

function Section({
  emoji,
  titre,
  ouvert = false,
  children,
}: {
  emoji: string;
  titre: string;
  ouvert?: boolean;
  children: React.ReactNode;
}) {
  const [o, setO] = useState(ouvert);
  return (
    <div className="bg-white/85 backdrop-blur border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <button onClick={() => setO(!o)} className="w-full flex items-center justify-between px-5 py-4 text-left">
        <span className="font-bold">
          {emoji} {titre}
        </span>
        <span className={`text-gray-400 transition-transform ${o ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {o && <div className="px-5 pb-5 pt-4 space-y-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function ChoixAgent({
  agents,
  valeur,
  onChange,
}: {
  agents: Agent[];
  valeur: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} className={CHAMP}>
      <option value="">— Choisir un agent ({agents.length}) —</option>
      {agents.map((a) => (
        <option key={a.id_personnel} value={a.id_personnel}>
          {nomComplet(a)}
        </option>
      ))}
    </select>
  );
}

function Fiche({ a }: { a: Agent }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-1 text-sm">
      <p className="text-base font-bold">{nomComplet(a)}</p>
      <p>
        Fonction : <b>{a.profession ?? "—"}</b>
      </p>
      <p>
        Matricule : <b>{a.matricule}</b>
      </p>
      <p>
        Horaires : <b>{a.horaire.heure_debut} → {a.horaire.heure_fin}</b> ({a.horaire.jours.join(", ")})
      </p>
      {a.absences.length > 0 ? (
        <div className="pt-1">
          <p className="font-semibold">Absences prévues :</p>
          <ul className="list-disc pl-5">
            {a.absences.map((x) => (
              <li key={x.id_absence}>
                {libType(x.type)} du {dateFr(x.date_debut)} au {dateFr(x.date_fin)}
                {x.motif ? ` (${x.motif})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-gray-500">Aucune absence prévue.</p>
      )}
    </div>
  );
}

function Planning({ agents, recharger }: { agents: Agent[]; recharger: () => Promise<void> }) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [sel, setSel] = useState("");
  const a = agents.find((x) => x.id_personnel === sel);
  const [debut, setDebut] = useState("09:00");
  const [fin, setFin] = useState("17:00");
  const [jours, setJours] = useState<string[]>(JOURS.slice(0, 5));
  const [type, setType] = useState("conge");
  const [dd, setDd] = useState(aujourdhui);
  const [df, setDf] = useState(aujourdhui);
  const [motif, setMotif] = useState("");
  const [msgH, setMsgH] = useState("");
  const [msgA, setMsgA] = useState("");

  useEffect(() => {
    if (a) {
      setDebut(a.horaire.heure_debut);
      setFin(a.horaire.heure_fin);
      setJours(a.horaire.jours);
    }
  }, [a]);

  async function enregistrerHoraire() {
    setMsgH("");
    try {
      await appel("/api/admin/rh/horaire", {
        method: "POST",
        headers: JSON_H,
        body: JSON.stringify({ id_personnel: sel, heure_debut: debut, heure_fin: fin, jours }),
      });
      setMsgH("✅ Horaires enregistrés");
      await recharger();
    } catch (e) {
      setMsgH("❌ " + (e as Error).message);
    }
  }

  async function ajouterAbsence() {
    setMsgA("");
    try {
      await appel("/api/admin/rh/absence", {
        method: "POST",
        headers: JSON_H,
        body: JSON.stringify({ id_personnel: sel, type, date_debut: dd, date_fin: df, motif }),
      });
      setMsgA("✅ Absence enregistrée");
      setMotif("");
      await recharger();
    } catch (e) {
      setMsgA("❌ " + (e as Error).message);
    }
  }

  async function supprimerAbsence(id: string) {
    if (!confirm("Supprimer cette absence ?")) return;
    try {
      await appel(`/api/admin/rh/absence/${id}`, { method: "DELETE" });
      await recharger();
    } catch (e) {
      setMsgA("❌ " + (e as Error).message);
    }
  }

  return (
    <>
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-600">1. Choisis l'agent</p>
        <ChoixAgent agents={agents} valeur={sel} onChange={setSel} />
      </div>

      {a && (
        <>
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="font-bold">🕘 Horaires de travail de {nomComplet(a)}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-600">
                Heure d'arrivée
                <select value={debut} onChange={(e) => setDebut(e.target.value)} className={CHAMP}>
                  {avec(debut).map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Heure de départ
                <select value={fin} onChange={(e) => setFin(e.target.value)} className={CHAMP}>
                  {avec(fin).map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <p className="mb-2 text-sm text-gray-600">Jours travaillés (clique pour activer ou désactiver)</p>
              <div className="flex flex-wrap gap-2">
                {JOURS.map((j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => setJours((cur) => (cur.includes(j) ? cur.filter((x) => x !== j) : [...cur, j]))}
                    className={`rounded-full px-4 py-2 text-sm font-semibold border ${
                      jours.includes(j) ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-500"
                    }`}
                  >
                    {j.charAt(0).toUpperCase() + j.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={enregistrerHoraire} className={BOUTON}>
                Enregistrer les horaires
              </button>
              <button
                onClick={() => {
                  setDebut("09:00");
                  setFin("17:00");
                  setJours(JOURS.slice(0, 5));
                }}
                className={BOUTON2}
              >
                Remettre 9h – 17h
              </button>
            </div>
            {msgH && <p className="text-sm">{msgH}</p>}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="font-bold">🏖️ Congés, suspensions et absences</p>
            <label className="block text-sm text-gray-600">
              Type
              <select value={type} onChange={(e) => setType(e.target.value)} className={CHAMP}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-600">
                Du
                <input type="date" value={dd} onChange={(e) => setDd(e.target.value)} className={CHAMP} />
              </label>
              <label className="text-sm text-gray-600">
                Au (inclus)
                <input type="date" value={df} onChange={(e) => setDf(e.target.value)} className={CHAMP} />
              </label>
            </div>
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="Motif (facultatif)"
              className={CHAMP}
            />
            <button onClick={ajouterAbsence} className={BOUTON}>
              Ajouter cette absence
            </button>
            {msgA && <p className="text-sm">{msgA}</p>}

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-600">Absences prévues pour {nomComplet(a)}</p>
              {a.absences.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune.</p>
              ) : (
                <ul className="space-y-2">
                  {a.absences.map((x) => (
                    <li
                      key={x.id_absence}
                      className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-900"
                    >
                      <span>
                        <b>{libType(x.type)}</b> du {dateFr(x.date_debut)} au {dateFr(x.date_fin)}
                        {x.motif ? ` (${x.motif})` : ""}
                      </span>
                      <button onClick={() => supprimerAbsence(x.id_absence)} className="text-red-600 font-semibold">
                        Supprimer
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function RhClient({ nom, prenom, role }: { nom: string; prenom: string; role: string }) {
  const affiche = nomComplet({ nom, prenom });
  const initiale = affiche.charAt(0).toUpperCase() || "A";
  const libRole = role === "DirectionGenerale" ? "Direction générale" : "Ressources humaines";

  const [agents, setAgents] = useState<Agent[]>([]);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [erreur, setErreur] = useState("");
  const [sel1, setSel1] = useState("");

  const charger = useCallback(async () => {
    try {
      setAgents((await appel("/api/admin/rh/donnees")).agents);
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  const chargerPresence = useCallback(async () => {
    try {
      setPresence(await appel("/api/admin/rh/presence"));
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  useEffect(() => {
    charger();
    chargerPresence();
    const t = setInterval(chargerPresence, 30000);
    return () => clearInterval(t);
  }, [charger, chargerPresence]);

  async function deconnexion() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/";
  }

  const a1 = agents.find((x) => x.id_personnel === sel1);
  const lignes = presence?.lignes ?? [];

  return (
    <div className="relative min-h-screen bg-white text-gray-900 overflow-hidden">
      {role === "DirectionGenerale" && (<a href="/admin/direction" className="fixed top-4 left-4 z-20 rounded-full bg-white/90 border border-gray-200 px-4 py-2 text-sm font-semibold shadow">← Direction</a>)}
      <button
        onClick={deconnexion}
        className="fixed top-4 right-4 z-20 rounded-full bg-white/90 border border-gray-200 px-4 py-2 text-sm font-semibold shadow"
      >
        Déconnexion
      </button>

      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-25 bg-blue-400 animate-pulse" />
      <div
        className="absolute top-1/3 -right-32 w-96 h-96 rounded-full blur-3xl opacity-25 bg-slate-400 animate-pulse"
        style={{ animationDelay: "1s" }}
      />

      <div className="relative z-10 px-4 py-10 max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-slate-700 flex items-center justify-center text-2xl font-black text-white shadow-lg">
            {initiale}
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-widest">Espace administrateur 🛡️ · {libRole}</p>
            <h1 className="text-2xl font-extrabold leading-tight">Salut {affiche} !</h1>
          </div>
        </div>

        {erreur && (
          <p className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>
        )}

        <div className="space-y-3">
          <Section emoji="👥" titre="Personnel permanent">
            <p className="text-sm text-gray-500">Choisis un agent pour voir sa fiche.</p>
            <ChoixAgent agents={agents} valeur={sel1} onChange={setSel1} />
            {a1 && <Fiche a={a1} />}
          </Section>

          <Section emoji="🗓️" titre="Horaires, congés et suspensions">
            <Planning agents={agents} recharger={charger} />
          </Section>

          <Section emoji="✅" titre="Présence du jour" ouvert>
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1">
              <p>🟢 <b>Vert</b> : l'agent est arrivé à l'heure, au plus tard 20 minutes après l'heure prévue (par exemple : prévu 9h00, arrivé jusqu'à 9h20).</p>
              <p>🟠 <b>Orange</b> : l'agent est en retard, entre 21 minutes et 2 heures après l'heure prévue (de 9h21 à 11h00). S'il n'est pas encore arrivé dans cette période, il apparaît aussi en orange.</p>
              <p>🔴 <b>Rouge</b> : l'agent est absent, c'est-à-dire pas arrivé 2 heures après l'heure prévue (après 11h00). C'est définitif pour la journée, même s'il pointe plus tard.</p>
<p>⚠️ <b>Départ anticipé</b> : l'agent a pointé sa sortie avant l'heure de fin moins 15 minutes (avant 16h45 pour une fin à 17h00), sans autorisation. Un commentaire s'affiche sur sa ligne, et dans l'historique le carré est moitié vert, moitié orange.</p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                {presence ? `Le ${dateFr(presence.date)} à ${presence.maintenant} (heure de l'école)` : "Chargement…"}
              </p>
              <button onClick={chargerPresence} className={BOUTON2}>
                🔄 Actualiser
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {ORDRE.map((s) => (
                <div key={s} className={`rounded-xl border p-3 text-center ${STYLE[s].boite}`}>
                  <p className="text-2xl font-black">{lignes.filter((l) => l.statut === s).length}</p>
                  <p className="text-xs">{STYLE[s].emoji} {s === "ok" ? "À l'heure" : s === "retard" ? "En retard" : s === "absent" ? "Absents" : s === "attendu" ? "Attendus" : s === "autorise" ? "Autorisés" : "Repos"}</p>
                </div>
              ))}
            </div>

            {(["retard", "absent"] as Statut[]).map((s) => {
              const liste = lignes.filter((l) => l.statut === s);
              if (liste.length === 0) return null;
              return (
                <div key={s} className="space-y-2">
                  <p className="font-bold">
                    {STYLE[s].emoji} {STYLE[s].titre} ({liste.length})
                  </p>
                  {liste.map((l) => (
                    <div key={l.id} className={`flex items-center gap-3 rounded-xl border p-3 ${STYLE[s].boite}`}>
                      <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-black text-white ${STYLE[s].pastille}`}>
                        {nomComplet(l).charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold leading-tight">{nomComplet(l)}</p>
                        <p className="text-xs opacity-80">{l.profession ?? "—"}</p>
                        <p className="text-sm">{l.detail}</p>
{l.commentaire && <p className="text-sm font-semibold">{l.commentaire}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {(() => {
              const liste = lignes.filter((l) => l.statut === "ok" && l.depart_anticipe);
              if (liste.length === 0) return null;
              return (
                <div className="space-y-2">
                  <p className="font-bold">🟠 Départs anticipés sans autorisation ({liste.length})</p>
                  {liste.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 rounded-xl border p-3 bg-orange-50 border-orange-200 text-orange-800">
                      <div className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-black text-white bg-orange-500">
                        {nomComplet(l).charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold leading-tight">{nomComplet(l)}</p>
                        <p className="text-xs opacity-80">{l.profession ?? "—"}</p>
                        <p className="text-sm">{l.detail}</p>
                        {l.commentaire && <p className="text-sm font-semibold">{l.commentaire}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
{presence && lignes.length > 0 && !lignes.some((l) => l.statut === "retard" || l.statut === "absent" || l.depart_anticipe) && (
  <p className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-800">✅ Aucun retard, absence ni départ anticipé pour le moment.</p>
)}
{presence && lignes.length === 0 && (
              <p className="text-sm text-gray-500">Aucun agent permanent enregistré pour le moment.</p>
            )}
          </Section>

          <Section emoji="📅" titre="Historique des présences">
            <Historique agents={agents} />
          </Section>

          <Messagerie role={role} />
        </div>
      </div>
    </div>
  );
}
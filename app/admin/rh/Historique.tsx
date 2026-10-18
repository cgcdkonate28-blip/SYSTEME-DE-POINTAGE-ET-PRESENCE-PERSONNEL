"use client";
import { useEffect, useState } from "react";

type Agent = { id_personnel: string; nom: string; prenom: string | null };
type StatutJ = "ok" | "retard" | "absent" | "autorise" | "repos" | "attendu" | "futur" | "avant";
type Jour = { date: string; statut: StatutJ; detail: string; depart_anticipe?: boolean };

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const MOIS_COURT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const JOURS_COURT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const COULEUR: Record<StatutJ, string> = {
  ok: "bg-green-500 text-white",
  retard: "bg-orange-400 text-white",
  absent: "bg-red-500 text-white",
  autorise: "bg-blue-500 text-white",
  repos: "bg-gray-200 text-gray-500",
  attendu: "bg-gray-300 text-gray-600",
  futur: "bg-gray-50 border border-gray-200 text-gray-300",
  avant: "bg-white border border-dashed border-gray-200 text-gray-300",
};
const LIBELLE: Record<StatutJ, string> = {
  ok: "À l'heure",
  retard: "En retard",
  absent: "Absent",
  autorise: "Absence autorisée",
  repos: "Jour de repos",
  attendu: "Pas encore attendu",
  futur: "À venir",
  avant: "Avant l'enregistrement",
};
const COMPTEURS: { s: StatutJ; boite: string; emoji: string }[] = [
  { s: "ok", boite: "bg-green-50 border-green-200 text-green-800", emoji: "🟢" },
  { s: "retard", boite: "bg-orange-50 border-orange-200 text-orange-800", emoji: "🟠" },
  { s: "absent", boite: "bg-red-50 border-red-200 text-red-800", emoji: "🔴" },
  { s: "autorise", boite: "bg-blue-50 border-blue-200 text-blue-800", emoji: "🔵" },
];

const CHAMP = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500";

const joli = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const nomComplet = (a: { nom: string; prenom?: string | null }) =>
  joli(a.prenom && a.prenom !== "-" ? `${a.prenom} ${a.nom}` : a.nom);
const dateLongue = (d: string) => {
  const [y, m, j] = d.split("-").map(Number);
  return `${j} ${MOIS[m - 1].toLowerCase()} ${y}`;
};
const idxSemaine = (d: string) => {
  const [y, m, j] = d.split("-").map(Number);
  return (new Date(y, m - 1, j).getDay() + 6) % 7;
};

function fondJour(j: Jour): React.CSSProperties | undefined {
  if (!j.depart_anticipe) return undefined;
  if (j.statut === "ok") return { background: "linear-gradient(135deg, #22c55e 50%, #fb923c 50%)" };
  if (j.statut === "retard") return { background: "linear-gradient(135deg, #fb923c 50%, #c2410c 50%)" };
  return undefined;
}
export default function Historique({ agents }: { agents: Agent[] }) {
  const maintenant = new Date();
  const anneeNow = maintenant.getFullYear();
  const [sel, setSel] = useState("");
  const [annee, setAnnee] = useState(anneeNow);
  const [mois, setMois] = useState(maintenant.getMonth() + 1);
  const [jours, setJours] = useState<Jour[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [choisi, setChoisi] = useState<Jour | null>(null);

  useEffect(() => {
    if (!sel) {
      setJours([]);
      return;
    }
    let annule = false;
    setChargement(true);
    setErreur("");
    setChoisi(null);
    fetch(`/api/admin/rh/historique/${sel}/${annee}/${mois}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/admin/connexion";
          return;
        }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
        if (!annule) setJours(d.jours);
      })
      .catch((e) => {
        if (!annule) {
          setErreur((e as Error).message);
          setJours([]);
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [sel, annee, mois]);

  const nb = (s: StatutJ) => jours.filter((j) => j.statut === s).length;

  const semaines: (Jour | null)[][] = [];
  if (mois === 0 && jours.length > 0) {
    let cur: (Jour | null)[] = Array(idxSemaine(jours[0].date)).fill(null);
    for (const j of jours) {
      cur.push(j);
      if (cur.length === 7) {
        semaines.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) {
      while (cur.length < 7) cur.push(null);
      semaines.push(cur);
    }
  }

  const choisir = (j: Jour) => setChoisi(j);
  const anneeOk = (j: Jour) => (choisi?.date === j.date ? "ring-2 ring-offset-1 ring-slate-700" : "");

  return (
    <>
      <select value={sel} onChange={(e) => setSel(e.target.value)} className={CHAMP}>
        <option value="">— Choisir un agent ({agents.length}) —</option>
        {agents.map((a) => (
          <option key={a.id_personnel} value={a.id_personnel}>
            {nomComplet(a)}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-600">
          Année
          <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className={CHAMP}>
            {[anneeNow - 2, anneeNow - 1, anneeNow].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Mois
          <select value={mois} onChange={(e) => setMois(Number(e.target.value))} className={CHAMP}>
            <option value={0}>Toute l'année</option>
            {MOIS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
<span className="flex items-center gap-1.5"><span className="inline-block w-3.5 h-3.5 rounded-[3px]" style={{ background: "linear-gradient(135deg, #22c55e 50%, #fb923c 50%)" }} />Parti avant l'heure</span>
        {(["ok", "retard", "absent", "autorise", "repos"] as StatutJ[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-3.5 h-3.5 rounded-[3px] ${COULEUR[s]}`} />
            {LIBELLE[s]}
          </span>
        ))}
      </div>

      {!sel && <p className="text-sm text-gray-500">Choisis un agent pour voir son historique.</p>}
      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}
      {erreur && <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}

      {sel && jours.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {COMPTEURS.map(({ s, boite, emoji }) => (
              <div key={s} className={`rounded-xl border p-3 text-center ${boite}`}>
                <p className="text-2xl font-black">{nb(s)}</p>
                <p className="text-xs">
                  {emoji} {LIBELLE[s]}
                </p>
              </div>
            ))}
          </div>

          {jours.some((j) => j.depart_anticipe) && (<p className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">⚠️ Départs anticipés sans autorisation : {jours.filter((j) => j.depart_anticipe).length} jour(s)</p>)}
{mois !== 0 ? (
            <div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {JOURS_COURT.map((n) => (
                  <div key={n} className="text-center text-xs text-gray-400">
                    {n}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array(idxSemaine(jours[0].date))
                  .fill(0)
                  .map((_, i) => (
                    <div key={`v${i}`} />
                  ))}
                {jours.map((j) => (
                  <button
                    key={j.date}
                    onClick={() => choisir(j)}
                    title={`${dateLongue(j.date)} : ${LIBELLE[j.statut]}${j.depart_anticipe ? " (parti avant l'heure)" : ""}`} style={fondJour(j)}
                    className={`aspect-square rounded-lg text-sm font-bold flex items-center justify-center ${COULEUR[j.statut]} ${anneeOk(j)}`}
                  >
                    {Number(j.date.slice(8))}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-[3px] w-max">
                <div className="flex flex-col gap-[3px] pr-1">
                  <div className="h-4" />
                  {JOURS_COURT.map((n, i) => (
                    <div key={n} className="h-3.5 text-[9px] leading-[14px] text-gray-400">
                      {i % 2 === 0 ? n : ""}
                    </div>
                  ))}
                </div>
                {semaines.map((col, k) => {
                  const premierMois = col.find((j) => j && j.date.endsWith("-01"));
                  return (
                    <div key={k} className="flex flex-col gap-[3px]">
                      <div className="h-4 text-[10px] leading-4 text-gray-500 whitespace-nowrap">
                        {premierMois ? MOIS_COURT[Number(premierMois.date.slice(5, 7)) - 1] : ""}
                      </div>
                      {col.map((j, i) =>
                        j ? (
                          <button
                            key={j.date}
                            onClick={() => choisir(j)}
                            title={`${dateLongue(j.date)} : ${LIBELLE[j.statut]}${j.depart_anticipe ? " (parti avant l'heure)" : ""}`} style={fondJour(j)}
                            className={`w-3.5 h-3.5 rounded-[3px] ${COULEUR[j.statut]} ${anneeOk(j)}`}
                          />
                        ) : (
                          <div key={`v${i}`} className="w-3.5 h-3.5" />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {choisi && (
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm">
              <b>{dateLongue(choisi.date)}</b> : {LIBELLE[choisi.statut]}
              {choisi.detail ? ` — ${choisi.detail}` : ""}
            </div>
          )}
          <p className="text-xs text-gray-400">
            L'historique est calculé avec les horaires actuellement enregistrés pour cet agent.
          </p>
        </>
      )}
    </>
  );
}
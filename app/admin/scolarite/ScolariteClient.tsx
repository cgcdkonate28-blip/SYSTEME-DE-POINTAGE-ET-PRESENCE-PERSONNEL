"use client";
import { useCallback, useEffect, useState } from "react";
import Messagerie from "../rh/Messages";

type Vac = { id_personnel: string; nom: string; prenom: string | null; profession: string | null; matricule: string };
type SeanceJour = {
  id_edt: string;
  id_vacataire: string;
  heure_debut: string;
  heure_fin: string;
  salle: string;
  promo: number;
  type_seance: string;
  groupe: string | null;
  matiere: string;
};
type Jour = {
  creneaux: { debut: string; fin: string }[];
  seances: SeanceJour[];
  salles: { niveau: string; salles: string[] }[];
  ferme: boolean;
};
type Seance = {
  id_edt: string;
  date_seance: string;
  heure_debut: string;
  heure_fin: string;
  salle: string;
  promo: number;
  type_seance: string;
  num_seance: number | null;
  total_seances: number | null;
  groupe: string | null;
  matiere: string;
  statut: "assure" | "non_assure" | "a_venir";
  pointe: boolean;
  modifiable: boolean;
};

const PROMOS = [26, 27, 28, 29, 30];
const TYPES: [string, string][] = [
  ["C", "C : cours magistral"],
  ["TD", "TD : travaux dirigés"],
  ["TP", "TP : travaux pratiques"],
];
const GROUPES_PAR_TYPE: Record<string, string[]> = { TD: ["A", "B"], TP: ["A1", "A2", "B1", "B2"] };

const CHAMP = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500";
const BOUTON =
  "rounded-xl bg-gradient-to-br from-blue-500 to-slate-700 px-5 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-50";
const BOUTON2 = "rounded-xl border border-gray-300 bg-white px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50";
const JSON_H = { "Content-Type": "application/json" };

const joli = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const nomComplet = (a: { nom: string; prenom?: string | null }) =>
  joli(a.prenom && a.prenom !== "-" ? `${a.prenom} ${a.nom}` : a.nom);
const heure = (h: string) => h.replace(":", "h");
const aujourdhuiLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dateLongue = (iso: string) => {
  const [y, m, j] = iso.split("-").map(Number);
  return new Date(y, m - 1, j).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};
const etiquette = (s: {
  type_seance: string;
  num_seance: number | null;
  total_seances: number | null;
  groupe: string | null;
}) =>
  `${s.type_seance}${s.num_seance ? ` ${s.num_seance}/${s.total_seances}` : ""}${s.groupe ? ` · groupe ${s.groupe}` : ""}`;

const sousGroupes = (type: string, groupe: string | null): string[] | null => {
  if (type === "C") return ["A1", "A2", "B1", "B2"];
  if (!groupe) return null;
  if (type === "TD") return groupe === "A" ? ["A1", "A2"] : ["B1", "B2"];
  if (type === "TP") return [groupe];
  return null;
};

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

function ChoixVac({ vacataires, valeur, onChange }: { vacataires: Vac[]; valeur: string; onChange: (v: string) => void }) {
  return (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} className={CHAMP}>
      <option value="">— Choisir un professeur ({vacataires.length}) —</option>
      {vacataires.map((v) => (
        <option key={v.id_personnel} value={v.id_personnel}>
          {nomComplet(v)}
        </option>
      ))}
    </select>
  );
}

type PropsCreneau = {
  date: string;
  setDate: (v: string) => void;
  debut: string;
  setDebut: (v: string) => void;
  salle: string;
  setSalle: (v: string) => void;
  prof: string;
  promo: number | null;
  type: string;
  groupe: string | null;
  exclure?: string;
  version: number;
};

function ChoixCreneau(p: PropsCreneau) {
  const { date, setDate, debut, setDebut, salle, setSalle, prof, promo, type, groupe, exclure, version } = p;
  const [jour, setJour] = useState<Jour | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!date) {
      setJour(null);
      return;
    }
    let annule = false;
    api(`/api/admin/scolarite/jour/${date}`)
      .then((d: Jour) => {
        if (!annule) {
          setJour(d);
          setErreur("");
        }
      })
      .catch((e) => {
        if (!annule) setErreur((e as Error).message);
      });
    return () => {
      annule = true;
    };
  }, [date, version]);

  const sg = promo ? sousGroupes(type, groupe) : null;
  const occupe = (c: string) => {
    const s = (jour?.seances ?? []).filter((x) => x.heure_debut === c && x.id_edt !== exclure);
    if (prof && s.some((x) => x.id_vacataire === prof)) return "professeur occupé";
    if (
      sg &&
      s.some((x) => x.promo === promo && (sousGroupes(x.type_seance, x.groupe) ?? []).some((g) => sg.includes(g)))
    )
      return "promo occupée";
    return "";
  };
  const salleOccupee = (nom: string) =>
    !!debut && (jour?.seances ?? []).some((x) => x.heure_debut === debut && x.salle === nom && x.id_edt !== exclure);

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-600">
        Date
        <input
          type="date"
          min={aujourdhuiLocal()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setDebut("");
            setSalle("");
          }}
          className={CHAMP}
        />
      </label>
      {erreur && <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}
      {date && jour?.ferme && (
        <p className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
          Pas de cours le dimanche : choisis un autre jour.
        </p>
      )}
      {jour && !jour.ferme && (
        <>
          <label className="block text-sm text-gray-600">
            Créneau
            <select value={debut} onChange={(e) => setDebut(e.target.value)} className={CHAMP}>
              <option value="">— Choisir un créneau —</option>
              {jour.creneaux.map((c) => {
                const o = occupe(c.debut);
                return (
                  <option key={c.debut} value={c.debut} disabled={!!o}>
                    {heure(c.debut)} – {heure(c.fin)}
                    {o ? ` (${o})` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="block text-sm text-gray-600">
            Salle
            <select value={salle} onChange={(e) => setSalle(e.target.value)} className={CHAMP}>
              <option value="">— Choisir une salle —</option>
              {jour.salles.map((n) => (
                <optgroup key={n.niveau} label={n.niveau}>
                  {n.salles.map((s) => (
                    <option key={s} value={s} disabled={salleOccupee(s)}>
                      {s}
                      {salleOccupee(s) ? " (occupée)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

function Creation({ vacataires, onSaved }: { vacataires: Vac[]; onSaved: () => void }) {
  const [prof, setProf] = useState("");
  const [promo, setPromo] = useState("");
  const [matiere, setMatiere] = useState("");
  const [type, setType] = useState("C");
  const [num, setNum] = useState("1");
  const [total, setTotal] = useState("10");
  const [groupe, setGroupe] = useState("");
  const [date, setDate] = useState("");
  const [debut, setDebut] = useState("");
  const [salle, setSalle] = useState("");
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!prof || !promo || !matiere.trim() || !date || !debut || !salle || (type !== "C" && !groupe)) {
      setMsg("❌ Remplis tous les champs avant d'enregistrer.");
      return;
    }
    setEnvoi(true);
    try {
      await api("/api/admin/scolarite/seance", {
        method: "POST",
        headers: JSON_H,
        body: JSON.stringify({
          id_vacataire: prof,
          date,
          debut,
          promo: Number(promo),
          matiere,
          type_seance: type,
          num_seance: Number(num),
          total_seances: Number(total),
          groupe: type === "C" ? null : groupe,
          salle,
        }),
      });
      setMsg("✅ Séance enregistrée. Tu peux en ajouter une autre : le professeur, la promo et le module restent remplis.");
      setDebut("");
      setSalle("");
      setNum(String(Math.min(Number(num) + 1, Number(total))));
      setVersion((v) => v + 1);
      onSaved();
    } catch (err) {
      setMsg("❌ " + (err as Error).message);
    }
    setEnvoi(false);
  }

  return (
    <form onSubmit={enregistrer} className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-600">1. Professeur</p>
        <ChoixVac vacataires={vacataires} valeur={prof} onChange={setProf} />
      </div>

      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <p className="font-bold">📚 Cours</p>
        <label className="block text-sm text-gray-600">
          Promo
          <select value={promo} onChange={(e) => setPromo(e.target.value)} className={CHAMP}>
            <option value="">— Choisir la promo —</option>
            {PROMOS.map((p) => (
              <option key={p} value={p}>
                Promo {p}
              </option>
            ))}
          </select>
        </label>
        <input
          value={matiere}
          onChange={(e) => setMatiere(e.target.value)}
          maxLength={80}
          placeholder="Nom du module"
          className={CHAMP}
        />
        <label className="block text-sm text-gray-600">
          Type de séance
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setGroupe("");
            }}
            className={CHAMP}
          >
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-gray-600">
            Séance n°
            <input type="number" min={1} max={99} value={num} onChange={(e) => setNum(e.target.value)} className={CHAMP} />
          </label>
          <label className="text-sm text-gray-600">
            sur (total)
            <input type="number" min={1} max={99} value={total} onChange={(e) => setTotal(e.target.value)} className={CHAMP} />
          </label>
        </div>
        <p className="text-sm text-gray-500">
          Affichage : <b>{type} {num}/{total}</b>
        </p>
        {type !== "C" && (
          <label className="block text-sm text-gray-600">
            Groupe
            <select value={groupe} onChange={(e) => setGroupe(e.target.value)} className={CHAMP}>
              <option value="">— Choisir le groupe —</option>
              {GROUPES_PAR_TYPE[type].map((g) => (
                <option key={g} value={g}>
                  Groupe {g}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <p className="font-bold">🕘 Date, créneau et salle</p>
        <ChoixCreneau
          date={date}
          setDate={setDate}
          debut={debut}
          setDebut={setDebut}
          salle={salle}
          setSalle={setSalle}
          prof={prof}
          promo={promo ? Number(promo) : null}
          type={type}
          groupe={type === "C" ? null : groupe || null}
          version={version}
        />
      </div>

      <button type="submit" disabled={envoi} className={BOUTON}>
        {envoi ? "Enregistrement…" : "Enregistrer la séance"}
      </button>
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

function Carte({ s, prof, onChange }: { s: Seance; prof: string; onChange: () => void }) {
  const [edition, setEdition] = useState(false);
  const [date, setDate] = useState(s.date_seance);
  const [debut, setDebut] = useState(s.heure_debut);
  const [salle, setSalle] = useState(s.salle);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState("");

  const style =
    s.statut === "assure"
      ? "bg-green-50 border-green-200 text-green-800"
      : s.statut === "non_assure"
      ? "bg-red-50 border-red-200 text-red-800"
      : "bg-white border-gray-200 text-gray-800";
  const badge =
    s.statut === "assure"
      ? "✅ Assurée"
      : s.statut === "non_assure"
      ? "❌ Pas de pointage"
      : s.pointe
      ? "✓ A pointé"
      : "À venir";

  async function reprogrammer() {
    setMsg("");
    try {
      await api(`/api/admin/scolarite/seance/${s.id_edt}`, {
        method: "PUT",
        headers: JSON_H,
        body: JSON.stringify({ date, debut, salle }),
      });
      setEdition(false);
      onChange();
    } catch (e) {
      setMsg("❌ " + (e as Error).message);
      setVersion((v) => v + 1);
    }
  }

  async function annuler() {
    if (!confirm("Annuler cette séance ?")) return;
    try {
      await api(`/api/admin/scolarite/seance/${s.id_edt}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      setMsg("❌ " + (e as Error).message);
    }
  }

  return (
    <div className={`rounded-xl border p-3 ${style}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold leading-tight">{s.matiere}</p>
          <p className="text-sm">
            {etiquette(s)} · Promo {s.promo}
          </p>
          <p className="text-sm">
            {dateLongue(s.date_seance)} · {heure(s.heure_debut)} – {heure(s.heure_fin)} · {s.salle}
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold">{badge}</span>
      </div>

      {s.modifiable && !edition && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setEdition(true)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700">
            🔁 Reprogrammer
          </button>
          <button onClick={annuler} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600">
            Annuler la séance
          </button>
        </div>
      )}
      {msg && !edition && <p className="mt-2 text-sm">{msg}</p>}

      {edition && (
        <div className="mt-3 space-y-3 rounded-xl bg-gray-50 border border-gray-200 p-3 text-gray-800">
          <p className="text-sm font-bold">Nouvelle date, nouveau créneau et nouvelle salle</p>
          <ChoixCreneau
            date={date}
            setDate={setDate}
            debut={debut}
            setDebut={setDebut}
            salle={salle}
            setSalle={setSalle}
            prof={prof}
            promo={s.promo}
            type={s.type_seance}
            groupe={s.groupe}
            exclure={s.id_edt}
            version={version}
          />
          <div className="flex gap-2">
            <button onClick={reprogrammer} disabled={!date || !debut || !salle} className={BOUTON}>
              Enregistrer
            </button>
            <button onClick={() => setEdition(false)} className={BOUTON2}>
              Fermer
            </button>
          </div>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function Programme({ vacataires, version, onChange }: { vacataires: Vac[]; version: number; onChange: () => void }) {
  const [sel, setSel] = useState("");
  const [seances, setSeances] = useState<Seance[]>([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    if (!sel) {
      setSeances([]);
      return;
    }
    setChargement(true);
    try {
      setSeances((await api(`/api/admin/scolarite/programme/${sel}`)).seances);
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
    setChargement(false);
  }, [sel]);

  useEffect(() => {
    charger();
  }, [charger, version]);

  const nb = (st: Seance["statut"]) => seances.filter((s) => s.statut === st).length;
  const aVenir = seances.filter((s) => s.statut === "a_venir");
  const passees = seances.filter((s) => s.statut !== "a_venir").reverse();
  const apresChangement = () => {
    onChange();
    charger();
  };

  return (
    <>
      <ChoixVac vacataires={vacataires} valeur={sel} onChange={setSel} />
      {!sel && <p className="text-sm text-gray-500">Choisis un professeur pour voir son programme.</p>}
      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}
      {erreur && <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}

      {sel && !chargement && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border p-3 text-center bg-green-50 border-green-200 text-green-800">
              <p className="text-2xl font-black">{nb("assure")}</p>
              <p className="text-xs">✅ Assurées</p>
            </div>
            <div className="rounded-xl border p-3 text-center bg-gray-50 border-gray-200 text-gray-700">
              <p className="text-2xl font-black">{nb("a_venir")}</p>
              <p className="text-xs">À venir</p>
            </div>
            <div className="rounded-xl border p-3 text-center bg-red-50 border-red-200 text-red-800">
              <p className="text-2xl font-black">{nb("non_assure")}</p>
              <p className="text-xs">❌ Sans pointage</p>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1">
            <p>✅ <b>Vert</b> : la séance est passée et le professeur a pointé dans la demi-journée (le pointage du matin couvre les séances du matin, il faut pointer de nouveau l&apos;après-midi).</p>
            <p>❌ <b>Rouge</b> : la séance est passée mais le professeur n&apos;a pas pointé dans la demi-journée.</p>
          </div>

          <div className="space-y-2">
            <p className="font-bold">📅 Séances à venir ({aVenir.length})</p>
            {aVenir.length === 0 && <p className="text-sm text-gray-500">Aucune séance à venir.</p>}
            {aVenir.map((s) => (
              <Carte key={s.id_edt} s={s} prof={sel} onChange={apresChangement} />
            ))}
          </div>

          <div className="space-y-2">
            <p className="font-bold">🕓 Séances passées ({passees.length})</p>
            {passees.length === 0 && <p className="text-sm text-gray-500">Aucune séance passée sur les 120 derniers jours.</p>}
            {passees.map((s) => (
              <Carte key={s.id_edt} s={s} prof={sel} onChange={apresChangement} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function ScolariteClient({ nom, prenom, role }: { nom: string; prenom: string; role: string }) {
  const affiche = nomComplet({ nom, prenom });
  const initiale = affiche.charAt(0).toUpperCase() || "A";
  const libRole = role === "DirectionGenerale" ? "Direction générale" : "Scolarité";

  const [vacataires, setVacataires] = useState<Vac[]>([]);
  const [erreur, setErreur] = useState("");
  const [sel1, setSel1] = useState("");
  const [v, setV] = useState(0);

  useEffect(() => {
    api("/api/admin/scolarite/vacataires")
      .then((d) => setVacataires(d.vacataires))
      .catch((e) => setErreur((e as Error).message));
  }, []);

  async function deconnexion() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/";
  }

  const a1 = vacataires.find((x) => x.id_personnel === sel1);

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

        {erreur && <p className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}

        <div className="space-y-3">
          <Section emoji="👥" titre="Personnel vacataire">
            <p className="text-sm text-gray-500">Choisis un professeur pour voir sa fiche.</p>
            <ChoixVac vacataires={vacataires} valeur={sel1} onChange={setSel1} />
            {a1 && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-1 text-sm">
                <p className="text-base font-bold">{nomComplet(a1)}</p>
                <p>
                  Fonction : <b>{a1.profession ?? "—"}</b>
                </p>
                <p>
                  Matricule : <b>{a1.matricule}</b>
                </p>
              </div>
            )}
          </Section>

          <Section emoji="🗓️" titre="Emploi du temps : créer une séance">
            <Creation vacataires={vacataires} onSaved={() => setV((x) => x + 1)} />
          </Section>

          <Section emoji="📚" titre="Programme des professeurs" ouvert>
            <Programme vacataires={vacataires} version={v} onChange={() => setV((x) => x + 1)} />
          </Section>

          <Messagerie role={role} />
        </div>
      </div>
    </div>
  );
}
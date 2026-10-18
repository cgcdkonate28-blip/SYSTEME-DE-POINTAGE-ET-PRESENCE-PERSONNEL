"use client";
import { useCallback, useEffect, useState } from "react";
import Messagerie from "../rh/Messages";

type Perm = {
  id_personnel: string;
  nom: string;
  prenom: string | null;
  profession: string | null;
  matricule: string;
  salaire: number | null;
  statut: "valide" | "paye" | "suspendu";
  motif: string | null;
  paye_le: string | null;
  montant: number | null;
};
type PermData = { mois: string; mois_disponibles: string[]; lignes: Perm[] };
type SeanceP = {
  id_edt: string;
  date_seance: string;
  heure_debut: string;
  heure_fin: string;
  matiere: string;
  promo: number;
  type_seance: string;
  num_seance: number | null;
  total_seances: number | null;
  groupe: string | null;
};
type Paiement = { paye_le: string; nb_seances: number; montant: number; par_nom: string | null };
type Vac = {
  id_personnel: string;
  nom: string;
  prenom: string | null;
  profession: string | null;
  matricule: string;
  nb: number;
  montant: number;
  due: boolean;
  prochaine: string | null;
  dernier_paiement: Paiement | null;
};
type VacData = { tarif: number; lignes: Vac[]; total: number };
type Detail = {
  tarif: number;
  nb: number;
  montant: number;
  seances: SeanceP[];
  historique: Paiement[];
  prochaine: string | null;
  due: boolean;
};

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const CHAMP = "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-500";
const BOUTON =
  "rounded-xl bg-gradient-to-br from-blue-500 to-slate-700 px-5 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-50";
const BOUTON2 = "rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const JSON_H = { "Content-Type": "application/json" };

const joli = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const nomComplet = (a: { nom: string; prenom?: string | null }) =>
  joli(a.prenom && a.prenom !== "-" ? `${a.prenom} ${a.nom}` : a.nom);
const dh = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} DH`;
const moisLong = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${MOIS[mm - 1]} ${y}`;
};
const dateFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dateLocale = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", year: "numeric" });
const heure = (h: string) => h.replace(":", "h");
const moisLocaux = () => {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      y -= 1;
      m = 12;
    }
  }
  return out;
};
const etiquette = (s: SeanceP) =>
  `${s.type_seance}${s.num_seance ? ` ${s.num_seance}/${s.total_seances}` : ""}${s.groupe ? ` · groupe ${s.groupe}` : ""}`;

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
const agir = (url: string, corps: object) => api(url, { method: "POST", headers: JSON_H, body: JSON.stringify(corps) });

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

function Choix({
  liste,
  valeur,
  onChange,
  vide,
}: {
  liste: { id_personnel: string; nom: string; prenom: string | null }[];
  valeur: string;
  onChange: (v: string) => void;
  vide: string;
}) {
  return (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} className={CHAMP}>
      <option value="">
        — {vide} ({liste.length}) —
      </option>
      {liste.map((a) => (
        <option key={a.id_personnel} value={a.id_personnel}>
          {nomComplet(a)}
        </option>
      ))}
    </select>
  );
}

function Compteur({ valeur, titre, boite }: { valeur: string | number; titre: string; boite: string }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${boite}`}>
      <p className="text-xl font-black leading-tight">{valeur}</p>
      <p className="text-xs">{titre}</p>
    </div>
  );
}

function LignePerm({ p, mois, apres }: { p: Perm; mois: string; apres: (m: string) => void }) {
  const [sal, setSal] = useState(p.salaire != null ? String(p.salaire) : "");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    setSal(p.salaire != null ? String(p.salaire) : "");
  }, [p.salaire]);

  const style =
    p.statut === "paye"
      ? "bg-blue-50 border-blue-200 text-blue-900"
      : p.statut === "suspendu"
      ? "bg-red-50 border-red-200 text-red-800"
      : "bg-green-50 border-green-200 text-green-800";
  const badge =
    p.statut === "paye"
      ? `✅ Payé${p.paye_le ? " le " + dateLocale(p.paye_le) : ""}`
      : p.statut === "suspendu"
      ? "⛔ Salaire suspendu"
      : "🟢 Validé : à payer";
  const salaireModifie = sal !== (p.salaire != null ? String(p.salaire) : "");

  async function enregistrerSalaire() {
    const n = Number(sal);
    if (!sal.trim() || Number.isNaN(n) || n < 0) {
      apres("❌ Montant invalide");
      return;
    }
    setOccupe(true);
    try {
      await agir("/api/admin/paie/salaire", { id_personnel: p.id_personnel, montant: n });
      apres(`✅ Salaire de ${nomComplet(p)} enregistré : ${dh(n)}`);
    } catch (e) {
      apres("❌ " + (e as Error).message);
    }
    setOccupe(false);
  }

  async function payer() {
    if (salaireModifie) {
      apres("❌ Enregistre d'abord le nouveau salaire avant de payer");
      return;
    }
    if (!p.salaire || p.salaire <= 0) {
      apres("❌ Définis d'abord le salaire mensuel de cet agent");
      return;
    }
    if (!confirm(`Payer ${dh(p.salaire)} à ${nomComplet(p)} pour ${moisLong(mois)} ?`)) return;
    setOccupe(true);
    try {
      await agir("/api/admin/paie/permanent/payer", { id_personnel: p.id_personnel, mois });
      apres(`✅ ${nomComplet(p)} : salaire de ${moisLong(mois)} payé`);
    } catch (e) {
      apres("❌ " + (e as Error).message);
    }
    setOccupe(false);
  }

  async function suspendre() {
    const motif = prompt(`Suspendre le salaire de ${moisLong(mois)} de ${nomComplet(p)}.\nMotif (facultatif) :`);
    if (motif === null) return;
    setOccupe(true);
    try {
      await agir("/api/admin/paie/permanent/suspendre", { id_personnel: p.id_personnel, mois, motif });
      apres(`⛔ Salaire de ${nomComplet(p)} suspendu pour ${moisLong(mois)}`);
    } catch (e) {
      apres("❌ " + (e as Error).message);
    }
    setOccupe(false);
  }

  async function lever() {
    setOccupe(true);
    try {
      await agir("/api/admin/paie/permanent/reactiver", { id_personnel: p.id_personnel, mois });
      apres(`✅ Suspension levée pour ${nomComplet(p)} : le salaire est de nouveau validé`);
    } catch (e) {
      apres("❌ " + (e as Error).message);
    }
    setOccupe(false);
  }

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${style}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold leading-tight">{nomComplet(p)}</p>
          <p className="text-xs opacity-80">{p.profession ?? "—"}</p>
        </div>
        <span className="shrink-0 text-xs font-bold">{badge}</span>
      </div>
      {p.statut === "suspendu" && p.motif && <p className="text-sm">Motif : {p.motif}</p>}
      {p.statut === "paye" && p.montant != null && <p className="text-sm">Montant versé : <b>{dh(p.montant)}</b></p>}

      {p.statut !== "paye" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            value={sal}
            onChange={(e) => setSal(e.target.value)}
            placeholder="Salaire mensuel (DH)"
            className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
          />
          <button onClick={enregistrerSalaire} disabled={occupe || !salaireModifie} className={BOUTON2}>
            Enregistrer le salaire
          </button>
        </div>
      )}

      {p.statut === "valide" && (
        <div className="flex flex-wrap gap-2">
          <button onClick={payer} disabled={occupe} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
            💰 Payer
          </button>
          <button onClick={suspendre} disabled={occupe} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 disabled:opacity-50">
            ⛔ Suspendre le salaire
          </button>
        </div>
      )}
      {p.statut === "suspendu" && (
        <button onClick={lever} disabled={occupe} className={BOUTON2}>
          ↩️ Lever la suspension
        </button>
      )}
    </div>
  );
}

function LigneVac({ v, tarif, apres }: { v: Vac; tarif: number; apres: (m: string) => void }) {
  const [occupe, setOccupe] = useState(false);
  const style =
    v.nb === 0
      ? "bg-gray-50 border-gray-200 text-gray-700"
      : v.due
      ? "bg-orange-50 border-orange-200 text-orange-800"
      : "bg-blue-50 border-blue-200 text-blue-900";
  const etat =
    v.nb === 0
      ? "Compteur à 0"
      : v.due
      ? `🟠 Paie à faire${v.prochaine ? " (due depuis le " + dateFr(v.prochaine) + ")" : ""}`
      : `⏳ Prochaine paie le ${v.prochaine ? dateFr(v.prochaine) : "—"}`;

  async function payer() {
    if (v.nb === 0) return;
    if (!confirm(`Payer ${dh(v.montant)} (${v.nb} séance${v.nb > 1 ? "s" : ""} × ${dh(tarif)}) à ${nomComplet(v)} ?\n\nLe compteur repartira à 0.`)) return;
    setOccupe(true);
    try {
      const d = await agir(`/api/admin/paie/vacataire/${v.id_personnel}/payer`, { nb_seances: v.nb });
      apres(`✅ ${dh(d.montant)} payés à ${nomComplet(v)} : compteur remis à 0`);
    } catch (e) {
      apres("❌ " + (e as Error).message);
    }
    setOccupe(false);
  }

  return (
    <div className={`rounded-xl border p-3 ${style}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold leading-tight">{nomComplet(v)}</p>
          <p className="text-xs opacity-80">{v.profession ?? "—"}</p>
          <p className="mt-1 text-sm">
            <b>{v.nb}</b> séance{v.nb > 1 ? "s" : ""} × {dh(tarif)} = <b>{dh(v.montant)}</b>
          </p>
          <p className="text-xs">{etat}</p>
          {v.dernier_paiement && (
            <p className="text-xs opacity-80">
              Dernier paiement : {dateLocale(v.dernier_paiement.paye_le)} ({dh(v.dernier_paiement.montant)})
            </p>
          )}
        </div>
        <button
          onClick={payer}
          disabled={occupe || v.nb === 0}
          className="shrink-0 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          💰 Payer
        </button>
      </div>
    </div>
  );
}

export default function PaieClient({ nom, prenom, role }: { nom: string; prenom: string; role: string }) {
  const affiche = nomComplet({ nom, prenom });
  const initiale = affiche.charAt(0).toUpperCase() || "A";
  const libRole = role === "DirectionGenerale" ? "Direction générale" : "Service de paie";

  const [mois, setMois] = useState(moisLocaux()[0]);
  const [perm, setPerm] = useState<PermData | null>(null);
  const [vac, setVac] = useState<VacData | null>(null);
  const [erreur, setErreur] = useState("");
  const [msgPerm, setMsgPerm] = useState("");
  const [msgVac, setMsgVac] = useState("");
  const [sel1, setSel1] = useState("");
  const [sel2, setSel2] = useState("");
  const [selDetail, setSelDetail] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [occupeTous, setOccupeTous] = useState(false);

  const chargerPerm = useCallback(async (m: string) => {
    try {
      const d: PermData = await api(`/api/admin/paie/permanents${m ? `?mois=${m}` : ""}`);
      setPerm(d);
      setMois(d.mois);
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  const chargerVac = useCallback(async () => {
    try {
      setVac(await api("/api/admin/paie/vacataires"));
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  const chargerDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await api(`/api/admin/paie/vacataire/${id}`));
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  useEffect(() => {
    chargerPerm("");
    chargerVac();
    const t = setInterval(chargerVac, 20000);
    return () => clearInterval(t);
  }, [chargerPerm, chargerVac]);

  useEffect(() => {
    chargerDetail(selDetail);
  }, [selDetail, chargerDetail]);

  async function deconnexion() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function apresPerm(m: string) {
    setMsgPerm(m);
    await chargerPerm(mois);
  }
  async function apresVac(m: string) {
    setMsgVac(m);
    await chargerVac();
    await chargerDetail(selDetail);
  }

  async function toutPayer() {
    if (!perm) return;
    const n = perm.lignes.filter((l) => l.statut === "valide" && (l.salaire ?? 0) > 0).length;
    if (n === 0) {
      setMsgPerm("Aucun salaire validé à payer pour ce mois.");
      return;
    }
    if (!confirm(`Payer les ${n} salaire(s) validé(s) de ${moisLong(mois)} ?`)) return;
    setOccupeTous(true);
    try {
      const d = await agir("/api/admin/paie/permanents/payer-tous", { mois });
      setMsgPerm(
        `✅ ${d.payes} salaire(s) payé(s)${d.sans_salaire ? ` · ${d.sans_salaire} agent(s) sans salaire défini (ignorés)` : ""}`
      );
      await chargerPerm(mois);
    } catch (e) {
      setMsgPerm("❌ " + (e as Error).message);
    }
    setOccupeTous(false);
  }

  const lp = perm?.lignes ?? [];
  const lv = vac?.lignes ?? [];
  const p1 = lp.find((x) => x.id_personnel === sel1);
  const v2 = lv.find((x) => x.id_personnel === sel2);
  const aPayer = lp.filter((l) => l.statut === "valide" && (l.salaire ?? 0) > 0).reduce((s, l) => s + (l.salaire ?? 0), 0);

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
          <Section emoji="👥" titre="Personnel permanent">
            <p className="text-sm text-gray-500">Choisis un agent pour voir sa fiche.</p>
            <Choix liste={lp} valeur={sel1} onChange={setSel1} vide="Choisir un agent" />
            {p1 && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-1 text-sm">
                <p className="text-base font-bold">{nomComplet(p1)}</p>
                <p>Fonction : <b>{p1.profession ?? "—"}</b></p>
                <p>Matricule : <b>{p1.matricule}</b></p>
                <p>Salaire mensuel : <b>{p1.salaire != null ? dh(p1.salaire) : "non défini"}</b></p>
              </div>
            )}
          </Section>

          <Section emoji="🎓" titre="Personnel vacataire">
            <p className="text-sm text-gray-500">Choisis un professeur pour voir sa fiche.</p>
            <Choix liste={lv} valeur={sel2} onChange={setSel2} vide="Choisir un professeur" />
            {v2 && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-1 text-sm">
                <p className="text-base font-bold">{nomComplet(v2)}</p>
                <p>Fonction : <b>{v2.profession ?? "—"}</b></p>
                <p>Matricule : <b>{v2.matricule}</b></p>
                <p>Solde actuel : <b>{v2.nb} séance(s) = {dh(v2.montant)}</b></p>
              </div>
            )}
          </Section>

          <Section emoji="💼" titre="Salaires du personnel permanent" ouvert>
            <label className="block text-sm text-gray-600">
              Mois
              <select value={mois} onChange={(e) => chargerPerm(e.target.value)} className={CHAMP}>
                {(perm?.mois_disponibles ?? moisLocaux()).map((m) => (
                  <option key={m} value={m}>
                    {moisLong(m)}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1">
              <p>🟢 <b>Validé</b> : le mois est validé d&apos;office pour tous les agents. Il reste à le payer.</p>
              <p>⛔ <b>Suspendu</b> : en cas de problème, le bouton « Suspendre le salaire » bloque le salaire du mois. Tu peux lever la suspension ensuite.</p>
              <p>✅ <b>Payé</b> : le salaire est versé et ne peut plus être modifié.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Compteur valeur={lp.filter((l) => l.statut === "valide").length} titre="🟢 À payer" boite="bg-green-50 border-green-200 text-green-800" />
              <Compteur valeur={lp.filter((l) => l.statut === "paye").length} titre="✅ Payés" boite="bg-blue-50 border-blue-200 text-blue-800" />
              <Compteur valeur={lp.filter((l) => l.statut === "suspendu").length} titre="⛔ Suspendus" boite="bg-red-50 border-red-200 text-red-800" />
              <Compteur valeur={dh(aPayer)} titre="Total à payer" boite="bg-gray-50 border-gray-200 text-gray-700" />
            </div>

            <button onClick={toutPayer} disabled={occupeTous} className={BOUTON}>
              💰 Payer tous les salaires validés
            </button>
            {msgPerm && <p className="text-sm">{msgPerm}</p>}

            {lp.length === 0 && <p className="text-sm text-gray-500">Aucun agent permanent enregistré pour le moment.</p>}
            <div className="space-y-2">
              {lp.map((p) => (
                <LignePerm key={p.id_personnel} p={p} mois={mois} apres={apresPerm} />
              ))}
            </div>
          </Section>

          <Section emoji="🧾" titre="Paiement des vacataires" ouvert>
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600 space-y-1">
              <p>Chaque séance <b>assurée</b> rapporte <b>{dh(vac?.tarif ?? 400)}</b> : la séance est passée et le professeur a pointé dans la demi-journée.</p>
              <p>Le solde augmente tout seul à chaque séance. La paie se fait toutes les 2 semaines : un clic sur « Payer » règle le solde et <b>remet le compteur à 0</b>.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Compteur valeur={dh(vac?.total ?? 0)} titre="Total dû aux vacataires" boite="bg-blue-50 border-blue-200 text-blue-800" />
              <Compteur valeur={lv.filter((l) => l.due).length} titre="🟠 Paies à faire" boite="bg-orange-50 border-orange-200 text-orange-800" />
            </div>
            {msgVac && <p className="text-sm">{msgVac}</p>}

            {lv.length === 0 && <p className="text-sm text-gray-500">Aucun vacataire enregistré pour le moment.</p>}
            <div className="space-y-2">
              {lv.map((v) => (
                <LigneVac key={v.id_personnel} v={v} tarif={vac?.tarif ?? 400} apres={apresVac} />
              ))}
            </div>

            <div className="rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="font-bold">🔎 Détail d&apos;un professeur</p>
              <Choix liste={lv} valeur={selDetail} onChange={setSelDetail} vide="Choisir un professeur" />
              {detail && (
                <>
                  <p className="text-sm">
                    Solde : <b>{detail.nb}</b> séance(s) = <b>{dh(detail.montant)}</b>
                  </p>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-gray-600">Séances à payer ({detail.seances.length})</p>
                    {detail.seances.length === 0 && <p className="text-sm text-gray-500">Aucune : le compteur est à 0.</p>}
                    {detail.seances.map((s) => (
                      <div key={s.id_edt} className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                        <b>{s.matiere}</b> · {etiquette(s)} · Promo {s.promo}
                        <br />
                        {dateFr(s.date_seance)} · {heure(s.heure_debut)} – {heure(s.heure_fin)}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-gray-600">Historique des paiements</p>
                    {detail.historique.length === 0 && <p className="text-sm text-gray-500">Aucun paiement pour le moment.</p>}
                    {detail.historique.map((h, i) => (
                      <div key={i} className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
                        {dateLocale(h.paye_le)} : <b>{dh(h.montant)}</b> pour {h.nb_seances} séance(s)
                        {h.par_nom ? ` · par ${joli(h.par_nom)}` : ""}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>

          <Messagerie role={role} />
        </div>
      </div>
    </div>
  );
}
"use client";
import { useCallback, useEffect, useState } from "react";
import Messagerie from "../rh/Messages";

type Alerte = { nom: string; prenom: string | null; statut: string; detail: string; commentaire: string | null };
type Synthese = {
  date: string;
  maintenant: string;
  effectifs: { permanents: number; vacataires: number };
  presence: {
    ok: number;
    retard: number;
    absent: number;
    attendu: number;
    autorise: number;
    repos: number;
    departs_anticipes: number;
    total: number;
    alertes: Alerte[];
  };
  scolarite: {
    total: number;
    assurees: number;
    non_assurees: number;
    a_venir: number;
    non_assurees_liste: { prof: string; matiere: string; debut: string; fin: string; salle: string }[];
  };
  paie: {
    mois: string;
    valides: number;
    payes: number;
    suspendus: number;
    total_a_payer: number;
    vac_total_du: number;
    vac_seances: number;
    vac_paies_a_faire: number;
    tarif: number;
  };
  admins: { nom: string; role: string }[];
};

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const ROLES: Record<string, string> = {
  RH: "Ressources humaines",
  Scolarite: "Scolarité",
  Paie: "Service de paie",
  DirectionGenerale: "Direction générale",
};
const BOUTON2 = "rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50";

const joli = (s?: string | null) =>
  (s ?? "").toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const nomComplet = (a: { nom: string; prenom?: string | null }) =>
  joli(a.prenom && a.prenom !== "-" ? `${a.prenom} ${a.nom}` : a.nom);
const dh = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} DH`;
const heure = (h: string) => h.replace(":", "h");
const moisLong = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${MOIS[mm - 1]} ${y}`;
};
const dateFr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

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

function Compteur({ valeur, titre, boite }: { valeur: string | number; titre: string; boite: string }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${boite}`}>
      <p className="text-xl font-black leading-tight">{valeur}</p>
      <p className="text-xs">{titre}</p>
    </div>
  );
}

const ESPACES = [
  { href: "/admin/rh", emoji: "👥", titre: "Ressources humaines", texte: "Personnel permanent, horaires, congés et suspensions, présence du jour, historique" },
  { href: "/admin/scolarite", emoji: "🗓️", titre: "Scolarité", texte: "Emplois du temps des vacataires, création et reprogrammation des séances" },
  { href: "/admin/paie", emoji: "💰", titre: "Service de paie", texte: "Salaires des permanents, paiement des vacataires" },
];

export default function DirectionClient({ nom, prenom, role }: { nom: string; prenom: string; role: string }) {
  const affiche = nomComplet({ nom, prenom });
  const initiale = affiche.charAt(0).toUpperCase() || "D";

  const [s, setS] = useState<Synthese | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/direction/synthese", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/admin/connexion";
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
      setS(d);
      setErreur("");
    } catch (e) {
      setErreur((e as Error).message);
    }
  }, []);

  useEffect(() => {
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, [charger]);

  async function deconnexion() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/";
  }

  const groupes = Object.keys(ROLES).map((r) => ({ role: r, gens: (s?.admins ?? []).filter((a) => a.role === r) }));

  return (
    <div className="relative min-h-screen bg-white text-gray-900 overflow-hidden">
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
            <p className="text-gray-400 text-xs uppercase tracking-widest">Espace administrateur 🛡️ · Direction générale</p>
            <h1 className="text-2xl font-extrabold leading-tight">Salut {affiche} !</h1>
          </div>
        </div>

        {erreur && <p className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{erreur}</p>}

        <div className="space-y-3">
          <Section emoji="🚪" titre="Accès aux espaces" ouvert>
            <p className="text-sm text-gray-500">
              Tu as tous les droits dans chaque espace. Un bouton « ← Direction » te ramène ici.
            </p>
            <div className="space-y-2">
              {ESPACES.map((e) => (
                <a
                  key={e.href}
                  href={e.href}
                  className="block rounded-xl border border-gray-200 bg-white p-4 hover:bg-gray-50"
                >
                  <p className="font-bold">
                    {e.emoji} {e.titre} <span className="text-gray-400">→</span>
                  </p>
                  <p className="text-sm text-gray-500">{e.texte}</p>
                </a>
              ))}
            </div>
          </Section>

          <Section emoji="📊" titre="Vue d'ensemble du jour" ouvert>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                {s ? `Le ${dateFr(s.date)} à ${s.maintenant} (heure de l'école)` : "Chargement…"}
              </p>
              <button onClick={charger} className={BOUTON2}>
                🔄 Actualiser
              </button>
            </div>

            {s && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Compteur valeur={s.effectifs.permanents} titre="Personnel permanent" boite="bg-gray-50 border-gray-200 text-gray-700" />
                  <Compteur valeur={s.effectifs.vacataires} titre="Professeurs vacataires" boite="bg-gray-50 border-gray-200 text-gray-700" />
                </div>

                <div className="space-y-3">
                  <p className="font-bold">✅ Présence du personnel permanent</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Compteur valeur={s.presence.ok} titre="🟢 À l'heure" boite="bg-green-50 border-green-200 text-green-800" />
                    <Compteur valeur={s.presence.retard} titre="🟠 En retard" boite="bg-orange-50 border-orange-200 text-orange-800" />
                    <Compteur valeur={s.presence.absent} titre="🔴 Absents" boite="bg-red-50 border-red-200 text-red-800" />
                    <Compteur valeur={s.presence.departs_anticipes} titre="⚠️ Départs anticipés" boite="bg-orange-50 border-orange-200 text-orange-800" />
                  </div>
                  {s.presence.alertes.length === 0 ? (
                    <p className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                      ✅ Aucun retard, absence ni départ anticipé pour le moment.
                    </p>
                  ) : (
                    s.presence.alertes.map((a, i) => (
                      <div
                        key={i}
                        className={`rounded-xl border p-3 ${
                          a.statut === "absent" ? "bg-red-50 border-red-200 text-red-800" : "bg-orange-50 border-orange-200 text-orange-800"
                        }`}
                      >
                        <p className="font-bold leading-tight">{nomComplet(a)}</p>
                        <p className="text-sm">{a.detail}</p>
                        {a.commentaire && <p className="text-sm font-semibold">{a.commentaire}</p>}
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3">
                  <p className="font-bold">🗓️ Séances du jour (vacataires)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <Compteur valeur={s.scolarite.assurees} titre="✅ Assurées" boite="bg-green-50 border-green-200 text-green-800" />
                    <Compteur valeur={s.scolarite.a_venir} titre="À venir" boite="bg-gray-50 border-gray-200 text-gray-700" />
                    <Compteur valeur={s.scolarite.non_assurees} titre="❌ Sans pointage" boite="bg-red-50 border-red-200 text-red-800" />
                  </div>
                  {s.scolarite.total === 0 && <p className="text-sm text-gray-500">Aucune séance programmée aujourd&apos;hui.</p>}
                  {s.scolarite.non_assurees_liste.map((x, i) => (
                    <div key={i} className="rounded-xl border p-3 bg-red-50 border-red-200 text-red-800">
                      <p className="font-bold leading-tight">{x.matiere}</p>
                      <p className="text-sm">
                        {joli(x.prof)} · {heure(x.debut)} – {heure(x.fin)} · {x.salle}
                      </p>
                      <p className="text-sm font-semibold">Le professeur n&apos;a pas pointé.</p>
                    </div>
                  ))}
                </div>

                </>
            )}
          </Section>

          <Section emoji="🛡️" titre="Administrateurs et accès">
            {groupes.map((g) => (
              <div key={g.role} className="space-y-1">
                <p className="text-sm font-semibold text-gray-600">{ROLES[g.role]}</p>
                {g.gens.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun administrateur.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {g.gens.map((a, i) => (
                      <span key={i} className="rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-sm">
                        {joli(a.nom)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs text-gray-400">
              Pour ajouter un administrateur, utilise l&apos;espace technicien (clé à molette de l&apos;accueil). Les clés des groupes ne s&apos;affichent jamais.
            </p>
          </Section>

          <Messagerie role={role} />
        </div>
      </div>
    </div>
  );
}
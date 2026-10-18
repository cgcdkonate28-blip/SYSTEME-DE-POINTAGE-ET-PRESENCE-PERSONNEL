"use client";
import { useEffect, useRef, useState } from "react";

const FONDS = [1, 2, 3, 4, 5].map((n) => `/images/fonds/fond-${n}.jpeg`);
const ROLES = [
  { v: "RH", l: "Ressources humaines" },
  { v: "Scolarite", l: "Scolarité" },
  { v: "Paie", l: "Service de paie" },
  { v: "DirectionGenerale", l: "Direction générale" },
];

function Fond() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FONDS.length), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-0">
      {FONDS.map((src, k) => (
        <div
          key={src}
          className="absolute inset-0 scale-105 bg-cover bg-center blur-sm transition-opacity duration-1000"
          style={{ backgroundImage: `url(${src})`, opacity: k === i ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 bg-black/60" />
    </div>
  );
}

const champ = "w-full rounded-lg bg-slate-800/90 px-4 py-2 outline-none";
const bouton = "rounded-lg bg-blue-600 px-5 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50";

export default function TechnicienClient() {
  const [onglet, setOnglet] = useState<"agent" | "admin">("agent");
  const [etape, setEtape] = useState<"form" | "camera" | "fini">("form");
  const [f, setF] = useState({ nom: "", prenom: "", profession: "", statut: "permanent", email: "", contact: "" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<any>(null);
  const [adminNom, setAdminNom] = useState("");
  const [adminRole, setAdminRole] = useState("RH");
  const [adminOk, setAdminOk] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function arreterCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  useEffect(() => () => arreterCamera(), []);
  useEffect(() => {
    if (etape === "camera" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [etape]);

  async function ouvrirCamera(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    if (!photo) return setErreur("Ajoute la photo de l'agent");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setEtape("camera");
    } catch {
      setErreur("Caméra inaccessible : autorise-la dans Chrome (icône à gauche de l'adresse)");
    }
  }

  async function capturerEtInscrire() {
    const v = videoRef.current;
    if (!v || !photo) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (!blob) return setErreur("Capture impossible");
    setEnvoi(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, val]) => fd.append(k, val));
    fd.append("photo", photo);
    fd.append("capture", blob, "capture.jpg");
    try {
      const r = await fetch("/api/technicien/inscrire", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      arreterCamera();
      if (r.ok) {
        setResultat(d);
        setEtape("fini");
      } else {
        setErreur(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
        setEtape("form");
      }
    } catch {
      arreterCamera();
      setErreur("Serveur injoignable");
      setEtape("form");
    }
    setEnvoi(false);
  }

  async function ajouterAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setAdminOk("");
    const fd = new FormData();
    fd.append("nom", adminNom);
    fd.append("role", adminRole);
    try {
      const r = await fetch("/api/technicien/admin", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setAdminOk(`Admin « ${adminNom.toUpperCase()} » enregistré (${d.role}, matricule ${d.matricule}). Il se connecte avec son nom et la clé du groupe ${d.role}.`);
        setAdminNom("");
      } else setErreur(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
    } catch {
      setErreur("Serveur injoignable");
    }
  }

  function nouveau() {
    setF({ nom: "", prenom: "", profession: "", statut: "permanent", email: "", contact: "" });
    setPhoto(null);
    setResultat(null);
    setErreur("");
    setEtape("form");
  }

  async function quitter() {
    arreterCamera();
    await fetch("/api/technicien/quitter", { method: "POST" });
    window.location.href = "/";
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <main className="relative min-h-screen text-white">
      <Fond />
      <div className="relative z-10 mx-auto max-w-xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-widest">ESPACE TECHNICIEN</h1>
          <button onClick={quitter} className="rounded-lg bg-slate-700/90 px-4 py-2">Quitter</button>
        </div>

        <div className="mb-4 flex gap-2">
          {(["agent", "admin"] as const).map((o) => (
            <button
              key={o}
              onClick={() => { setOnglet(o); setErreur(""); }}
              className={`flex-1 rounded-lg py-2 font-semibold ${onglet === o ? "bg-blue-600" : "bg-slate-800/80"}`}
            >
              {o === "agent" ? "Inscrire un agent" : "Ajouter un admin"}
            </button>
          ))}
        </div>

        <div className="rounded-2xl bg-slate-900/85 p-6 backdrop-blur">
          {erreur && <p className="mb-4 rounded-lg bg-red-950/80 p-3 text-sm text-red-300">{erreur}</p>}

          {onglet === "agent" && etape === "form" && (
            <form onSubmit={ouvrirCamera} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input required placeholder="Nom" value={f.nom} onChange={set("nom")} className={champ} />
                <input required placeholder="Prénom" value={f.prenom} onChange={set("prenom")} className={champ} />
              </div>
              <input required placeholder="Fonction / profession" value={f.profession} onChange={set("profession")} className={champ} />
              <select value={f.statut} onChange={set("statut")} className={champ}>
                <option value="permanent">Permanent</option>
                <option value="vacataire">Vacataire</option>
              </select>
              <input required type="email" placeholder="Email" value={f.email} onChange={set("email")} className={champ} />
              <input required placeholder="Contact (téléphone)" value={f.contact} onChange={set("contact")} className={champ} />
              <label className="block text-sm text-white/70">
                Photo de l'agent (JPG, PNG, WEBP, HEIC…)
                <input
                  required
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm"
                />
              </label>
              <button type="submit" className={`${bouton} w-full`}>Continuer vers le scan du visage</button>
            </form>
          )}

          {onglet === "agent" && etape === "camera" && (
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} muted playsInline className="w-full -scale-x-100" />
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[75%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
              </div>
              <p className="text-center text-sm text-white/70">Place le visage dans l'ovale, de face, bien éclairé.</p>
              <div className="flex gap-3">
                <button onClick={capturerEtInscrire} disabled={envoi} className={`${bouton} flex-1`}>
                  {envoi ? "Analyse en cours…" : "Capturer et inscrire"}
                </button>
                <button
                  onClick={() => { arreterCamera(); setEtape("form"); }}
                  disabled={envoi}
                  className="rounded-lg bg-slate-700 px-5 py-2"
                >
                  Retour
                </button>
              </div>
            </div>
          )}

          {onglet === "agent" && etape === "fini" && resultat && (
            <div className="space-y-3 text-center">
              <p className="text-xl font-bold text-green-400">Agent inscrit</p>
              <p>Matricule : <b>{resultat.matricule}</b></p>
              <p className="text-sm text-white/70">Carte PDF créée dans le dossier « cartes » du projet.</p>
              <p className="text-xs text-white/50">Score de similitude : {resultat.score}</p>
              <button onClick={nouveau} className={bouton}>Inscrire un autre agent</button>
            </div>
          )}

          {onglet === "admin" && (
            <form onSubmit={ajouterAdmin} className="space-y-3">
              <input required placeholder="Nom de l'admin" value={adminNom} onChange={(e) => setAdminNom(e.target.value)} className={champ} />
              <select value={adminRole} onChange={(e) => setAdminRole(e.target.value)} className={champ}>
                {ROLES.map((r) => (
                  <option key={r.v} value={r.v}>{r.l}</option>
                ))}
              </select>
              {adminOk && <p className="rounded-lg bg-green-950/80 p-3 text-sm text-green-300">{adminOk}</p>}
              <button type="submit" className={`${bouton} w-full`}>Enregistrer l'admin</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}


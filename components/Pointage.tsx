"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Etape = "qr" | "agent" | "analyse" | "ok" | "refus";
const MATRICULE = /^EIGSI-\d{6}$/;

export default function Pointage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const occupe = useRef(false);
  const [etape, setEtape] = useState<Etape>("qr");
  const [agent, setAgent] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [erreurCam, setErreurCam] = useState("");

  // Caméra : allumée à l'ouverture du mode, coupée à la fermeture
  useEffect(() => {
    let annule = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (annule) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => setErreurCam("Caméra inaccessible : autorise-la dans Chrome"));
    return () => {
      annule = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Lecture du QR en continu
  useEffect(() => {
    if (etape !== "qr") return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const t = setInterval(async () => {
      const v = videoRef.current;
      if (!v || v.videoWidth === 0 || occupe.current) return;
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      ctx.drawImage(v, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      const m = code?.data?.trim();
      if (!m || !MATRICULE.test(m)) return;

      occupe.current = true;
      try {
        const r = await fetch("/api/pointage/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matricule: m }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          setAgent(d);
          setEtape("agent");
        } else {
          setMessage(typeof d.detail === "string" ? d.detail : "Carte non reconnue");
          setEtape("refus");
        }
      } catch {
        setMessage("Serveur injoignable");
        setEtape("refus");
      }
      occupe.current = false;
    }, 250);
    return () => clearInterval(t);
  }, [etape]);

  // Retour automatique à l'écran de scan QR
  useEffect(() => {
    if (etape !== "ok" && etape !== "refus") return;
    const t = setTimeout(() => {
      setAgent(null);
      setMessage("");
      setEtape("qr");
    }, 4500);
    return () => clearTimeout(t);
  }, [etape]);

  async function verifierVisage() {
    const v = videoRef.current;
    if (!v || !agent) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (!blob) return;

    setEtape("analyse");
    const fd = new FormData();
    fd.append("matricule", agent.matricule);
    fd.append("capture", blob, "capture.jpg");
    try {
      const r = await fetch("/api/pointage/valider", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMessage(
          d.type === "sortie"
            ? `Sortie enregistrée. Bonne soirée, ${agent.prenom} !`
            : `Entrée enregistrée. Bonne journée, ${agent.prenom} !`
        );
        setEtape("ok");
      } else {
        setMessage(typeof d.detail === "string" ? d.detail : `Erreur ${r.status}`);
        setEtape("refus");
      }
    } catch {
      setMessage("Serveur injoignable");
      setEtape("refus");
    }
  }

  function annuler() {
    setAgent(null);
    setMessage("");
    setEtape("qr");
  }

  return (
    <div className="w-full max-w-xl rounded-2xl bg-slate-900/85 p-6 backdrop-blur">
      <h2 className="mb-4 text-center text-xl font-bold tracking-widest">POINTAGE DU PERSONNEL</h2>

      {erreurCam && <p className="mb-3 rounded-lg bg-red-950/80 p-3 text-sm text-red-300">{erreurCam}</p>}

      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline className="w-full -scale-x-100" />

        {etape === "qr" && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[55%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        )}
        {(etape === "agent" || etape === "analyse") && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
        )}
        {etape === "ok" && (
          <div className="absolute inset-0 flex items-center justify-center bg-green-900/85 p-6 text-center text-2xl font-bold">
            {message}
          </div>
        )}
        {etape === "refus" && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/85 p-6 text-center text-2xl font-bold">
            {message}
          </div>
        )}
      </div>

      {etape === "qr" && (
        <p className="mt-4 text-center text-white/80">Présente le QR code de ta carte devant la caméra.</p>
      )}

      {(etape === "agent" || etape === "analyse") && agent && (
        <div className="mt-4 space-y-3 text-center">
          <p className="text-xl font-bold">{agent.prenom} {agent.nom}</p>
          <p className="text-white/70">{agent.profession}</p>
          <p className="text-sm text-white/60">Place ton visage dans l'ovale, de face, puis valide.</p>
          <div className="flex gap-3">
            <button
              onClick={verifierVisage}
              disabled={etape === "analyse"}
              className="flex-1 rounded-lg bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              {etape === "analyse" ? "Vérification…" : "Scanner mon visage"}
            </button>
            <button
              onClick={annuler}
              disabled={etape === "analyse"}
              className="rounded-lg bg-slate-700 px-5 py-2"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


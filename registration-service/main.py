import base64
import io
import json
import os
import re
import secrets
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
import pillow_heif
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from insightface.app import FaceAnalysis
from PIL import Image, ImageOps
from supabase import create_client

from carte import generer_carte

load_dotenv()
pillow_heif.register_heif_opener()

SEUIL = 0.40
ANNEE = "2026-2027"
ROLES = {"RH", "Scolarite", "Paie", "DirectionGenerale"}
MATRICULE_RE = re.compile(r"^EIGSI-\d{6}$")
DOSSIER_PHOTOS = Path(__file__).resolve().parent / "photos"
DOSSIER_PHOTOS.mkdir(exist_ok=True)

_u = urlparse(os.environ["SUPABASE_URL"].strip())
SUPABASE_URL = f"{_u.scheme}://{_u.netloc}"
import threading
import time

_SB_URL = SUPABASE_URL
_SB_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()
_SB_VERROU = threading.RLock()
_SB_ERREURS_RESEAU = {
    "RemoteProtocolError", "ReadError", "WriteError", "ConnectError", "ReadTimeout",
    "WriteTimeout", "ConnectTimeout", "PoolTimeout", "CloseError", "LocalProtocolError",
}


def _sb_est_reseau(e) -> bool:
    return (
        isinstance(e, (httpx.TransportError, OSError))
        or type(e).__name__ in _SB_ERREURS_RESEAU
        or "disconnected" in str(e).lower()
    )


class _SbRequete:
    def __init__(self, racine, table, appels):
        self._racine, self._table, self._appels = racine, table, appels

    def __getattr__(self, nom):
        if nom.startswith("_"):
            raise AttributeError(nom)

        def appel(*a, **k):
            if nom == "execute":
                return self._racine._executer(self._table, self._appels)
            return _SbRequete(self._racine, self._table, self._appels + [(nom, a, k)])

        return appel


class _SbRobuste:
    """Client Supabase : requêtes une par une (pas de connexion partagée en parallèle),
    avec reconnexion et nouvel essai quand la connexion HTTP est coupée."""

    def __init__(self):
        self._client = create_client(_SB_URL, _SB_KEY)

    def table(self, nom):
        return _SbRequete(self, nom, [])

    def _executer(self, table, appels):
        derniere = None
        with _SB_VERROU:
            for essai in range(4):
                try:
                    b = self._client.table(table)
                    for nom, a, k in appels:
                        b = getattr(b, nom)(*a, **k)
                    return b.execute()
                except Exception as e:
                    if _sb_est_reseau(e):
                        derniere = e
                        time.sleep(0.15 * (essai + 1))
                        self._client = create_client(_SB_URL, _SB_KEY)
                        continue
                    raise
        raise derniere

    def __getattr__(self, nom):
        if nom.startswith("_"):
            raise AttributeError(nom)
        return getattr(self._client, nom)


supabase = _SbRobuste()

modele = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
modele.prepare(ctx_id=-1, det_size=(640, 640))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def erreur_generale(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__} : {exc}"})


def verifier(x_token: str = Header(default="")):
    attendu = os.getenv("INTERNAL_TOKEN", "").strip()
    if not attendu or x_token.strip() != attendu:
        raise HTTPException(401, "Non autorisé")


def lire_image(data: bytes) -> Image.Image:
    try:
        return ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Format d'image non reconnu")


def vecteur(img: Image.Image, nom: str) -> np.ndarray:
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    visages = modele.get(bgr)
    if not visages:
        raise HTTPException(400, f"Aucun visage détecté sur {nom}")
    plus_grand = max(visages, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return plus_grand.normed_embedding


def en_data_url(img: Image.Image) -> str:
    img = img.copy()
    img.thumbnail((768, 768))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def avis_grok(img1: Image.Image, img2: Image.Image):
    cle = os.getenv("GROK_API_KEY", "").strip()
    if not cle:
        return None
    try:
        r = httpx.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {cle}"},
            timeout=30,
            json={
                "model": os.getenv("GROK_MODEL", "grok-4.7"),
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Ces deux images montrent-elles la même personne réelle (et non une photo d'écran ou d'impression) ? Réponds uniquement par un JSON : {\"meme_personne\": true ou false, \"raison\": \"...\"}"},
                        {"type": "image_url", "image_url": {"url": en_data_url(img1)}},
                        {"type": "image_url", "image_url": {"url": en_data_url(img2)}},
                    ],
                }],
            },
        )
        texte = r.json()["choices"][0]["message"]["content"]
        return json.loads(texte[texte.index("{"): texte.rindex("}") + 1])
    except Exception:
        return {"erreur": True}


def matricule_libre(prefixe: str) -> str:
    while True:
        m = f"{prefixe}-{secrets.randbelow(10**6):06d}"
        if not supabase.table("personnel").select("id_personnel").eq("matricule", m).execute().data:
            return m


@app.post("/inscrire", dependencies=[Depends(verifier)])
async def inscrire(
    nom: str = Form(...),
    prenom: str = Form(...),
    profession: str = Form(...),
    statut: str = Form(...),
    email: str = Form(...),
    contact: str = Form(...),
    photo: UploadFile = File(...),
    capture: UploadFile = File(...),
):
    statut = statut.strip().lower()
    if statut not in ("permanent", "vacataire"):
        raise HTTPException(400, "Statut invalide (permanent ou vacataire)")

    img_photo = lire_image(await photo.read())
    img_cap = lire_image(await capture.read())
    v_photo = vecteur(img_photo, "la photo")
    v_cap = vecteur(img_cap, "la capture caméra")

    score = float(np.dot(v_photo, v_cap))
    if score < SEUIL:
        raise HTTPException(422, f"Visages non compatibles (score {score:.2f})")

    grok = avis_grok(img_photo, img_cap)
    if grok and grok.get("meme_personne") is False:
        raise HTTPException(422, f"Refusé par Grok : {grok.get('raison', 'visages différents')}")

    moyen = v_photo + v_cap
    moyen = moyen / np.linalg.norm(moyen)

    matricule = matricule_libre("EIGSI")
    chemin_photo = DOSSIER_PHOTOS / f"{matricule}.jpg"
    img_photo.save(chemin_photo, "JPEG", quality=92)

    id_p = None
    try:
        ligne = supabase.table("personnel").insert({
            "matricule": matricule,
            "nom": nom.strip().upper(),
            "prenom": prenom.strip(),
            "email": email.strip(),
            "numero": contact.strip(),
            "profession": profession.strip(),
            "type_personnel": statut,
            "photo1_url": str(chemin_photo),
        }).execute().data[0]
        id_p = ligne["id_personnel"]

        supabase.table(statut).insert({"id_personnel": id_p}).execute()
        supabase.table("embedding_facial").insert({
            "id_personnel": id_p,
            "vecteur": moyen.tolist(),
        }).execute()

        carte = generer_carte({
            "matricule": matricule,
            "nom": nom.strip(),
            "prenom": prenom.strip(),
            "profession": profession.strip(),
            "statut": statut.capitalize(),
            "contact": contact.strip(),
            "annee": ANNEE,
        }, str(chemin_photo))
    except Exception as e:
        if id_p:
            supabase.table("personnel").delete().eq("id_personnel", id_p).execute()
        raise HTTPException(500, f"Échec de l'inscription : {e}")

    return {
        "ok": True,
        "matricule": matricule,
        "carte": str(carte),
        "score": round(score, 3),
        "grok": grok,
    }


@app.post("/admin", dependencies=[Depends(verifier)])
async def ajouter_admin(nom: str = Form(...), role: str = Form(...)):
    if role not in ROLES:
        raise HTTPException(400, "Groupe invalide")
    matricule = matricule_libre("ADM")
    ligne = supabase.table("personnel").insert({
        "matricule": matricule,
        "nom": nom.strip().upper(),
        "prenom": "-",
        "email": f"{matricule.lower()}@admin.eigsi.local",
        "profession": f"Admin {role}",
        "type_personnel": "permanent",
    }).execute().data[0]
    supabase.table("permanent").insert({"id_personnel": ligne["id_personnel"]}).execute()
    supabase.table("acces_utilisateur").insert({
        "id_personnel": ligne["id_personnel"],
        "role": role,
    }).execute()
    return {"ok": True, "matricule": matricule, "role": role}


@app.post("/admin/login", dependencies=[Depends(verifier)])
async def login_admin(nom: str = Form(...), role: str = Form(...)):
    if role not in ROLES:
        raise HTTPException(400, "Groupe invalide")
    nom_n = nom.strip().upper()
    pers = (
        supabase.table("personnel")
        .select("id_personnel,nom,prenom,matricule")
        .eq("nom", nom_n)
        .execute()
        .data
        or []
    )
    if not pers:
        raise HTTPException(401, "Nom ou clé incorrects")
    ids = [p["id_personnel"] for p in pers]
    acces = (
        supabase.table("acces_utilisateur")
        .select("id_personnel,role")
        .in_("id_personnel", ids)
        .eq("role", role)
        .execute()
        .data
        or []
    )
    if not acces:
        raise HTTPException(401, "Nom ou clé incorrects")
    p = next(x for x in pers if x["id_personnel"] == acces[0]["id_personnel"])
    return {"ok": True, "nom": p["nom"], "role": role, "matricule": p["matricule"]}


@app.get("/admin/personnel", dependencies=[Depends(verifier)])
def liste_personnel():
    data = (
        supabase.table("personnel")
        .select("matricule,nom,prenom,profession,type_personnel,email,numero")
        .order("nom")
        .execute()
        .data
        or []
    )
    return {"ok": True, "personnel": data}


@app.get("/admin/pointages", dependencies=[Depends(verifier)])
def liste_pointages():
    data = (
        supabase.table("pointage")
        .select("horodatage,type,score_confiance,id_personnel")
        .order("horodatage", desc=True)
        .limit(300)
        .execute()
        .data
        or []
    )
    ids = list({row["id_personnel"] for row in data if row.get("id_personnel")})
    fiches = {}
    if ids:
        pers = (
            supabase.table("personnel")
            .select("id_personnel,nom,prenom,matricule")
            .in_("id_personnel", ids)
            .execute()
            .data
            or []
        )
        fiches = {p["id_personnel"]: p for p in pers}

    pointages = []
    for row in data:
        f = fiches.get(row.get("id_personnel"), {})
        pointages.append({
            "horodatage": row.get("horodatage"),
            "type": row.get("type"),
            "score": row.get("score_confiance"),
            "nom": f.get("nom", "?"),
            "prenom": f.get("prenom", ""),
            "matricule": f.get("matricule", ""),
        })

    aujourd_hui = datetime.now(timezone.utc).date().isoformat()
    dernier = {}
    for row in reversed(data):
        h = row.get("horodatage") or ""
        if not str(h).startswith(aujourd_hui):
            continue
        dernier[row["id_personnel"]] = row
    presents = []
    for id_p, row in dernier.items():
        if row.get("type") != "entree":
            continue
        f = fiches.get(id_p, {})
        presents.append({
            "nom": f.get("nom", "?"),
            "prenom": f.get("prenom", ""),
            "matricule": f.get("matricule", ""),
        })

    return {"ok": True, "pointages": pointages, "presents": presents}


# ---------------------- POINTAGE ----------------------

@app.get("/agent/{matricule}", dependencies=[Depends(verifier)])
def infos_agent(matricule: str):
    if not MATRICULE_RE.match(matricule):
        raise HTTPException(400, "Carte non reconnue")
    res = (
        supabase.table("personnel")
        .select("matricule,nom,prenom,profession")
        .eq("matricule", matricule)
        .execute()
        .data
    )
    if not res:
        raise HTTPException(404, "Carte non reconnue")
    return res[0]


@app.post("/pointer", dependencies=[Depends(verifier)])
async def pointer(matricule: str = Form(...), capture: UploadFile = File(...)):
    if not MATRICULE_RE.match(matricule):
        raise HTTPException(400, "Carte non reconnue")

    res = (
        supabase.table("personnel")
        .select("id_personnel,prenom,photo1_url")
        .eq("matricule", matricule)
        .execute()
        .data
    )
    if not res:
        raise HTTPException(404, "Carte non reconnue")
    p = res[0]

    emb = (
        supabase.table("embedding_facial")
        .select("vecteur")
        .eq("id_personnel", p["id_personnel"])
        .execute()
        .data
    )
    if not emb:
        raise HTTPException(404, "Aucun visage enregistré pour cet agent")

    ref = emb[0]["vecteur"]
    if isinstance(ref, str):
        ref = json.loads(ref)
    ref = np.array(ref, dtype=np.float32)
    ref = ref / np.linalg.norm(ref)

    img_cap = lire_image(await capture.read())
    v = vecteur(img_cap, "la capture")
    score = float(np.dot(ref, v))
    if score < SEUIL:
        raise HTTPException(403, "Visage non reconnu : pointage refusé")

    chemin = p.get("photo1_url")
    if chemin and Path(chemin).exists():
        grok = avis_grok(Image.open(chemin).convert("RGB"), img_cap)
        if grok and grok.get("meme_personne") is False:
            raise HTTPException(403, "Visage non reconnu : pointage refusé")

    dernier = (
        supabase.table("pointage")
        .select("horodatage,type")
        .eq("id_personnel", p["id_personnel"])
        .order("horodatage", desc=True)
        .limit(1)
        .execute()
        .data
    )
    type_p = "entree"
    if dernier:
        h = datetime.fromisoformat(dernier[0]["horodatage"].replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - h
        if age < timedelta(seconds=60):
            raise HTTPException(429, "Pointage déjà enregistré à l'instant")
        if dernier[0]["type"] == "entree" and age < timedelta(hours=16):
            type_p = "sortie"

    supabase.table("pointage").insert({
        "id_personnel": p["id_personnel"],
        "type": type_p,
        "score_confiance": round(score, 3),
    }).execute()

    return {"ok": True, "type": type_p, "prenom": p["prenom"], "score": round(score, 3)}



# ======================= ESPACE RH =======================
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from datetime import date as _date
from zoneinfo import ZoneInfo

from pydantic import BaseModel

RH_TZ = ZoneInfo(os.getenv("TZ_ECOLE", "Africa/Casablanca"))
RH_TOLERANCE = 20  # prévu 9h00 : à l'heure jusqu'à 9h20
RH_LIMITE = 120    # de 9h21 à 11h00 : en retard ; après 11h00 : absent
RH_DEPART_MARGE = 15  # départ anticipé = sortie avant (heure de fin - 15 min), soit 16h45 pour 17h00
RH_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
RH_TYPES = {
    "conge": "En congé",
    "suspension": "Suspendu",
    "maladie": "Arrêt maladie",
    "mission": "En mission à l'extérieur",
    "autre": "Absence autorisée",
    "depart_autorise": "Départ anticipé autorisé",
}
RH_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def _rh_norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Za-z0-9]", "", s).upper()


def _rh_min(hhmm: str) -> int:
    h, m = hhmm[:5].split(":")
    return int(h) * 60 + int(m)


def _rh_hhmm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _rh_fr(d: str) -> str:
    return "/".join(reversed(str(d)[:10].split("-")))


def _rh_local(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(RH_TZ)


def _rh_horaire(h):
    if not h:
        return {"heure_debut": "09:00", "heure_fin": "17:00", "jours": RH_JOURS[:5]}
    return {
        "heure_debut": str(h["heure_debut"])[:5],
        "heure_fin": str(h["heure_fin"])[:5],
        "jours": h.get("jours") or RH_JOURS[:5],
    }


def _rh_evaluer(debut: int, arrivee, maintenant_min):
    """arrivee = minute d'arrivée (None si pas de pointage).
    maintenant_min = minute actuelle si on évalue aujourd'hui, sinon None."""
    if arrivee is not None:
        ecart = arrivee - debut
        if ecart <= RH_TOLERANCE:
            return "ok", ecart
        if ecart <= RH_LIMITE:
            return "retard", ecart
        return "absent", ecart
    if maintenant_min is not None:
        if maintenant_min <= debut + RH_TOLERANCE:
            return "attendu", None
        if maintenant_min <= debut + RH_LIMITE:
            return "retard", None
    return "absent", None


def _rh_permanents():
    return (
        supabase.table("personnel")
        .select("id_personnel,nom,prenom,profession,matricule")
        .eq("type_personnel", "permanent")
        .like("matricule", "EIGSI-%")
        .order("nom")
        .execute()
        .data
        or []
    )


@app.get("/rh/identifier", dependencies=[Depends(verifier)])
def rh_identifier(nom: str):
    cible = _rh_norm(nom)
    if not cible:
        raise HTTPException(404, "Introuvable")
    lignes = supabase.table("acces_utilisateur").select("role, personnel(id_personnel,nom,prenom)").execute().data or []
    for l in lignes:
        p = l.get("personnel")
        if isinstance(p, list):
            p = p[0] if p else None
        if not p:
            continue
        prenom = p.get("prenom") or ""
        candidats = {_rh_norm(p["nom"]), _rh_norm(p["nom"] + prenom), _rh_norm(prenom + p["nom"])}
        if cible in candidats:
            return {"id": p["id_personnel"], "nom": p["nom"], "prenom": prenom, "role": l["role"]}
    raise HTTPException(404, "Introuvable")


@app.get("/rh/donnees", dependencies=[Depends(verifier)])
def rh_donnees():
    pers = _rh_permanents()
    ids = [p["id_personnel"] for p in pers]
    aujourdhui = datetime.now(RH_TZ).date().isoformat()
    horaires, absences = {}, []
    if ids:
        for h in supabase.table("horaire_permanent").select("*").in_("id_personnel", ids).execute().data or []:
            horaires[h["id_personnel"]] = h
        absences = (
            supabase.table("absence_permanent").select("*").in_("id_personnel", ids)
            .gte("date_fin", aujourdhui).order("date_debut").execute().data or []
        )
    agents = []
    for p in pers:
        agents.append({
            **p,
            "horaire": _rh_horaire(horaires.get(p["id_personnel"])),
            "absences": [a for a in absences if a["id_personnel"] == p["id_personnel"]],
        })
    return {"agents": agents}


class RhHoraireIn(BaseModel):
    id_personnel: str
    heure_debut: str
    heure_fin: str
    jours: list[str]


@app.post("/rh/horaire", dependencies=[Depends(verifier)])
def rh_horaire(d: RhHoraireIn):
    if not RH_HHMM.match(d.heure_debut) or not RH_HHMM.match(d.heure_fin):
        raise HTTPException(400, "Heure invalide")
    if _rh_min(d.heure_debut) >= _rh_min(d.heure_fin):
        raise HTTPException(400, "L'heure de départ doit être après l'heure d'arrivée")
    jours = [j for j in RH_JOURS if j in d.jours]
    if not jours:
        raise HTTPException(400, "Choisis au moins un jour de travail")
    supabase.table("horaire_permanent").upsert({
        "id_personnel": d.id_personnel,
        "heure_debut": d.heure_debut,
        "heure_fin": d.heure_fin,
        "jours": jours,
        "maj": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="id_personnel").execute()
    return {"ok": True}


class RhAbsenceIn(BaseModel):
    id_personnel: str
    type: str
    date_debut: str
    date_fin: str
    motif: str | None = None


@app.post("/rh/absence", dependencies=[Depends(verifier)])
def rh_absence(d: RhAbsenceIn):
    if d.type not in RH_TYPES:
        raise HTTPException(400, "Type d'absence invalide")
    try:
        debut, fin = _date.fromisoformat(d.date_debut), _date.fromisoformat(d.date_fin)
    except ValueError:
        raise HTTPException(400, "Date invalide")
    if fin < debut:
        raise HTTPException(400, "La date de fin doit être après la date de début")
    ligne = supabase.table("absence_permanent").insert({
        "id_personnel": d.id_personnel,
        "type": d.type,
        "date_debut": d.date_debut,
        "date_fin": d.date_fin,
        "motif": (d.motif or "").strip() or None,
    }).execute().data[0]
    return {"ok": True, "id_absence": ligne["id_absence"]}


@app.delete("/rh/absence/{id_absence}", dependencies=[Depends(verifier)])
def rh_absence_supprimer(id_absence: str):
    supabase.table("absence_permanent").delete().eq("id_absence", id_absence).execute()
    return {"ok": True}


def _rh_depart_info(hr, mes, depart_ok):
    """Départ anticipé = le dernier pointage du jour est une sortie avant (heure de fin - marge), sans autorisation."""
    limite_min = _rh_min(hr["heure_fin"]) - RH_DEPART_MARGE
    limite = _rh_hhmm(limite_min)
    if depart_ok or not mes or mes[-1]["type"] != "sortie":
        return False, None, limite
    ls = _rh_local(mes[-1]["horodatage"])
    return (ls.hour * 60 + ls.minute) < limite_min, ls.strftime("%H:%M"), limite


@app.get("/rh/presence", dependencies=[Depends(verifier)])
def rh_presence():
    maintenant = datetime.now(RH_TZ)
    auj = maintenant.date()
    jour = RH_JOURS[auj.weekday()]
    min_now = maintenant.hour * 60 + maintenant.minute
    pers = _rh_permanents()
    ids = [p["id_personnel"] for p in pers]
    lignes = []
    if ids:
        horaires = {
            h["id_personnel"]: h
            for h in supabase.table("horaire_permanent").select("*").in_("id_personnel", ids).execute().data or []
        }
        absences = (
            supabase.table("absence_permanent").select("*").in_("id_personnel", ids)
            .lte("date_debut", auj.isoformat()).gte("date_fin", auj.isoformat()).execute().data or []
        )
        depuis = (datetime.now(timezone.utc) - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
        pts = (
            supabase.table("pointage").select("id_personnel,horodatage,type").in_("id_personnel", ids)
            .gte("horodatage", depuis).order("horodatage").execute().data or []
        )
        for p in pers:
            pid = p["id_personnel"]
            hr = _rh_horaire(horaires.get(pid))
            debut = _rh_min(hr["heure_debut"])
            limite = _rh_hhmm(debut + RH_LIMITE)
            abs_agent = [a for a in absences if a["id_personnel"] == pid]
            ab = next((a for a in abs_agent if a["type"] != "depart_autorise"), None)
            depart_ok = any(a["type"] == "depart_autorise" for a in abs_agent)
            anticipe, commentaire = False, None
            if ab:
                statut = "autorise"
                detail = f"{RH_TYPES.get(ab['type'], 'Absence autorisée')} jusqu'au {_rh_fr(ab['date_fin'])}"
            elif jour not in hr["jours"]:
                statut = "repos"
                detail = f"Ne travaille pas le {jour}"
            else:
                mes = [x for x in pts if x["id_personnel"] == pid and _rh_local(x["horodatage"]).date() == auj]
                entree = next((x for x in mes if x["type"] == "entree"), None)
                arrivee = None
                if entree:
                    le = _rh_local(entree["horodatage"])
                    arrivee = le.hour * 60 + le.minute
                suite = ""
                if mes and mes[-1]["type"] == "sortie":
                    suite = f" · Parti à {_rh_local(mes[-1]['horodatage']).strftime('%H:%M')}"
                statut, ecart = _rh_evaluer(debut, arrivee, min_now)
                if statut == "ok":
                    detail = f"Arrivé à {_rh_hhmm(arrivee)} (prévu {hr['heure_debut']}){suite}"
                elif statut == "retard":
                    if arrivee is not None:
                        detail = f"Arrivé à {_rh_hhmm(arrivee)} : {ecart} min de retard (prévu {hr['heure_debut']}){suite}"
                    else:
                        detail = f"Pas encore arrivé : {min_now - debut} min de retard (limite {limite})"
                elif statut == "absent":
                    if arrivee is not None:
                        detail = f"Arrivé à {_rh_hhmm(arrivee)}, après la limite de {limite} : compté absent{suite}"
                    else:
                        detail = f"N'a pas pointé : attendu à {hr['heure_debut']}, limite {limite}"
                else:
                    detail = f"Attendu à {hr['heure_debut']} (à l'heure jusqu'à {_rh_hhmm(debut + RH_TOLERANCE)})"
                if statut in ("ok", "retard"):
                    anticipe, h_sortie, lim = _rh_depart_info(hr, mes, depart_ok)
                    if anticipe:
                        commentaire = f"⚠️ Parti à {h_sortie}, avant {lim} (fin prévue {hr['heure_fin']}), sans autorisation"
            lignes.append({
                "id": pid,
                "nom": p["nom"],
                "prenom": p.get("prenom"),
                "profession": p.get("profession"),
                "statut": statut,
                "detail": detail,
                "depart_anticipe": anticipe,
                "commentaire": commentaire,
            })
    return {"date": auj.isoformat(), "maintenant": maintenant.strftime("%H:%M"), "lignes": lignes}


@app.get("/rh/historique/{id_agent}/{annee}/{mois}", dependencies=[Depends(verifier)])
def rh_historique(id_agent: str, annee: int, mois: int):
    if annee < 2020 or annee > 2100 or mois < 0 or mois > 12:
        raise HTTPException(400, "Période invalide")
    perso = (
        supabase.table("personnel").select("id_personnel,date_creation")
        .eq("id_personnel", id_agent).execute().data
    )
    if not perso:
        raise HTTPException(404, "Agent introuvable")
    cree = _rh_local(perso[0]["date_creation"]).date() if perso[0].get("date_creation") else _date(2000, 1, 1)

    debut_p = _date(annee, mois or 1, 1)
    fin_p = _date(annee, 12, 31) if mois in (0, 12) else _date(annee, mois + 1, 1) - timedelta(days=1)

    h = supabase.table("horaire_permanent").select("*").eq("id_personnel", id_agent).execute().data
    hr = _rh_horaire(h[0] if h else None)
    debut = _rh_min(hr["heure_debut"])
    limite = _rh_hhmm(debut + RH_LIMITE)

    absences = (
        supabase.table("absence_permanent").select("*").eq("id_personnel", id_agent)
        .lte("date_debut", fin_p.isoformat()).gte("date_fin", debut_p.isoformat())
        .execute().data or []
    )
    depuis = (datetime.combine(debut_p, datetime.min.time()) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    jusqua = (datetime.combine(fin_p, datetime.min.time()) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    pts = (
        supabase.table("pointage").select("horodatage,type").eq("id_personnel", id_agent)
        .gte("horodatage", depuis).lt("horodatage", jusqua).order("horodatage").limit(5000)
        .execute().data or []
    )
    par_jour = {}
    for x in pts:
        par_jour.setdefault(_rh_local(x["horodatage"]).date(), []).append(x)

    maintenant = datetime.now(RH_TZ)
    auj = maintenant.date()
    min_now = maintenant.hour * 60 + maintenant.minute

    jours = []
    d = debut_p
    while d <= fin_p:
        iso = d.isoformat()
        nom_jour = RH_JOURS[d.weekday()]
        anticipe = False
        if d > auj:
            statut, detail = "futur", ""
        elif d < cree:
            statut, detail = "avant", "Pas encore enregistré"
        else:
            ab = next(
                (x for x in absences if x["date_debut"] <= iso <= x["date_fin"] and x["type"] != "depart_autorise"),
                None,
            )
            depart_ok = any(
                x["type"] == "depart_autorise" and x["date_debut"] <= iso <= x["date_fin"] for x in absences
            )
            if ab:
                statut = "autorise"
                detail = RH_TYPES.get(ab["type"], "Absence autorisée") + (f" ({ab['motif']})" if ab.get("motif") else "")
            elif nom_jour not in hr["jours"]:
                statut, detail = "repos", f"Jour de repos ({nom_jour})"
            else:
                mes = par_jour.get(d, [])
                entree = next((x for x in mes if x["type"] == "entree"), None)
                arrivee = None
                if entree:
                    le = _rh_local(entree["horodatage"])
                    arrivee = le.hour * 60 + le.minute
                statut, ecart = _rh_evaluer(debut, arrivee, min_now if d == auj else None)
                if statut == "ok":
                    detail = f"Arrivé à {_rh_hhmm(arrivee)} (prévu {hr['heure_debut']})"
                elif statut == "retard":
                    if arrivee is not None:
                        detail = f"Arrivé à {_rh_hhmm(arrivee)} : {ecart} min de retard (prévu {hr['heure_debut']})"
                    else:
                        detail = f"Pas encore arrivé : {min_now - debut} min de retard (limite {limite})"
                elif statut == "absent":
                    if arrivee is not None:
                        detail = f"Arrivé à {_rh_hhmm(arrivee)}, après la limite de {limite} : compté absent"
                    else:
                        detail = f"N'a pas pointé (prévu {hr['heure_debut']})"
                else:
                    detail = "Pas encore attendu"
                if statut in ("ok", "retard"):
                    anticipe, h_sortie, lim = _rh_depart_info(hr, mes, depart_ok)
                    if anticipe:
                        detail += f" · ⚠️ Parti à {h_sortie}, avant {lim}, sans autorisation"
        jours.append({"date": iso, "statut": statut, "detail": detail, "depart_anticipe": anticipe})
        d += timedelta(days=1)
    return {"jours": jours, "horaire": hr}

# ======================= MESSAGES ENTRE SERVICES =======================
MSG_GROUPES = {"RH", "Scolarite", "Paie", "DirectionGenerale"}


class MsgIn(BaseModel):
    destinataire: str
    sujet: str | None = None
    contenu: str


class MsgLuIn(BaseModel):
    ids: list[str]


def _msg_moi(x_admin_id: str, x_admin_role: str):
    if not UUID_RE.match(x_admin_id or "") or x_admin_role not in MSG_GROUPES:
        raise HTTPException(401, "Non autorisé")
    return x_admin_id, x_admin_role


@app.post("/messages/envoyer", dependencies=[Depends(verifier)])
def msg_envoyer(d: MsgIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    moi, role = _msg_moi(x_admin_id, x_admin_role)
    if d.destinataire != "Tous" and d.destinataire not in MSG_GROUPES:
        raise HTTPException(400, "Destinataire invalide")
    if d.destinataire == role:
        raise HTTPException(400, "Choisis un autre service")
    contenu = (d.contenu or "").strip()
    if not contenu:
        raise HTTPException(400, "Le message est vide")
    if len(contenu) > 2000:
        raise HTTPException(400, "Message trop long (2000 caractères maximum)")
    sujet = (d.sujet or "").strip()[:120] or None
    nom = "Administrateur"
    p = supabase.table("personnel").select("nom,prenom").eq("id_personnel", moi).execute().data
    if p:
        pre = p[0].get("prenom") or ""
        nom = (pre + " " if pre and pre != "-" else "") + p[0]["nom"]
    supabase.table("message_admin").insert({
        "id_expediteur": moi,
        "expediteur_role": role,
        "expediteur_nom": nom,
        "destinataire": d.destinataire,
        "sujet": sujet,
        "contenu": contenu,
    }).execute()
    return {"ok": True}


@app.get("/messages/recus", dependencies=[Depends(verifier)])
def msg_recus(x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    moi, role = _msg_moi(x_admin_id, x_admin_role)
    msgs = (
        supabase.table("message_admin").select("*")
        .or_(f"destinataire.eq.{role},destinataire.eq.Tous")
        .order("cree_le", desc=True).limit(100).execute().data or []
    )
    msgs = [m for m in msgs if not (m["destinataire"] == "Tous" and m["expediteur_role"] == role)]
    ids = [m["id_message"] for m in msgs]
    lus = set()
    if ids:
        for l in supabase.table("message_lu").select("id_message").eq("id_admin", moi).in_("id_message", ids).execute().data or []:
            lus.add(l["id_message"])
    for m in msgs:
        m["lu"] = m["id_message"] in lus
    return {"messages": msgs[:50], "non_lus": sum(1 for m in msgs if not m["lu"])}


@app.get("/messages/envoyes", dependencies=[Depends(verifier)])
def msg_envoyes(x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    moi, role = _msg_moi(x_admin_id, x_admin_role)
    msgs = (
        supabase.table("message_admin").select("*").eq("expediteur_role", role)
        .order("cree_le", desc=True).limit(50).execute().data or []
    )
    return {"messages": msgs}


@app.post("/messages/lu", dependencies=[Depends(verifier)])
def msg_lu(d: MsgLuIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    moi, role = _msg_moi(x_admin_id, x_admin_role)
    ids = [i for i in d.ids if UUID_RE.match(i)][:100]
    if ids:
        supabase.table("message_lu").upsert(
            [{"id_message": i, "id_admin": moi} for i in ids],
            on_conflict="id_message,id_admin",
        ).execute()
    return {"ok": True}

# ======================= SCOLARITE =======================
SC_PROMOS = {26, 27, 28, 29, 30}
SC_GROUPES = {"TD": {"A", "B"}, "TP": {"A1", "A2", "B1", "B2"}}
SC_SALLES_NIVEAUX = [
    ("Rez-de-chaussée", ["Amphi RDC"]),
    ("Niveau 1", ["Labo Génie électrique", "Labo Fablab", "Labo Automatique", "Labo Fluide",
                  "Labo Thermodynamique", "Labo Optique", "Labo Informatique"]),
    ("Niveau 2", ["Amphi 2e", "Salle 23", "Salle 22", "Salle 27"]),
    ("Niveau 3", ["Amphi 3e", "Salle IA", "Salle 33", "Salle 32"]),
    ("Niveau 4", ["Salle 43"]),
    ("Niveau 5", ["Amphi 5e"]),
]
SC_SALLES = {s for _, liste in SC_SALLES_NIVEAUX for s in liste}


def _sc_creneaux(dt):
    j = dt.weekday()  # 0 = lundi ... 6 = dimanche
    if j == 6:
        return []
    if j in (2, 5):  # mercredi et samedi : on s'arrête à 12h
        return [("09:00", "10:30"), ("10:45", "12:00")]
    if j == 4:  # vendredi : l'après-midi commence à 14h
        return [("09:00", "10:30"), ("10:45", "12:15"), ("14:00", "15:30"), ("15:45", "17:15")]
    return [("09:00", "10:30"), ("10:45", "12:15"), ("13:30", "15:00"), ("15:15", "16:45")]


def _sc_sous_groupes(type_s, groupe):
    if type_s == "C":
        return {"A1", "A2", "B1", "B2"}
    if type_s == "TD":
        return {"A1", "A2"} if groupe == "A" else {"B1", "B2"}
    return {groupe}


def _sc_debut_dt(d, hhmm):
    jour = _date.fromisoformat(d) if isinstance(d, str) else d
    return datetime.combine(jour, datetime.strptime(hhmm[:5], "%H:%M").time(), tzinfo=RH_TZ)


def _sc_verifier(id_vac, d, debut, promo, type_s, groupe, salle, exclure=None, futur_strict=False):
    try:
        dt = _date.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, "Date invalide")
    cr = next((c for c in _sc_creneaux(dt) if c[0] == debut), None)
    if cr is None:
        raise HTTPException(400, "Ce créneau n'existe pas ce jour-là (pas de cours le dimanche, matinée seulement le mercredi et le samedi)")
    maintenant = datetime.now(RH_TZ)
    if dt < maintenant.date():
        raise HTTPException(400, "Cette date est passée")
    if futur_strict and _sc_debut_dt(d, debut) <= maintenant:
        raise HTTPException(400, "Ce créneau est déjà commencé : choisis un créneau à venir")
    if salle not in SC_SALLES:
        raise HTTPException(400, "Salle inconnue")
    memes = (
        supabase.table("emploi_du_temps")
        .select("id_edt,id_vacataire,salle,promo,type_seance,groupe,matiere")
        .eq("date_seance", d).eq("heure_debut", debut).execute().data or []
    )
    sg = _sc_sous_groupes(type_s, groupe)
    for s in memes:
        if exclure and s["id_edt"] == exclure:
            continue
        if s["id_vacataire"] == id_vac:
            raise HTTPException(409, f"Ce professeur a déjà une séance à ce créneau ({s['matiere']}, {s['salle']})")
        if s["salle"] == salle:
            raise HTTPException(409, f"La salle « {salle} » est déjà réservée à ce créneau ({s['matiere']})")
        if s["promo"] == promo and (sg & _sc_sous_groupes(s["type_seance"], s["groupe"])):
            raise HTTPException(409, f"La promo {promo} a déjà une séance à ce créneau ({s['matiere']}, {s['salle']})")
    return dt, cr[1]


def _sc_ecrire(action):
    try:
        return action()
    except HTTPException:
        raise
    except Exception as e:
        if "duplicate" in str(e).lower() or "23505" in str(e):
            raise HTTPException(409, "Conflit : ce créneau vient d'être pris (professeur ou salle déjà occupé)")
        raise


def _sc_charger(id_edt):
    if not UUID_RE.match(id_edt):
        raise HTTPException(400, "Identifiant invalide")
    r = supabase.table("emploi_du_temps").select("*").eq("id_edt", id_edt).execute().data
    if not r or not r[0].get("date_seance"):
        raise HTTPException(404, "Séance introuvable")
    return r[0]


def _sc_modifiable(s):
    if _sc_debut_dt(s["date_seance"], str(s["heure_debut"])[:5]) <= datetime.now(RH_TZ):
        raise HTTPException(400, "Cette séance est déjà commencée ou passée : elle ne peut plus être modifiée")


class ScSeanceIn(BaseModel):
    id_vacataire: str
    date: str
    debut: str
    promo: int
    matiere: str
    type_seance: str
    num_seance: int
    total_seances: int
    groupe: str | None = None
    salle: str


class ScReprogIn(BaseModel):
    date: str
    debut: str
    salle: str


@app.get("/scolarite/vacataires", dependencies=[Depends(verifier)])
def sc_vacataires():
    lignes = (
        supabase.table("personnel").select("id_personnel,nom,prenom,profession,matricule")
        .eq("type_personnel", "vacataire").like("matricule", "EIGSI-%").order("nom").execute().data or []
    )
    return {"vacataires": lignes}


@app.get("/scolarite/jour/{d}", dependencies=[Depends(verifier)])
def sc_jour(d: str):
    try:
        dt = _date.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, "Date invalide")
    cr = _sc_creneaux(dt)
    seances = (
        supabase.table("emploi_du_temps")
        .select("id_edt,id_vacataire,heure_debut,heure_fin,salle,promo,type_seance,groupe,matiere")
        .eq("date_seance", d).execute().data or []
    )
    for s in seances:
        s["heure_debut"] = str(s["heure_debut"])[:5]
        s["heure_fin"] = str(s["heure_fin"])[:5]
    return {
        "creneaux": [{"debut": a, "fin": b} for a, b in cr],
        "seances": seances,
        "salles": [{"niveau": n, "salles": s} for n, s in SC_SALLES_NIVEAUX],
        "ferme": len(cr) == 0,
    }


@app.post("/scolarite/seance", dependencies=[Depends(verifier)])
def sc_creer(d: ScSeanceIn):
    if not UUID_RE.match(d.id_vacataire):
        raise HTTPException(400, "Professeur invalide")
    if not supabase.table("vacataire").select("id_personnel").eq("id_personnel", d.id_vacataire).execute().data:
        raise HTTPException(404, "Professeur introuvable")
    matiere = (d.matiere or "").strip()
    if not matiere or len(matiere) > 80:
        raise HTTPException(400, "Le nom du module est obligatoire (80 caractères maximum)")
    if d.promo not in SC_PROMOS:
        raise HTTPException(400, "Promo invalide (26 à 30)")
    if d.type_seance not in ("C", "TD", "TP"):
        raise HTTPException(400, "Type de séance invalide")
    if not (1 <= d.num_seance <= d.total_seances <= 99):
        raise HTTPException(400, "Numéro de séance invalide (exemple : 3/10)")
    groupe = None if d.type_seance == "C" else d.groupe
    if d.type_seance != "C" and groupe not in SC_GROUPES[d.type_seance]:
        raise HTTPException(400, "Choisis le groupe")
    dt, fin = _sc_verifier(d.id_vacataire, d.date, d.debut, d.promo, d.type_seance, groupe, d.salle)
    ligne = _sc_ecrire(lambda: supabase.table("emploi_du_temps").insert({
        "id_vacataire": d.id_vacataire,
        "jour": RH_JOURS[dt.weekday()],
        "heure_debut": d.debut,
        "heure_fin": fin,
        "matiere": matiere,
        "salle": d.salle,
        "date_seance": d.date,
        "promo": d.promo,
        "type_seance": d.type_seance,
        "num_seance": d.num_seance,
        "total_seances": d.total_seances,
        "groupe": groupe,
    }).execute().data[0])
    return {"ok": True, "id_edt": ligne["id_edt"]}


@app.put("/scolarite/seance/{id_edt}", dependencies=[Depends(verifier)])
def sc_reprogrammer(id_edt: str, d: ScReprogIn):
    s = _sc_charger(id_edt)
    _sc_modifiable(s)
    dt, fin = _sc_verifier(s["id_vacataire"], d.date, d.debut, s["promo"], s["type_seance"], s["groupe"],
                           d.salle, exclure=id_edt, futur_strict=True)
    _sc_ecrire(lambda: supabase.table("emploi_du_temps").update({
        "date_seance": d.date,
        "jour": RH_JOURS[dt.weekday()],
        "heure_debut": d.debut,
        "heure_fin": fin,
        "salle": d.salle,
        "maj": datetime.now(timezone.utc).isoformat(),
    }).eq("id_edt", id_edt).execute())
    return {"ok": True}


@app.delete("/scolarite/seance/{id_edt}", dependencies=[Depends(verifier)])
def sc_annuler(id_edt: str):
    s = _sc_charger(id_edt)
    _sc_modifiable(s)
    supabase.table("emploi_du_temps").delete().eq("id_edt", id_edt).execute()
    return {"ok": True}


@app.get("/scolarite/programme/{id_vac}", dependencies=[Depends(verifier)])
def sc_programme(id_vac: str):
    if not UUID_RE.match(id_vac):
        raise HTTPException(400, "Professeur invalide")
    maintenant = datetime.now(RH_TZ)
    depuis = (maintenant.date() - timedelta(days=120)).isoformat()
    seances = (
        supabase.table("emploi_du_temps").select("*").eq("id_vacataire", id_vac)
        .gte("date_seance", depuis).order("date_seance").order("heure_debut").limit(1000).execute().data or []
    )
    depuis_pts = (datetime.now(timezone.utc) - timedelta(days=125)).strftime("%Y-%m-%dT%H:%M:%SZ")
    pts = (
        supabase.table("pointage").select("horodatage").eq("id_personnel", id_vac)
        .gte("horodatage", depuis_pts).limit(5000).execute().data or []
    )
    demi = set()
    for p in pts:
        l = _rh_local(p["horodatage"])
        demi.add((l.date().isoformat(), "matin" if l.hour * 60 + l.minute < 13 * 60 else "apres-midi"))
    sortie = []
    for s in seances:
        d = s["date_seance"]
        debut = str(s["heure_debut"])[:5]
        fin = str(s["heure_fin"])[:5]
        moment = "matin" if _rh_min(debut) < 12 * 60 + 30 else "apres-midi"
        pointe = (d, moment) in demi
        if _sc_debut_dt(d, fin) <= maintenant:
            statut = "assure" if pointe else "non_assure"
        else:
            statut = "a_venir"
        sortie.append({
            "id_edt": s["id_edt"],
            "date_seance": d,
            "heure_debut": debut,
            "heure_fin": fin,
            "salle": s["salle"],
            "promo": s["promo"],
            "type_seance": s["type_seance"],
            "num_seance": s.get("num_seance"),
            "total_seances": s.get("total_seances"),
            "groupe": s.get("groupe"),
            "matiere": s["matiere"],
            "statut": statut,
            "pointe": pointe,
            "modifiable": _sc_debut_dt(d, debut) > maintenant,
        })
    return {"seances": sortie}

# ======================= PAIE =======================
PA_TARIF = float(os.getenv("TARIF_SEANCE_DH", "400"))
PA_CYCLE_JOURS = 14
PA_ROLES = {"Paie", "DirectionGenerale"}


def _pa_moi(x_admin_id: str, x_admin_role: str) -> str:
    if not UUID_RE.match(x_admin_id or "") or x_admin_role not in PA_ROLES:
        raise HTTPException(401, "Non autorisé")
    p = supabase.table("personnel").select("nom,prenom").eq("id_personnel", x_admin_id).execute().data
    if not p:
        return "Administrateur"
    pre = p[0].get("prenom") or ""
    return (pre + " " if pre and pre != "-" else "") + p[0]["nom"]


def _pa_mois_liste():
    auj = datetime.now(RH_TZ).date()
    y, m = auj.year, auj.month
    out = []
    for _ in range(12):
        out.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _pa_salaire(id_p: str):
    r = supabase.table("permanent").select("salaire_mensuel").eq("id_personnel", id_p).execute().data
    if r and r[0].get("salaire_mensuel") is not None:
        return float(r[0]["salaire_mensuel"])
    return None


def _pa_perm_ctrl(id_p: str, mois: str):
    if not UUID_RE.match(id_p or ""):
        raise HTTPException(400, "Agent invalide")
    if mois not in _pa_mois_liste():
        raise HTTPException(400, "Mois invalide")
    r = (
        supabase.table("personnel").select("id_personnel").eq("id_personnel", id_p)
        .eq("type_personnel", "permanent").like("matricule", "EIGSI-%").execute().data
    )
    if not r:
        raise HTTPException(404, "Agent permanent introuvable")


def _pa_existant(id_p: str, mois: str):
    r = supabase.table("paie_permanent").select("*").eq("id_personnel", id_p).eq("mois", mois).execute().data
    return r[0] if r else None


class PaSalaireIn(BaseModel):
    id_personnel: str
    montant: float


class PaMoisIn(BaseModel):
    id_personnel: str
    mois: str
    motif: str | None = None


class PaMoisSeul(BaseModel):
    mois: str


class PaVacIn(BaseModel):
    nb_seances: int


@app.get("/paie/permanents", dependencies=[Depends(verifier)])
def pa_permanents(mois: str = "", x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _pa_moi(x_admin_id, x_admin_role)
    dispo = _pa_mois_liste()
    mois = mois or dispo[0]
    if mois not in dispo:
        raise HTTPException(400, "Mois invalide")
    pers = _rh_permanents()
    ids = [p["id_personnel"] for p in pers]
    sal, paies = {}, {}
    if ids:
        for r in supabase.table("permanent").select("id_personnel,salaire_mensuel").in_("id_personnel", ids).execute().data or []:
            sal[r["id_personnel"]] = r.get("salaire_mensuel")
        for r in supabase.table("paie_permanent").select("*").eq("mois", mois).in_("id_personnel", ids).execute().data or []:
            paies[r["id_personnel"]] = r
    lignes = []
    for p in pers:
        pid = p["id_personnel"]
        s = sal.get(pid)
        pa = paies.get(pid)
        lignes.append({
            **p,
            "salaire": float(s) if s is not None else None,
            "statut": pa["statut"] if pa else "valide",
            "motif": pa.get("motif") if pa else None,
            "paye_le": pa.get("paye_le") if pa else None,
            "montant": float(pa["montant"]) if pa and pa.get("montant") is not None else None,
        })
    return {"mois": mois, "mois_disponibles": dispo, "lignes": lignes}


@app.post("/paie/salaire", dependencies=[Depends(verifier)])
def pa_salaire(d: PaSalaireIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _pa_moi(x_admin_id, x_admin_role)
    if not UUID_RE.match(d.id_personnel or ""):
        raise HTTPException(400, "Agent invalide")
    if d.montant < 0 or d.montant > 1_000_000:
        raise HTTPException(400, "Montant invalide")
    supabase.table("permanent").update({"salaire_mensuel": d.montant}).eq("id_personnel", d.id_personnel).execute()
    return {"ok": True}


@app.post("/paie/permanent/payer", dependencies=[Depends(verifier)])
def pa_perm_payer(d: PaMoisIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    nom = _pa_moi(x_admin_id, x_admin_role)
    _pa_perm_ctrl(d.id_personnel, d.mois)
    ex = _pa_existant(d.id_personnel, d.mois)
    if ex and ex["statut"] == "paye":
        raise HTTPException(409, "Ce salaire est déjà payé")
    if ex and ex["statut"] == "suspendu":
        raise HTTPException(400, "Salaire suspendu : lève d'abord la suspension")
    sal = _pa_salaire(d.id_personnel)
    if not sal or sal <= 0:
        raise HTTPException(400, "Définis d'abord le salaire mensuel de cet agent")
    supabase.table("paie_permanent").upsert({
        "id_personnel": d.id_personnel,
        "mois": d.mois,
        "statut": "paye",
        "montant": sal,
        "motif": None,
        "paye_le": datetime.now(timezone.utc).isoformat(),
        "par_nom": nom,
        "maj": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="id_personnel,mois").execute()
    return {"ok": True, "montant": sal}


@app.post("/paie/permanent/suspendre", dependencies=[Depends(verifier)])
def pa_perm_suspendre(d: PaMoisIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    nom = _pa_moi(x_admin_id, x_admin_role)
    _pa_perm_ctrl(d.id_personnel, d.mois)
    ex = _pa_existant(d.id_personnel, d.mois)
    if ex and ex["statut"] == "paye":
        raise HTTPException(409, "Ce salaire est déjà payé : impossible de le suspendre")
    supabase.table("paie_permanent").upsert({
        "id_personnel": d.id_personnel,
        "mois": d.mois,
        "statut": "suspendu",
        "montant": None,
        "motif": (d.motif or "").strip()[:200] or None,
        "paye_le": None,
        "par_nom": nom,
        "maj": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="id_personnel,mois").execute()
    return {"ok": True}


@app.post("/paie/permanent/reactiver", dependencies=[Depends(verifier)])
def pa_perm_reactiver(d: PaMoisIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _pa_moi(x_admin_id, x_admin_role)
    _pa_perm_ctrl(d.id_personnel, d.mois)
    ex = _pa_existant(d.id_personnel, d.mois)
    if not ex or ex["statut"] != "suspendu":
        raise HTTPException(400, "Ce salaire n'est pas suspendu")
    supabase.table("paie_permanent").delete().eq("id_paie", ex["id_paie"]).execute()
    return {"ok": True}


@app.post("/paie/permanents/payer-tous", dependencies=[Depends(verifier)])
def pa_payer_tous(d: PaMoisSeul, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    nom = _pa_moi(x_admin_id, x_admin_role)
    if d.mois not in _pa_mois_liste():
        raise HTTPException(400, "Mois invalide")
    pers = _rh_permanents()
    ids = [p["id_personnel"] for p in pers]
    if not ids:
        return {"ok": True, "payes": 0, "sans_salaire": 0}
    deja = {
        r["id_personnel"]
        for r in supabase.table("paie_permanent").select("id_personnel").eq("mois", d.mois).in_("id_personnel", ids).execute().data or []
    }
    sal = {
        r["id_personnel"]: r.get("salaire_mensuel")
        for r in supabase.table("permanent").select("id_personnel,salaire_mensuel").in_("id_personnel", ids).execute().data or []
    }
    maintenant = datetime.now(timezone.utc).isoformat()
    rows, sans_salaire = [], 0
    for pid in ids:
        if pid in deja:
            continue
        s = sal.get(pid)
        if s is None or float(s) <= 0:
            sans_salaire += 1
            continue
        rows.append({
            "id_personnel": pid, "mois": d.mois, "statut": "paye", "montant": float(s),
            "motif": None, "paye_le": maintenant, "par_nom": nom, "maj": maintenant,
        })
    if rows:
        supabase.table("paie_permanent").upsert(rows, on_conflict="id_personnel,mois").execute()
    return {"ok": True, "payes": len(rows), "sans_salaire": sans_salaire}


def _pa_seances_dues(id_vac: str):
    """Séances passées ET assurées (le professeur a pointé dans la demi-journée) et pas encore payées."""
    maintenant = datetime.now(RH_TZ)
    auj = maintenant.date()
    seances = (
        supabase.table("emploi_du_temps")
        .select("id_edt,date_seance,heure_debut,heure_fin,matiere,promo,type_seance,num_seance,total_seances,groupe")
        .eq("id_vacataire", id_vac)
        .gte("date_seance", (auj - timedelta(days=400)).isoformat())
        .lte("date_seance", auj.isoformat())
        .order("date_seance").order("heure_debut").limit(1000).execute().data or []
    )
    payes = {
        r["id_edt"]
        for r in supabase.table("paie_vacataire_seance").select("id_edt").eq("id_vacataire", id_vac).limit(5000).execute().data or []
    }
    a_payer = [s for s in seances if s["id_edt"] not in payes]
    if not a_payer:
        return []
    depuis = (_date.fromisoformat(a_payer[0]["date_seance"]) - timedelta(days=2)).isoformat()
    pts = (
        supabase.table("pointage").select("horodatage").eq("id_personnel", id_vac)
        .gte("horodatage", depuis).limit(5000).execute().data or []
    )
    demi = set()
    for p in pts:
        l = _rh_local(p["horodatage"])
        demi.add((l.date().isoformat(), "matin" if l.hour * 60 + l.minute < 13 * 60 else "apres-midi"))
    res = []
    for s in a_payer:
        debut = str(s["heure_debut"])[:5]
        fin = str(s["heure_fin"])[:5]
        fin_dt = datetime.combine(_date.fromisoformat(s["date_seance"]), datetime.strptime(fin, "%H:%M").time(), tzinfo=RH_TZ)
        if fin_dt > maintenant:
            continue
        moment = "matin" if _rh_min(debut) < 12 * 60 + 30 else "apres-midi"
        if (s["date_seance"], moment) in demi:
            res.append({**s, "heure_debut": debut, "heure_fin": fin})
    return res


def _pa_info(id_vac: str):
    seances = _pa_seances_dues(id_vac)
    dernier = (
        supabase.table("paie_vacataire").select("paye_le,nb_seances,montant,par_nom")
        .eq("id_vacataire", id_vac).order("paye_le", desc=True).limit(1).execute().data or []
    )
    auj = datetime.now(RH_TZ).date()
    if dernier:
        ref = _rh_local(dernier[0]["paye_le"]).date()
    elif seances:
        ref = _date.fromisoformat(seances[0]["date_seance"])
    else:
        ref = None
    prochaine = ref + timedelta(days=PA_CYCLE_JOURS) if ref else None
    return {
        "seances": seances,
        "nb": len(seances),
        "montant": len(seances) * PA_TARIF,
        "dernier_paiement": dernier[0] if dernier else None,
        "prochaine": prochaine.isoformat() if prochaine else None,
        "due": bool(seances) and prochaine is not None and auj >= prochaine,
    }


@app.get("/paie/vacataires", dependencies=[Depends(verifier)])
def pa_vacataires(x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _pa_moi(x_admin_id, x_admin_role)
    pers = (
        supabase.table("personnel").select("id_personnel,nom,prenom,profession,matricule")
        .eq("type_personnel", "vacataire").like("matricule", "EIGSI-%").order("nom").execute().data or []
    )
    lignes = []
    for p in pers:
        i = _pa_info(p["id_personnel"])
        lignes.append({
            **p,
            "nb": i["nb"],
            "montant": i["montant"],
            "due": i["due"],
            "prochaine": i["prochaine"],
            "dernier_paiement": i["dernier_paiement"],
        })
    return {"tarif": PA_TARIF, "lignes": lignes, "total": sum(l["montant"] for l in lignes)}


@app.get("/paie/vacataire/{id_vac}", dependencies=[Depends(verifier)])
def pa_vac_detail(id_vac: str, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _pa_moi(x_admin_id, x_admin_role)
    if not UUID_RE.match(id_vac):
        raise HTTPException(400, "Professeur invalide")
    i = _pa_info(id_vac)
    hist = (
        supabase.table("paie_vacataire").select("paye_le,nb_seances,montant,par_nom")
        .eq("id_vacataire", id_vac).order("paye_le", desc=True).limit(30).execute().data or []
    )
    return {
        "tarif": PA_TARIF,
        "nb": i["nb"],
        "montant": i["montant"],
        "seances": i["seances"],
        "historique": hist,
        "prochaine": i["prochaine"],
        "due": i["due"],
    }


@app.post("/paie/vacataire/{id_vac}/payer", dependencies=[Depends(verifier)])
def pa_vac_payer(id_vac: str, d: PaVacIn, x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    nom = _pa_moi(x_admin_id, x_admin_role)
    if not UUID_RE.match(id_vac):
        raise HTTPException(400, "Professeur invalide")
    i = _pa_info(id_vac)
    if i["nb"] == 0:
        raise HTTPException(400, "Rien à payer : le compteur est à 0")
    if i["nb"] != d.nb_seances:
        raise HTTPException(409, f"Le solde a changé ({i['nb']} séance(s) maintenant) : actualise puis réessaie")
    montant = i["nb"] * PA_TARIF
    paiement = supabase.table("paie_vacataire").insert({
        "id_vacataire": id_vac,
        "nb_seances": i["nb"],
        "tarif": PA_TARIF,
        "montant": montant,
        "par_nom": nom,
    }).execute().data[0]
    try:
        supabase.table("paie_vacataire_seance").insert([
            {"id_edt": s["id_edt"], "id_paiement": paiement["id_paiement"], "id_vacataire": id_vac}
            for s in i["seances"]
        ]).execute()
    except Exception as e:
        supabase.table("paie_vacataire").delete().eq("id_paiement", paiement["id_paiement"]).execute()
        if "duplicate" in str(e).lower() or "23505" in str(e):
            raise HTTPException(409, "Ces séances viennent d'être payées : actualise")
        raise
    return {"ok": True, "nb": i["nb"], "montant": montant}

# ======================= DIRECTION =======================
def _dg_controle(x_admin_id: str, x_admin_role: str):
    if not UUID_RE.match(x_admin_id or "") or x_admin_role != "DirectionGenerale":
        raise HTTPException(401, "Non autorisé")


def _dg_nom(p) -> str:
    if not p:
        return "—"
    pre = p.get("prenom") or ""
    return (pre + " " if pre and pre != "-" else "") + (p.get("nom") or "")


@app.get("/direction/synthese", dependencies=[Depends(verifier)])
def dg_synthese(x_admin_id: str = Header(default=""), x_admin_role: str = Header(default="")):
    _dg_controle(x_admin_id, x_admin_role)
    maintenant = datetime.now(RH_TZ)
    auj = maintenant.date().isoformat()

    # --- Présence du personnel permanent
    lignes = rh_presence()["lignes"]

    def nb(s):
        return sum(1 for l in lignes if l["statut"] == s)

    presence = {
        "ok": nb("ok"),
        "retard": nb("retard"),
        "absent": nb("absent"),
        "attendu": nb("attendu"),
        "autorise": nb("autorise"),
        "repos": nb("repos"),
        "departs_anticipes": sum(1 for l in lignes if l.get("depart_anticipe")),
        "total": len(lignes),
        "alertes": [
            {
                "nom": l["nom"],
                "prenom": l.get("prenom"),
                "statut": l["statut"],
                "detail": l["detail"],
                "commentaire": l.get("commentaire"),
            }
            for l in lignes
            if l["statut"] in ("retard", "absent") or l.get("depart_anticipe")
        ][:20],
    }

    # --- Séances du jour (Scolarité)
    seances = (
        supabase.table("emploi_du_temps")
        .select("id_edt,id_vacataire,heure_debut,heure_fin,matiere,salle")
        .eq("date_seance", auj).order("heure_debut").execute().data or []
    )
    ids_vac = list({s["id_vacataire"] for s in seances})
    noms, demi = {}, set()
    if ids_vac:
        for p in supabase.table("personnel").select("id_personnel,nom,prenom").in_("id_personnel", ids_vac).execute().data or []:
            noms[p["id_personnel"]] = p
        depuis = (datetime.now(timezone.utc) - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for x in (
            supabase.table("pointage").select("id_personnel,horodatage").in_("id_personnel", ids_vac)
            .gte("horodatage", depuis).limit(5000).execute().data or []
        ):
            l = _rh_local(x["horodatage"])
            if l.date().isoformat() == auj:
                demi.add((x["id_personnel"], "matin" if l.hour * 60 + l.minute < 13 * 60 else "apres-midi"))
    assurees, non_assurees, a_venir, non_liste = 0, 0, 0, []
    for s in seances:
        debut = str(s["heure_debut"])[:5]
        fin = str(s["heure_fin"])[:5]
        moment = "matin" if _rh_min(debut) < 12 * 60 + 30 else "apres-midi"
        if _sc_debut_dt(auj, fin) > maintenant:
            a_venir += 1
        elif (s["id_vacataire"], moment) in demi:
            assurees += 1
        else:
            non_assurees += 1
            non_liste.append({
                "prof": _dg_nom(noms.get(s["id_vacataire"])),
                "matiere": s["matiere"],
                "debut": debut,
                "fin": fin,
                "salle": s["salle"],
            })
    scolarite = {
        "total": len(seances),
        "assurees": assurees,
        "non_assurees": non_assurees,
        "a_venir": a_venir,
        "non_assurees_liste": non_liste[:20],
    }

    # --- Effectifs
    nb_perm = len(_rh_permanents())
    nb_vac = len(
        supabase.table("personnel").select("id_personnel")
        .eq("type_personnel", "vacataire").like("matricule", "EIGSI-%").execute().data or []
    )

    # --- Administrateurs
    admins = []
    for a in supabase.table("acces_utilisateur").select("role, personnel(nom,prenom)").execute().data or []:
        p = a.get("personnel")
        if isinstance(p, list):
            p = p[0] if p else None
        admins.append({"nom": _dg_nom(p), "role": a["role"]})
    admins.sort(key=lambda x: (x["role"], x["nom"]))

    return {
        "date": auj,
        "maintenant": maintenant.strftime("%H:%M"),
        "effectifs": {"permanents": nb_perm, "vacataires": nb_vac},
        "presence": presence,
        "scolarite": scolarite,
        "admins": admins,
    }
import io
import re
import unicodedata
from pathlib import Path

import pillow_heif
import qrcode
from PIL import Image, ImageOps
from reportlab.lib.colors import Color, black, white
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

pillow_heif.register_heif_opener()

RACINE = Path(__file__).resolve().parent.parent
LOGOS = RACINE / "public" / "images" / "logos"
DOSSIER_CARTES = RACINE / "cartes"
W, H = 85.6 * mm, 54 * mm
BLEU = Color(0.04, 0.33, 0.62)


def _slug(texte: str) -> str:
    texte = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", texte).strip("-")


def _photo(chemin: str) -> ImageReader:
    img = ImageOps.exif_transpose(Image.open(chemin)).convert("RGB")
    img = ImageOps.fit(img, (400, 500))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    buf.seek(0)
    return ImageReader(buf)


def _qr(contenu: str) -> ImageReader:
    buf = io.BytesIO()
    qrcode.make(contenu, box_size=10, border=1).save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def _ligne(c, x, y, texte, max_w, taille=6.5, police="Helvetica-Bold"):
    while stringWidth(texte, police, taille) > max_w and taille > 4.5:
        taille -= 0.25
    c.setFont(police, taille)
    c.drawString(x, y, texte)


def generer_carte(agent: dict, photo_path: str) -> Path:
    DOSSIER_CARTES.mkdir(exist_ok=True)
    nom_fichier = f"{_slug(agent['nom'].upper())}_{_slug(agent['prenom'])}.pdf"
    chemin = DOSSIER_CARTES / nom_fichier
    if chemin.exists():
        chemin = DOSSIER_CARTES / f"{chemin.stem}_{agent['matricule']}.pdf"

    c = canvas.Canvas(str(chemin), pagesize=(W, H))

    # ---------- RECTO ----------
    c.setFillColor(white)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Logo 1 en filigrane
    c.saveState()
    c.setFillAlpha(0.12)
    c.drawImage(ImageReader(str(LOGOS / "logo1.jpeg")), 8 * mm, 4 * mm,
                width=44 * mm, height=30 * mm, preserveAspectRatio=True, anchor="c")
    c.restoreState()

    # Bandeau bleu
    c.setFillColor(BLEU)
    c.rect(0, H - 10 * mm, W, 10 * mm, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(W / 2, H - 4.2 * mm, "EIGSI ÉCOLE D'INGÉNIEUR")
    c.setFont("Helvetica-Bold", 6)
    c.drawCentredString(W / 2, H - 8 * mm, "CARTE PROFESSIONNELLE D'IDENTITÉ")

    # Champs en noir
    c.setFillColor(black)
    x, max_w, y, pas = 4 * mm, W - 4 * mm - 29 * mm, 38.5 * mm, 5 * mm
    champs = [
        f"MATRICULE : {agent['matricule']}",
        f"NOM : {agent['nom'].upper()}",
        f"PRÉNOM : {agent['prenom']}",
        f"PROFESSION : {agent['profession']}",
        f"STATUT : {agent['statut']}",
        f"CONTACT : {agent['contact']}",
    ]
    for ligne in champs:
        _ligne(c, x, y, ligne, max_w)
        y -= pas
    _ligne(c, x, 4 * mm, f"ANNÉE : {agent['annee']}", max_w)

    # Photo et QR
    c.drawImage(_photo(photo_path), W - 25 * mm, 17 * mm, width=21 * mm, height=26 * mm)
    c.setStrokeColor(black)
    c.setLineWidth(0.4)
    c.rect(W - 25 * mm, 17 * mm, 21 * mm, 26 * mm, fill=0, stroke=1)
    c.drawImage(_qr(agent["matricule"]), W - 24 * mm, 2 * mm, width=14 * mm, height=14 * mm)
    c.showPage()

    # ---------- VERSO ----------
    c.setFillColor(white)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.drawImage(ImageReader(str(LOGOS / "logo2.jpeg")), 4 * mm, H - 17 * mm,
                width=24 * mm, height=13 * mm, preserveAspectRatio=True, anchor="nw")
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(W / 2, 26 * mm, "EIGSI CASABLANCA")
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 20 * mm, "282 Route de l'Oasis, Casablanca")
    c.drawCentredString(W / 2, 14 * mm, "www.eigsica.ma")
    c.save()
    return chemin

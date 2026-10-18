import os
from carte import generer_carte, RACINE

agent = {
    "matricule": "EIGSI-000001",
    "nom": "DUPONT",
    "prenom": "Jean",
    "profession": "Technicien informatique",
    "statut": "Permanent",
    "contact": "+212 6 00 00 00 00",
    "annee": "2026-2027",
}
photo = RACINE / "public" / "images" / "fonds" / "fond-1.jpeg"
chemin = generer_carte(agent, str(photo))
print("Carte créée :", chemin)
os.startfile(chemin)


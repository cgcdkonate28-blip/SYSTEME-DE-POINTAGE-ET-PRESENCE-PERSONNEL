# Pointage et presence du personnel - EIGSI

Pointage du personnel par carte QR et reconnaissance faciale, avec espaces RH, Scolarite, Paie et Direction.

## Architecture
- Site : Next.js (App Router), React, TypeScript, Tailwind. Interfaces et filtrage de l acces (cookies de session signes).
- Service IA (dossier registration-service) : Python, FastAPI. Reconnaissance faciale (InsightFace), matricules, cartes PDF (qrcode, ReportLab), logique metier.
- Base de donnees : Supabase (PostgreSQL + pgvector).

Trajet d une requete : navigateur, route Next.js (session), service Python (jeton interne), Supabase.

## Installation
1. Creer le projet Supabase, activer l extension vector et creer les tables.
2. Copier .env.example en .env.local, et registration-service/.env.example en registration-service/.env, puis remplir les valeurs.
3. Site : npm install puis npm run dev (port 3000).
4. Service Python : dans le dossier registration-service, creer un environnement virtuel, installer requirements.txt, puis lancer : uvicorn main:app --reload --port 8000

## Limites connues
Pas de detection de vivacite, seuil de similarite a calibrer, photos stockees en local, pas de HTTPS en local, cles de groupe partagees par service.

## Demonstration video

[![Demonstration du MVP : pointage par QR code et reconnaissance faciale](https://img.youtube.com/vi/UDCsO2Agd3Q/hqdefault.jpg)](https://www.youtube.com/watch?v=UDCsO2Agd3Q)

Lien de la video : https://www.youtube.com/watch?v=UDCsO2Agd3Q

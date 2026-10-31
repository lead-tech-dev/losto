# Losto · Proche Santé

Plateforme de suivi des maladies chroniques (diabète, hypertension, cholestérol, asthme, thyroïde, suivi des seniors) pour des parents vivant à Douala et Yaoundé, payée par leur famille en diaspora.

Le parent n'installe rien : il est suivi par WhatsApp et par téléphone. La famille, les médecins, les pharmacies, les livreurs et l'équipe ont chacun leur espace web.

## Architecture

```
apps/
  api/   API NestJS + Drizzle ORM + PostgreSQL
  web/   Appli React (Vite) : famille, partenaires, admin
docker-compose.yml   PostgreSQL 16 + Redis 7 pour le développement
```

| Couche | Rôle |
|---|---|
| `apps/api/src/db/schema.ts` | Toutes les tables : comptes, profils partenaires, parents suivis, abonnements, consultations, ordonnances, livraisons, relevés, comptes rendus, journal des accès |
| `apps/api/drizzle/` | Migrations SQL générées à partir du schéma |
| `apps/api/src/auth/` | Inscription des familles, connexion (JWT), gardes de connexion et de rôle |
| `apps/api/src/users/` | Espace admin : création et vérification des comptes partenaires, activation / désactivation |
| `apps/api/src/audit/` | Journal de qui a fait quoi sur les données |

### Rôles

| Rôle | Qui | Comment le compte est créé |
|---|---|---|
| `FAMILY` | L'enfant en diaspora qui paie | Inscription libre sur le site |
| `DOCTOR` | Médecin inscrit à l'Ordre | Par l'admin, après vérification |
| `NURSE` | Infirmier(e) des visites à domicile | Par l'admin |
| `PHARMACY` | Pharmacie agréée | Par l'admin |
| `COURIER` | Livreur | Par l'admin |
| `ADMIN` | Équipe Proche Santé | Premier compte via `npm run db:seed`, les suivants par un admin |

Toutes les routes de l'API exigent une connexion, sauf celles marquées `@Public()`. Un compte désactivé perd l'accès immédiatement, même si son jeton n'a pas expiré.

## Démarrer en local

Prérequis : Node.js 20+ et Docker.

```bash
npm install
npm run db:up                         # lance PostgreSQL et Redis
cp apps/api/.env.example apps/api/.env  # puis remplace JWT_SECRET et le mot de passe admin
npm run db:migrate                    # crée les tables
npm run db:seed                       # crée le premier compte admin

npm run dev:api                       # API sur http://localhost:3000/api
npm run dev:web                       # appli sur http://localhost:5173
```

Connecte-toi avec l'e-mail et le mot de passe admin définis dans `.env`, puis crée les comptes partenaires depuis la page « Comptes ».

## Modifier le schéma

1. Modifie `apps/api/src/db/schema.ts`.
2. `npm run db:generate -w apps/api` génère la migration SQL dans `apps/api/drizzle/`.
3. `npm run db:migrate` l'applique.

## Tests

Les tests tournent contre une vraie base PostgreSQL. Utilise une base dédiée : elle est vidée à chaque lancement.

```bash
DATABASE_URL="postgresql://losto:losto@localhost:5432/losto_test" npm test
```

## Feuille de route

- [x] Module 1 : fondations (projet, schéma de données, comptes et rôles)
- [ ] Module 2 : espace famille (inscription du parent, formule, tableau de bord)
- [ ] Module 3 : paiements (carte via Stripe, Mobile Money)
- [ ] Module 4 : portail médecin et infirmier (agenda, téléconsultation, compte rendu, ordonnance)
- [ ] Module 5 : pharmacie et livraison
- [ ] Module 6 : WhatsApp (rappels, relevés, compte rendu mensuel, assistant)
- [ ] Module 7 : back-office et indicateurs
- [ ] Module 8 : mise en production

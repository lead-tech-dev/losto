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
| `apps/api/src/auth/` | Inscription des familles, connexion (JWT), mot de passe oublié, profil, gardes de connexion et de rôle |
| `apps/api/src/users/` | Espace admin : création et vérification des comptes partenaires, activation / désactivation |
| `apps/api/src/patients/` | Espace famille : parents suivis, formule, tableau de bord, relevés, historiques, partage avec les proches, consentement du parent |
| `apps/api/src/coverage/` | Quartiers desservis à Douala et Yaoundé |
| `apps/api/src/messages/` | Messagerie entre les familles et l'équipe |
| `apps/api/src/billing/` | Paiements : Mobile Money (Tranzak), carte (Stripe), relances, résiliation, médicaments, factures PDF |
| `apps/api/src/mail/` | Envoi d'e-mails (SMTP, ou console en développement) |
| `apps/api/src/audit/` | Journal de qui a fait quoi sur les données |

### Qui voit quoi dans l'espace famille

| | Titulaire (a inscrit le parent) | Proche invité | Autre famille |
|---|---|---|---|
| Suivi, relevés, consultations, ordonnances | Oui | Oui | Non (réponse « introuvable ») |
| Modifier le dossier, changer la formule | Oui | Non | Non |
| Inviter ou retirer un proche | Oui | Non (peut seulement partir) | Non |

Une invitation n'est valable que pour l'adresse e-mail invitée, 7 jours, une seule fois. Le parent confirme lui-même son accord depuis un lien, sans compte.

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
npm run db:seed                       # crée le premier compte admin et une liste de départ de quartiers couverts

npm run dev:api                       # API sur http://localhost:3000/api
npm run dev:web                       # appli sur http://localhost:5173
```

Connecte-toi avec l'e-mail et le mot de passe admin définis dans `.env`, puis crée les comptes partenaires depuis la page « Comptes ».

## Paiements

| | Mobile Money (Tranzak) | Carte (Stripe) |
|---|---|---|
| Monnaie | FCFA (taux fixe 1 € = 655,957 FCFA, arrondi à la centaine) | Euros |
| Renouvellement | Un paiement par mois, validé sur le téléphone ; rappel 5 jours avant | Prélèvement automatique |
| Impayé | Relance à l'échéance et à J+3, suspension à J+7 (tâche quotidienne à 8 h, heure du Cameroun) | Relances Stripe, puis suspension |
| Changement de formule | Au prochain paiement | Immédiat, prorata calculé par Stripe |
| Résiliation | Le suivi continue jusqu'à la fin du mois payé | Idem |

Le premier paiement inclut l'inscription (30 €). Les médicaments sont payés à part, au prix de la pharmacie.

**Sécurité des notifications.** Stripe signe ses notifications : sans signature valide, rien n'est traité. Tranzak ne signe pas les siennes : l'API vérifie la clé `authKey` si elle est configurée, puis redemande toujours à Tranzak le vrai statut du paiement (montant et référence compris) avant d'activer quoi que ce soit. Une notification reçue deux fois ne facture jamais deux fois.

### Brancher les vrais comptes

1. **Tranzak** : sur le portail développeur, récupère l'App ID et la clé (`SAND_…` pour tester), et crée une notification de type `REQUEST.COMPLETED` vers `https://<ton-domaine>/api/webhooks/tranzak` avec une clé d'authentification. Renseigne `TRANZAK_APP_ID`, `TRANZAK_APP_KEY`, `TRANZAK_WEBHOOK_AUTH_KEY` ; passe `TRANZAK_ENV="production"` pour les vrais paiements.
2. **Stripe** : renseigne `STRIPE_SECRET_KEY`, crée un point de terminaison webhook vers `https://<ton-domaine>/api/webhooks/stripe` avec les événements `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, puis copie son secret dans `STRIPE_WEBHOOK_SECRET`. Active le portail client (Paramètres > Facturation) pour la mise à jour des cartes.
3. **Factures** : renseigne `INVOICE_ISSUER_NAME` et `INVOICE_ISSUER_DETAILS` avec l'entité qui encaisse.

Sans clés, le moyen de paiement correspondant est simplement masqué. Pour essayer sans compte Tranzak : `PAYMENTS_SIMULATION="true"` (paiement validé après 6 s, refusé si le numéro finit par 000 ; interdit en production).

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
- [x] Module 2 : espace famille (inscription du parent, formule, tableau de bord, partage, messagerie)
- [x] Module 3 : paiements (Mobile Money via Tranzak, carte via Stripe, relances, factures)
- [ ] Module 4 : portail médecin et infirmier (agenda, téléconsultation, compte rendu, ordonnance)
- [ ] Module 5 : pharmacie et livraison
- [ ] Module 6 : WhatsApp (rappels, relevés, compte rendu mensuel, assistant)
- [ ] Module 7 : back-office et indicateurs
- [ ] Module 8 : mise en production

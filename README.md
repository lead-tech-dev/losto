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
| `apps/api/src/care/` | Portail médecin et infirmier : disponibilités, affectation et planification automatiques, consultations, ordonnances, analyses, orientations, visites, relevés et alertes |
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
| `LAB` | Laboratoire d'analyses | Par l'admin |
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

## Soins

**Dès le paiement**, le parent reçoit automatiquement son équipe : le médecin, la pharmacie et (formule Sérénité) l'infirmier(e) de sa ville, vérifiés par l'admin, en choisissant celui qui suit le moins de parents. Le bilan de départ est placé dans le premier créneau libre du médecin, puis une consultation par mois payé (et une visite à domicile en Sérénité). Une tâche quotidienne (7 h, heure du Cameroun) rattrape ce qui n'a pas pu être planifié, par exemple faute de disponibilités.

**Cloisonnement** : un médecin ne voit que les parents qui lui sont affectés ; l'infirmier(e) ne voit que ce qu'il faut pour la visite (pas les antécédents ni les comptes rendus). Toute lecture de dossier est journalisée.

**Visio** : un lien Jitsi impossible à deviner par consultation (`VIDEO_BASE_URL`, par défaut `https://meet.jit.si`). Sur meet.jit.si, la personne qui ouvre la salle doit se connecter avec Google ou GitHub ; un serveur Jitsi hébergé par Proche Santé évite cette étape. Les parents sans smartphone sont appelés.

**Seuils d'alerte** (`apps/api/src/care/thresholds.ts`), valeurs de départ **à faire valider par le médecin référent** :

| Mesure | À surveiller | Urgent |
|---|---|---|
| Tension (mmHg) | ≥ 160 / ≥ 100 | ≥ 180 / ≥ 110, ou systolique < 90 |
| Glycémie (g/L) | < 0,70 ou > 2,50 | < 0,54 ou > 3,00 |

Une valeur urgente mesurée à domicile s'affiche avec la conduite à tenir sur le téléphone de l'infirmier(e) et part par e-mail au médecin. Les valeurs impossibles (diastolique supérieure à la systolique, glycémie saisie en mg/dL) sont refusées.

## Pharmacie, laboratoire et livraison

**Ordonnance** : la pharmacie du parent chiffre l'ordonnance au prix pharmacie (avec une note éventuelle : générique, conditionnement). La famille valide et paie (Mobile Money ou carte), la pharmacie prépare puis marque la commande « prête ». Un livreur vérifié de la ville est affecté automatiquement (le moins chargé). Si la pharmacie ne peut pas servir, elle indique pourquoi : le médecin et la famille sont prévenus. Le prix ne peut plus changer pendant qu'un paiement est en cours.

**Livraison contre code** : chaque livraison a un code à 4 chiffres, visible par la famille seulement (onglet Ordonnances) et jamais par le livreur. Le livreur le demande au parent pour confirmer la remise. Après 5 codes faux, la livraison est bloquée ; la route est aussi limitée à 10 essais par minute. Un échec (« personne au domicile ») est signalé à la famille, puis le livreur repasse.

**Analyses** : quand le médecin demande des analyses (et chaque trimestre en Sérénité, bilan automatique), le laboratoire du parent fixe la prise de sang (au labo ou à domicile, en heure du Cameroun), la note comme faite, puis saisit les résultats en signalant les valeurs hors normes (alerte au médecin). **La famille ne voit les résultats qu'après lecture du médecin**, avec son commentaire en termes simples.

Une tâche quotidienne (7 h 30, heure du Cameroun) affecte les livraisons et les analyses restées sans livreur ou sans laboratoire.

## WhatsApp

Le parent n'installe rien : tout passe par WhatsApp, via l'**API Cloud de Meta** (sans intermédiaire). Chaque message, reçu ou envoyé, est enregistré (`whatsapp_messages`).

**Ce que le parent peut écrire**

| Message | Effet |
|---|---|
| `13/8`, `135/85`, `tension 14 9` | Tension enregistrée (13/8 = 130/80 mmHg), alerte au médecin et à la famille si elle dépasse les seuils |
| `glycémie 1,2`, `sucre 120` | Glycémie en g/L (120 mg/dL converti) ; unité demandée si ambiguë |
| `poids 72` | Poids |
| `OK` | Prise de médicaments confirmée (comptée dans le compte rendu) |
| `OUI` | Consentement au suivi |
| `STOP` / `REPRENDRE` | Arrêt / reprise des messages automatiques (le code de livraison part quand même) |
| `rendez-vous`, `livraison` | Réponse automatique avec le prochain rendez-vous ou l'état de la livraison |
| Malaise, douleur à la poitrine, chute… | Consigne d'appeler le **119**, alerte urgente, famille, médecin et équipe prévenus |
| Question de santé | Jamais de réponse automatique : transmise au médecin, qui répond depuis le dossier |
| Autre question, message vocal | Transmis à l'équipe (ou à l'assistant si `ANTHROPIC_API_KEY` est renseignée, pour les seules questions pratiques) |

Deux parents sur le même numéro : le message commence par le prénom (« Paul 13/8 »).

**Envois automatiques** (tâche toutes les 5 minutes) : bienvenue à l'inscription, rappel de médicaments aux heures cochées par le médecin (ou devinées depuis la posologie : « matin et soir » → 8 h et 20 h), regroupés par moment ; rappel de rendez-vous la veille à 18 h et 2 h avant, avec le lien vidéo ; code de livraison au parent. Chaque rappel a une clé unique : jamais envoyé deux fois.

**Famille** : chaque notification par e-mail part aussi sur WhatsApp (désactivable dans le profil).

**Fenêtre de 24 h** : WhatsApp n'autorise un texte libre que dans les 24 h qui suivent le dernier message du destinataire ; sinon il faut un modèle validé par Meta. L'application choisit seule. Les 5 modèles à faire valider sont dans `apps/api/src/whatsapp/templates.ts` (et affichés dans l'espace admin, page WhatsApp).

**Comptes rendus mensuels** : le 1er du mois à 6 h, un brouillon par parent (consultations, moyennes des relevés, alertes, prises confirmées, livraisons, analyses, prochain rendez-vous). L'équipe le relit et l'envoie ; la famille ne voit rien avant.

**Brancher Meta** : créer l'application et le numéro dans le gestionnaire WhatsApp, renseigner les variables `WHATSAPP_*` (voir `.env.example`), déclarer le webhook `https://<api>/api/webhooks/whatsapp` (abonnement `messages`) avec `WHATSAPP_VERIFY_TOKEN`, puis soumettre les modèles. En développement, `WHATSAPP_SIMULATION=true` : rien ne part et un simulateur dans l'espace admin permet d'écrire « comme un parent ».

**Données personnelles** : les messages des parents sont des données de santé. L'assistant (facultatif) envoie le texte des questions non médicales à l'API d'Anthropic : à couvrir dans la politique de confidentialité (module 8).

## Modifier le schéma

1. Modifie `apps/api/src/db/schema.ts`.
2. `npm run db:generate -w apps/api` génère la migration SQL dans `apps/api/drizzle/`.
3. `npm run db:migrate` l'applique.

## Tests

Les tests tournent contre une vraie base PostgreSQL. Utilise une base dédiée : elle est vidée à chaque lancement, et les tests refusent de tourner sur une base dont le nom ne contient pas « test ».

```bash
DATABASE_URL="postgresql://losto:losto@localhost:5432/losto_test" npm test
```

## Feuille de route

- [x] Module 1 : fondations (projet, schéma de données, comptes et rôles)
- [x] Module 2 : espace famille (inscription du parent, formule, tableau de bord, partage, messagerie)
- [x] Module 3 : paiements (Mobile Money via Tranzak, carte via Stripe, relances, factures)
- [x] Module 4 : portail médecin et infirmier (agenda, téléconsultation, compte rendu, ordonnance, visites, alertes)
- [x] Module 5 : pharmacie, laboratoire et livraison (prix, paiement, préparation, livraison contre code, prises de sang, résultats relus par le médecin)
- [x] Module 6 : WhatsApp (relevés par message, urgences, rappels, code de livraison, comptes rendus mensuels, assistant)
- [ ] Module 7 : back-office et indicateurs
- [ ] Module 8 : mise en production

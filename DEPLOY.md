# Mise en ligne gratuite (phase de test)

Même principe que Lemaket : tout est gratuit tant que le test dure, et le passage sur un VPS (IONOS) se fera sans toucher au code.

```
 Familles (France)      Partenaires (Cameroun)
          \                    /
           ▼                  ▼
   ┌──────────────────────────────────┐
   │ Vercel — le site (React)         │  proche-sante.vercel.app
   │ /api/* est relayé vers Render ───┼──┐
   └──────────────────────────────────┘  │
                                         ▼
   ┌──────────────────────────────────┐     ┌───────────────────────────┐
   │ Render — l'API NestJS (Francfort)│ ◄── │ Tranzak, Meta (WhatsApp)  │
   │ migrations + admin au démarrage  │     │ notifications directes    │
   └──────────────┬───────────────────┘     └───────────────────────────┘
                  ▼
   ┌──────────────────────────────────┐     ┌───────────────────────────┐
   │ Neon — PostgreSQL (Francfort)    │     │ GitHub Actions            │
   │ chiffré, restauration récente    │     │ ping toutes les 10 min    │
   └──────────────────────────────────┘     │ → l'API ne s'endort pas   │
                                            └───────────────────────────┘
```

| Service | Offre gratuite | Ce qu'il faut savoir |
|---|---|---|
| Neon | 1 Go, 100 h de calcul par mois | La base s'endort après 5 min sans requête. Les rappels WhatsApp ne la réveillent que de 6 h à 22 h (`REMINDERS_CRON`) pour rester sous les 100 h |
| Render | 750 h par mois, 512 Mo | Un seul service gratuit éveillé en permanence par compte (744 h). Démarrage de ~1 min après un nouveau déploiement |
| Vercel | Usage personnel | Le site et le relais `/api` |
| GitHub Actions | Gratuit | Le ping peut prendre quelques minutes de retard ; GitHub suspend les tâches planifiées après 60 jours sans commit |

## 1. Base de données : Neon

1. Créer un compte sur neon.com, puis un projet **proche-sante**, région **Europe (Frankfurt)**, Postgres 16.
2. Copier la chaîne de connexion **avec pooling** (`…-pooler…/neondb?sslmode=require`) : c'est `DATABASE_URL`.

## 2. API : Render

1. Sur render.com : **New → Blueprint**, choisir le dépôt `lead-tech-dev/losto`. Render lit `render.yaml`.
2. Renseigner les valeurs demandées :
   - `DATABASE_URL` : celle de Neon ;
   - `DATA_ENCRYPTION_KEY` : générée avec `openssl rand -base64 32`. **À recopier aussi dans un gestionnaire de mots de passe** : sans cette clé, antécédents, comptes rendus, résultats et messages chiffrés sont définitivement illisibles ;
   - `LEGAL_CONTACT_EMAIL`, `LEGAL_DPO_EMAIL`, `LEGAL_DIRECTOR`, `INVOICE_ISSUER_DETAILS` (« adresse | RCCM … | NIU … ») : affichés dans les mentions légales, la politique de confidentialité et les factures ;
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (12 caractères minimum) : le premier compte admin, créé au premier démarrage ;
   - `SMTP_*`, `MAIL_FROM` : un compte Brevo gratuit suffit (300 e-mails par jour) ;
   - `TRANZAK_*`, `WHATSAPP_*`, `INVOICE_ISSUER_DETAILS` : dès qu'ils sont disponibles (l'API démarre sans, et le signale dans ses journaux).
3. Au premier démarrage, les journaux affichent `Migrations appliquées`, `Admin créé`, puis la liste de ce qui manque encore (⚠). Une configuration dangereuse (simulation de paiement, secret faible, site en http) **bloque** le démarrage (✗).
4. Vérifier : `https://proche-sante-api.onrender.com/api/health` répond `{"status":"ok"}`.

Si le nom `proche-sante-api` est déjà pris chez Render, l'adresse change : la reporter dans `apps/web/vercel.json` et `.github/workflows/keep-alive.yml`.

## 3. Site : Vercel

1. Sur vercel.com : **Add New → Project**, dépôt `lead-tech-dev/losto`, **Root Directory : `apps/web`**. Le reste vient de `apps/web/vercel.json`.
2. Si l'adresse obtenue n'est pas `proche-sante.vercel.app`, mettre la bonne dans `WEB_ORIGIN` sur Render (liens des e-mails et WhatsApp).

## 4. Brancher les services externes

| Où | Quoi |
|---|---|
| Portail Tranzak | Notification `REQUEST.COMPLETED` → `https://proche-sante-api.onrender.com/api/webhooks/tranzak`, avec la clé `TRANZAK_WEBHOOK_AUTH_KEY` |
| Gestionnaire WhatsApp de Meta | Webhook → `https://proche-sante-api.onrender.com/api/webhooks/whatsapp`, jeton = `WHATSAPP_VERIFY_TOKEN` (généré par Render, visible dans Environment), abonnement `messages` ; soumettre les 5 modèles (page WhatsApp du back-office) |

## 5. Surveillance

- **Erreurs** : chaque erreur 500 est envoyée par e-mail aux comptes admin (une fois par heure et par type d'erreur). Avec `SENTRY_DSN` (sentry.io, offre gratuite), elles arrivent aussi dans Sentry, **sans corps de requête ni en-têtes** : aucune donnée de santé ne sort.
- **Disponibilité** : créer une sonde gratuite sur UptimeRobot (ou Better Stack) sur `https://proche-sante-api.onrender.com/api/health`, toutes les 5 minutes, alerte par e-mail et SMS. Cette adresse ne touche pas la base de données.

## 6. Après la mise en ligne

- Se connecter avec le compte admin, **changer son mot de passe**, puis supprimer `SEED_ADMIN_PASSWORD` sur Render.
- Créer les comptes des partenaires (médecin, pharmacie…) et vérifier leurs documents.
- Ajuster les quartiers couverts (back-office → Zones).

## Données de santé

Les données sont hébergées dans l'Union européenne (Francfort), chiffrées au repos et en transit, et les champs de santé (antécédents, traitements, comptes rendus, notes de visite, résultats d'analyses, orientations, messages WhatsApp) sont en plus chiffrés par l'application (AES-256-GCM, `DATA_ENCRYPTION_KEY`). Les ordonnances (liste de médicaments) et les relevés chiffrés (tension, glycémie) restent en clair pour les calculs et les courbes. La loi camerounaise n° 2024/017 n'impose pas de les garder au Cameroun mais demande des garanties pour tout transfert : la page de consentement du parent l'indique, et l'hébergement européen relève du RGPD. Déjà en place : consentement du parent, pages légales (`/cgu`, `/confidentialite`, `/mentions-legales`, CGU acceptées et datées à l'inscription), copie et effacement des données par la famille ou l'équipe, journal des accès. À faire hors code : tenir le registre des traitements, désigner le responsable des données (DPO), faire relire les pages légales par un juriste.

## Passage sur un VPS (IONOS)

Le même `apps/api/Dockerfile` tourne sur un VPS : Docker, PostgreSQL et un reverse proxy (Caddy, HTTPS automatique). On supprimera alors le workflow `keep-alive.yml` et `REMINDERS_CRON` (rappels toutes les 5 minutes, toute la journée).

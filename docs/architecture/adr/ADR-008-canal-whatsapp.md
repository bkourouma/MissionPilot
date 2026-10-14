# ADR-008 : Canal WhatsApp Business (interface, fournisseur simulé, consentement, données minimales, SMS en repli)

## Statut

Accepté par l'utilisateur le 2026-10-14 (mode SIMULÉ seulement : aucun fournisseur réel n'est branché ; les points non vérifiés
contre le vrai service sont listés « OUVERT » dans
[SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md), §17).

## Date

2026-10-11

## Contexte

Le PRD complémentaire demande WhatsApp comme canal client : relance J+10 d'un questionnaire sans
réponse (§8.2), questionnaires par lien WhatsApp (CLI-02), saisie et alertes de KPI par WhatsApp
avec confirmation et contrôle de vraisemblance (KPI-14), synthèse hebdomadaire du dirigeant
(CLI-07). Il range les canaux parmi les « adaptateurs remplaçables » (§17) et cite l'ADR-008 à
écrire avant développement. La décision métier du 2026-10-08 (`docs/DECISIONS.md`, « WhatsApp
Business ») : **canal officiel**, **données minimales dans les messages**, **SMS en repli**. Risque
nommé au PRD (§20) : coût, politique de Meta, données hors infrastructure.

Constats sur le code (vérifiés le 2026-10-11) :

- Le seul canal sortant est l'e-mail : l'interface `Mailer` et ses deux implémentations
  (`MailerJournal`, `MailerSmtp`) dans `apps/api/src/notifications/mailer.ts`, choisies par
  `creerMailer(config)` ; `notifier()` (`notifier.ts`) crée la notification interne ; les e-mails
  partent après validation de la transaction (`envoyerEmails`) ou par la file chiffrée
  `envoyer_email` (`file-email.ts`, `charge-email.ts`). Aucune notion de consentement : l'e-mail
  vient d'un compte déjà créé par invitation.
- Les relances de questionnaires J+3 et J+7 sont des jobs `relance_questionnaire` mis en file à
  l'envoi (`questionnaires/relances.ts`, `planifierRelances`) ; `PALIERS_SANS_REPONSE_JOURS =
  [3, 7, 10, 14]` existe dans `packages/engines/src/automatisation/detection.ts` et
  l'automatisation standard `questionnaire_sans_reponse_alerte` alerte déjà le chef de mission à
  J+10 : il manque seulement le message au client.
- La table `jobs` porte une clé d'unicité `(cabinet_id, cle)` (migration `0030`) : mise en file
  idempotente ; le worker passe à chaque handler le contexte `database` pour des transactions
  courtes séparées (`jobs/registre.ts`, `ContexteJob`).
- Aucune route publique ne reçoit d'appel d'un service externe (`SECURITY.md` §9 : « aucun
  webhook entrant ») ; la liste blanche des routes sans `exiger` compte 8 entrées
  (`review-checklist.md`, recherche n° 10).
- Les numéros de téléphone n'existent qu'en colonnes `telephone` libres (`contacts_client`,
  paramètres de facturation) ; ni vérification, ni chiffrement, ni lien avec un compte.
- La salle de mission et les relances de classe R0 vers le client respectent le coupe-circuit N4 du
  cabinet (`agents/autonomie.ts` `lireCoupeCircuit`, `salle-mission/relances.ts`).

**Règle ferme décidée par l'utilisateur** : tout ce qui touche un service externe = interfaces
(ports) + fournisseur simulé/local uniquement ; aucun envoi réel, aucune clé, aucun compte externe,
aucune donnée réelle de personnes ; chaque point non vérifié contre le vrai service est OUVERT ;
les choix juridiques ou de coût réel sont des valeurs provisoires marquées OUVERTES.

## Décision

1. **Deux ports TypeScript, définis dans `apps/api/src/canaux/ports.ts`** : `CanalWhatsApp` (envoi
   d'un gabarit, envoi d'une réponse de session, vérification d'un webhook entrant, téléchargement
   d'un média entrant) et `PasserelleSms` (envoi d'un SMS : le repli). Chaque port expose
   `fournisseur` et `mode` (`"simule"` aujourd'hui ; `"reel"` réservé). Un fournisseur réel est un
   futur adaptateur, introduit par un ADR de remplacement, sans toucher au reste.
2. **Seul fournisseur livré : `CanalWhatsAppSimule` et `PasserelleSmsSimulee`.** Ils n'ouvrent
   aucun réseau, n'ont aucune clé. Ils **refusent tout numéro hors de la plage de test réservée**
   (`+225` suivi de `00000000` et de deux chiffres) : aucune donnée réelle de personne ne peut
   entrer par ce chemin (400 `NUMERO_REEL_REFUSE_EN_SIMULE` à l'enregistrement, erreur du port à
   l'envoi). Les messages « envoyés » restent dans une boîte en mémoire (100 derniers, comme
   `MailerJournal`).
3. **Sélection par configuration** (`apps/api/src/config.ts`) : `WHATSAPP_FOURNISSEUR` et
   `SMS_FOURNISSEUR`, valeurs `aucun` (défaut, canal coupé) ou `simule`. **`simule` hors
   développement local (NODE_ENV et bases locales) fait refuser le démarrage**, sur le modèle de
   `verifierConnexionRapideDemo` : un fournisseur simulé n'est jamais présenté comme réel. Chaque
   ligne du journal d'envois porte `mode_fournisseur`, et l'interface affiche « Simulé : aucun envoi
   réel » partout où un envoi apparaît.
4. **Consentement explicite par destinataire ET par canal.** Aucun message n'est mis en file sans un
   consentement `accorde` courant (dernière ligne d'un historique en ajout seul), un numéro
   vérifié par code à usage unique, un compte de canal actif et un destinataire actif. Sources
   admises : `portail` (la personne elle-même), `recueilli_cabinet` (avec référence d'une preuve
   écrite). Le retrait est toujours possible et immédiat : écran du portail, action du cabinet, ou
   message entrant d'arrêt (STOP, ARRÊT…). Après un retrait par message, seule la personne peut
   redonner son accord (déclencheur SQL), jamais le cabinet à sa place. Le WhatsApp et le SMS ont
   chacun leur consentement.
5. **Données minimales dans les messages.** Les messages sortants sont les gabarits d'un catalogue
   fermé du moteur (`packages/engines/src/canaux`), dont les variables sont typées (code à six
   chiffres, nombre de 0 à 999, date, lien relatif du portail, nom du cabinet) : **aucun texte
   libre, aucun nom de personne, aucun titre de mission ou de questionnaire, aucun montant, aucun
   score** ne sort vers Meta. Tout détail se lit dans le portail, derrière l'authentification. Une
   exception assumée et OUVERTE : la réponse de confirmation d'une saisie de KPI reprend le libellé
   et la valeur que la personne vient d'envoyer.
6. **Journal d'envois sans contenu** (`canaux_envois`) : gabarit, destinataire (jamais le numéro),
   objet métier, statut, identifiant externe, code de refus, empreinte à clé du texte rendu,
   longueur. Le numéro vit chiffré (`AES-256-GCM`, clé HKDF dédiée) dans `canaux_destinataires`,
   avec une empreinte HMAC pour retrouver l'expéditeur d'un message entrant ; il n'est jamais
   renvoyé par l'API (seulement un masque « +225…12 »).
7. **Au plus un envoi par clé d'idempotence, jamais deux.** L'envoi se fait en deux phases
   (réservation validée, puis appel du port, puis résultat) sur la file `jobs` existante ; une
   issue inconnue (panne après l'appel, délai dépassé) passe l'envoi à `incertain` et n'est pas
   rejouée automatiquement : mieux vaut une relance manquée qu'un doublon chez un client.
8. **Webhook entrant : rejet par défaut.** Une seule route publique, `POST
   /api/canaux/whatsapp/webhook`, enregistrée seulement si `WHATSAPP_FOURNISSEUR` n'est pas `aucun`.
   Signature HMAC-SHA-256 du corps brut vérifiée avant tout (comparaison en temps constant),
   horodatage dans une fenêtre de 300 s, déduplication par identifiant d'événement
   (`canaux_evenements_recus`, unique par cabinet), compte résolu par une fonction `SECURITY
   DEFINER` étroite, plafond de débit par compte et plafond d'échecs de signature. Détail :
   SPEC-3c §8.
9. **Les messages entrants sont des données non fiables** (AGT-07). Aucun contenu entrant ne
   déclenche une action. Seules trois commandes d'un vocabulaire fermé sont reconnues par le code :
   l'arrêt (retire le consentement), la réponse OUI/NON à une proposition déjà en attente, et une
   saisie de KPI qui crée une **proposition** (jamais une mesure). Un numéro de téléphone n'est pas
   un moyen d'authentification pour écrire une donnée : la mesure est reprise par un utilisateur du
   cabinet habilité (`kpi.saisir`), sur le modèle « l'IA propose, l'expert dispose » (OUVERT :
   saisie directe sous l'identité du contributeur).
10. **Relances automatiques vers le client = classe R0** : la relance J+10 et la synthèse
    hebdomadaire sont suspendues par le coupe-circuit N4 du cabinet (journalisé « bloqué »), comme les
    relances de la salle de mission. La réponse à un message entrant (arrêt, confirmation) n'y est
    pas soumise.
11. **Plafonds de débit** : par destinataire (3 messages à l'initiative du cabinet par 24 h), par
    cabinet et par mois, par compte pour les webhooks ; comptés dans la base, pas en mémoire.
12. **Rien n'est déduit sur les chiffres par un modèle.** La synthèse hebdomadaire est un calcul
    déterministe (compteurs) ; l'analyse d'une saisie de KPI et le contrôle de vraisemblance sont des
    fonctions pures de `packages/engines`.

## Conséquences positives

- Le code, les tables, les écrans et les tests sont prêts avant tout contrat Meta ; le jour où un
  adaptateur réel existe, seuls `ports.ts` et la fabrique changent.
- Le consentement, le retrait et la minimisation sont démontrables par test, indépendamment du
  fournisseur.
- Aucune donnée personnelle réelle ne peut transiter par le mode simulé (plage de numéros de test).
- Réutilise `jobs`, `journal_audit`, le limiteur persistant, le coupe-circuit N4 et le masquage
  existants : pas de nouveau mécanisme de file ni de limiteur.

## Conséquences négatives

- Un message réel ne sera pas identique à celui testé : gabarits à faire approuver par Meta,
  format des webhooks à confirmer (OUVERT O-02, O-13).
- Le choix « au plus une fois » peut manquer une relance si le worker tombe pendant l'appel.
- Les gabarits sans nom ni titre sont moins engageants pour le lecteur ; le gain de
  confidentialité l'emporte (décision du 2026-10-08).
- Une route publique de plus dans une API qui n'en avait aucune d'appel externe (justifiée en
  §8 de la SPEC-3c et à ajouter à la liste blanche de `review-checklist.md`).
- L'hébergement des messages chez Meta et le registre ARTCI restent à traiter avant tout usage
  réel (OUVERT O-03).

## Alternatives écartées

- **Appeler l'API WhatsApp directement depuis les modules** — couple chaque module à un service
  externe, rend les tests dépendants du réseau et interdit le remplacement du fournisseur
  (risque nommé au PRD §20).
- **Faire de WhatsApp une action du moteur d'automatisation** — le catalogue d'actions
  (`schemas/automatisation.ts`) est interne ; une action vers le client exigerait N4 et le garde
  `garderActionAutomatisation` pour une relance déjà décrite par le palier J+10 ; un job dédié,
  comme J+3 et J+7, reste plus simple à auditer.
- **Un lien « magique » dans le message, sans mot de passe** — contournerait le portail, la 2FA et
  `LISTE_BLANCHE_PORTAIL` ; le lien du message est une simple adresse du portail, qui exige la
  connexion.
- **Repli par e-mail seulement** — l'e-mail existe déjà, mais le PRD et DECISIONS.md imposent le
  SMS en repli.
- **Stocker le texte des messages dans le journal** — facilite le support mais crée une copie des
  messages chez le cabinet et chez nous ; remplacé par une empreinte à clé et la longueur.

## Liens

- [SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md) (spécification technique complète).
- PRD complémentaire §8.2, §13 (CLI-02, CLI-07), §11.4 (KPI-14), §17, §20, §21 (décision 8) ;
  `docs/DECISIONS.md` (« WhatsApp Business »).
- Code réutilisé : `apps/api/src/notifications/*`, `apps/api/src/jobs/*`,
  `apps/api/src/questionnaires/relances.ts`, `apps/api/src/salle-mission/relances.ts`,
  `apps/api/src/auth/chiffrement.ts`, `apps/api/src/portail/garde.ts`.
- ADR-002 (file de tâches), ADR-005 (agents, données non fiables), ADR-006 (automatisation), ADR-010
  (signature), ADR-013 (transcription).

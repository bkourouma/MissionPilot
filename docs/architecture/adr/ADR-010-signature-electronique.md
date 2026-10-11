# ADR-010 : Signature électronique (interface, fournisseur local, journal de preuves ; fournisseur réel non choisi)

## Statut

Proposé (fournisseur LOCAL seulement ; le choix du fournisseur réel et la valeur probante sont
OUVERTS : [SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md), §17, O-06, O-07, O-10).

## Date

2026-10-11

## Contexte

Le PRD principal (MIS-08, « Souhaitable », V3) puis le PRD complémentaire (CLI-05, « Important »,
V4 : « lettres de mission, avenants et procès-verbaux de validation ») demandent la signature
électronique. L'ADR-010 est cité au PRD complémentaire §17 comme à rédiger avant développement.

Constats sur le code (vérifiés le 2026-10-11) :

- **La « signature » actuelle de la lettre de mission est un acte interne**, pas une signature du
  client : `POST /api/missions/:id/signer` (`routes/missions.ts`, permission `mission.signer`,
  directeur de la mission ou associé) fige le budget initial, la devise, le taux de change et passe
  la mission à `signee` ; il crée une ligne `mission_documents` de type `lettre_de_mission` sans
  fichier. Rien ne recueille l'accord du client.
- Les documents de mission (`mission_documents`, `0014`, `0071`) sont des versions immuables ; une
  version peut référencer un fichier téléversé (`fichier_id`), dont `fichiers.sha256` (`0070`) est
  l'empreinte calculée par le serveur. Les types de fichiers admis sont une liste blanche détectée
  par le contenu (`stockage/detection.ts`).
- Il n'existe pas de type « avenant » : une révision de budget est une `budget_versions` de type
  `revise`, figée à la validation du directeur de mission (`0013`).
- Les signatures internes existent déjà pour la qualité (`qualite_signatures`, `0283` : signataire,
  qualité, version, empreinte SHA-256, ajout seul, déclencheur `MPY06`). Modèle de preuve à réutiliser.
- La reconfirmation d'identité (mot de passe et second facteur) existe pour les actes à fort impact
  (`auth/confirmer-identite.ts`) ; elle lit des tables fermées au contexte du portail (`*_2fa`,
  `portail_interdit`).
- Aucun service externe n'est appelé à part SMTP et OpenRouter ; aucun fournisseur de signature n'a
  été choisi ni évalué.

**Règle ferme décidée par l'utilisateur** : interfaces (ports) + fournisseur simulé/local
uniquement ; aucun envoi réel, aucune clé, aucun compte externe ; le choix du fournisseur de
signature n'est pas tranché ; la valeur probante est OUVERTE.

## Décision

1. **Un port `FournisseurSignature`** (`apps/api/src/canaux/ports.ts`) : créer une demande auprès du
   fournisseur, lire son état, l'annuler, récupérer le dossier de preuve du fournisseur, et (pour
   un fournisseur externe) vérifier un événement entrant signé. Il déclare `mode` (`"simule"`
   aujourd'hui) et `parcours` : `"interne"` (le signataire signe dans MissionPilot) ou `"externe"`
   (renvoi vers la page du fournisseur ; non livré).
2. **Un seul fournisseur livré : `FournisseurSignatureLocal`** (valeur de configuration
   `SIGNATURE_FOURNISSEUR=local`, défaut `aucun`). Il n'appelle aucun service. Parcours « interne »
   simulé : le signataire ouvre le document dans l'application, reconfirme son identité (mot de
   passe et second facteur, `confirmerIdentite`), signe. **Niveau revendiqué : « simple simulée »,
   sans valeur juridique**, affiché comme tel partout. `local` hors développement local fait
   refuser le démarrage (même garde que les canaux : un fournisseur simulé n'est jamais présenté
   comme réel).
3. **Le journal de preuves est à nous, quel que soit le fournisseur** : `signatures_preuves`, en
   ajout seul, chaîné par empreintes SHA-256 (chaque événement porte l'empreinte du précédent),
   horodaté par l'horloge de la base (`horodatage_source = base_locale` : ce n'est PAS un
   horodatage qualifié). Chaque événement porte l'empreinte SHA-256 du document figé
   (`fichiers.sha256`). Un futur fournisseur réel ajoute ses événements au même journal et son
   dossier de preuve en référence.
4. **Ce qui se signe** : un document de mission (`mission_documents`) dont la version référence un
   fichier **PDF** ; la demande fige l'identifiant du document, l'identifiant du fichier et son
   empreinte (déclencheur `MPH11` : l'empreinte doit être celle du fichier). Un document modifiable
   (Word, Excel) n'est pas signable. Trois objets : `lettre_mission`, `avenant` (document de type
   `autre`, avec lien facultatif vers une `budget_versions`), `proces_verbal`.
5. **Signataires** : des utilisateurs de la base uniquement. Côté cabinet : directeur de la mission
   ou associé (comme `POST /missions/:id/signer`). Côté client : un utilisateur du portail de rôle
   `client_dirigeant` du client de la mission (le pouvoir d'engager l'entreprise est OUVERT). Ordre
   parallèle ou séquentiel ; expiration (30 jours par défaut, 1 à 90).
6. **La signature n'a aucun effet métier automatique.** Elle ne fige pas le budget, ne change pas
   le statut de la mission, ne valide pas un avenant : `POST /missions/:id/signer` reste l'acte qui
   fige le budget initial. Quand une lettre de mission est signée de toutes les parties, le
   directeur reçoit une notification l'invitant à accomplir cet acte si la mission est encore
   `proposition`. (OUVERT : faire de la signature de toutes les parties le déclencheur de
   `signer`.)
7. **Séparation des tâches** : personne ne signe pour un autre ; un signataire ne figure qu'une
   fois ; seul le demandeur ou un associé annule ; une demande se crée par `signature.demander`
   (associé, directeur de mission). Le client ne voit que ses demandes.
8. **Aucune donnée financière** n'est exposée par ce module (FIN-02) : le lien avec une révision de
   budget ne rend que son numéro et son type, jamais un montant.
9. **Journal d'audit** pour toute action (demande, envoi, consultation du document, signature,
   refus, annulation, expiration, export du dossier de preuve), sans le contenu du document.
10. **Critères à utiliser pour le choix d'un fournisseur réel** (non tranché, à arbitrer par
    l'utilisateur avec un conseil juridique) : niveau de signature reconnu par le droit applicable aux
    parties ; horodatage qualifié ; hébergement et transferts de données (registre ARTCI) ; dossier de
    preuve exportable et durée d'archivage ; coût par signature ; langues ; parcours sur mobile et
    connexion faible ; API et webhooks signés ; réversibilité.

## Conséquences positives

- La chaîne complète (demande, signataires, ordre, preuves, expiration, refus, annulation) est
  testable sans fournisseur ; un fournisseur réel se branche derrière le même port.
- La preuve (empreinte du document, chaîne d'événements, authentification utilisée) est la nôtre :
  la réversibilité est assurée.
- Aucun acte métier n'est déclenché sans la validation humaine déjà en place.

## Conséquences négatives

- La signature locale n'a pas de valeur probante revendiquée : elle ne remplace pas une vraie
  signature tant que le fournisseur et le niveau juridique ne sont pas décidés.
- Le parcours « interne » exige une authentification forte du signataire du portail, ce qui oblige
  à traiter la reconfirmation dans le contexte fermé du portail (SPEC-3c §12, OUVERT O-15).
- Pas de certificat PDF de preuve dans ce lot (export JSON du dossier de preuve seulement).

## Alternatives écartées

- **Intégrer tout de suite un fournisseur du marché** — aucun choix n'est fait, aucun compte ni clé
  n'est autorisé ; le coût et la valeur juridique ne sont pas connus.
- **Réutiliser `qualite_signatures` pour les documents contractuels** — cette table signe un
  suivi qualité interne (QUA-06), liée à `qualite_suivis` ; mélanger les deux brouillerait
  l'audit.
- **Faire de `POST /missions/:id/signer` la signature électronique** — il fige le budget ; lier les
  deux rendrait un budget dépendant d'un parcours externe.
- **Signer un document Word** — contenu modifiable après signature : le PDF fige l'empreinte.
- **Signature par simple case à cocher sans reconfirmation d'identité** — trop faible pour un acte
  engageant, même simulé.

## Liens

- [SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md), §10 à §13.
- PRD principal MIS-08 ; PRD complémentaire §13 (CLI-05), §17, §20 (responsabilité professionnelle).
- `apps/api/src/routes/missions.ts` (`/missions/:id/signer`), `apps/api/migrations/0013`, `0014`,
  `0070`, `0071`, `0283` ; `apps/api/src/auth/confirmer-identite.ts`.
- ADR-008 (canaux), ADR-013 (transcription).

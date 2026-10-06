# Modèle de menace — MissionPilot

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les mécanismes de sécurité **tels qu'implémentés
aujourd'hui**, avec leur fichier, pas un objectif. Il est lu par l'agent
`security-auditor` et par `/audit` : chaque contrôle listé ici doit pouvoir se
vérifier dans le code.

## 1. Actifs à protéger

*Spécification du PRD ; rien n'est encore implémenté (pas de code).*

- Données financières d'un cabinet : honoraires, taux de vente, coûts
  journaliers chargés, marges, budgets, factures, encaissements.
- États financiers et hypothèses des clients du cabinet (services de conseil,
  V2).
- Documents de mission : propositions, lettres de mission, livrables, pièces
  justificatives de débours (photos).
- Identité légale des clients (RCCM, compte contribuable) et contacts.
- Identifiants des utilisateurs, secrets d'intégration (clé du fournisseur IA,
  e-mail), journal d'audit.

## 2. Acteurs

*Spécification du PRD (« Utilisateurs cibles et personas ») ; aucun fichier ne
décide encore des droits.*

- Côté cabinet : associé, directeur de mission, chef de mission, consultant,
  responsable des ressources, gestionnaire administratif et financier, expert
  métier, expert externe (accès limité à ses seules missions).
- Côté clients : dirigeant client, contributeur client, investisseur (portail
  client, V2) : accès restreint aux missions, jalons, livrables et factures de
  leur entreprise.
- Administrateur ACC : console d'administration des cabinets abonnés.
- Services tiers : fournisseur IA, e-mail, Mobile Money (V2).

TODO(acc-adapt) : pour chaque acteur, ce à quoi il a droit et le fichier qui
le décide, une fois le contrôle d'accès écrit.

## 3. Authentification

TODO(acc-adapt) : mécanisme (session, jeton…), durée, stockage côté client,
fichiers concernés.

## 4. Autorisations et cloisonnement des données

TODO(acc-adapt) : comment un utilisateur est limité à ses propres données ;
comment un identifiant reçu dans une requête est vérifié avant lecture ou
écriture (référence d'autrui traitée comme inexistante) ; fonctions à
utiliser.

## 5. Fichiers privés

TODO(acc-adapt) : où sont stockés les fichiers téléversés, comment ils sont
servis (jamais en statique pour un document privé), contrôles d'accès.

## 6. Paiements et webhooks

TODO(acc-adapt) : vérification de signature des notifications entrantes,
source de vérité des montants et statuts, ou « sans objet ».

## 7. Assainissement des entrées et des sorties

TODO(acc-adapt) : validation des entrées, requêtes paramétrées, rendu de
contenu fourni par un utilisateur (pas d'injection HTML), champs sensibles
jamais renvoyés (hash de mot de passe…).

## 8. Secrets et configuration

- Les secrets vivent dans des fichiers `.env` non commités ou dans le
  gestionnaire de secrets de l'hébergeur ; seul un `.env.example` sans valeur
  réelle est versionné.
- Les agents ne lisent ni n'écrivent les `.env` (règle d'`AGENTS.md`, refus
  dans `.claude/settings.json`).

TODO(acc-adapt) : point d'entrée unique de la configuration, validation au
démarrage, variables exposées au client (et interdiction d'y placer un
secret).

## 9. Réseau

TODO(acc-adapt) : origines autorisées, en-têtes de sécurité, limites de débit.

## 10. Données personnelles

*Exigence du PRD, non implémentée.* Cadre de conformité : loi ivoirienne
n° 2013-450 (ARTCI), RGPD pour les clients européens, registre des
traitements à jour. Les données identifiantes sont masquées avant envoi au
fournisseur IA quand c'est possible, et celui-ci doit s'engager par contrat à
ne pas entraîner ses modèles sur les données clients (clause signée avant le
pilote).

TODO(acc-adapt) : données réellement collectées, journalisation (jamais de
secret ni de donnée personnelle dans les journaux), durée de conservation.

## 11. Conduite à tenir en cas de faille

1. Ne pas publier le détail de la faille dans un canal public (ticket, PR
   ouverte, message).
2. Prévenir le responsable du projet. TODO(acc-adapt) : qui, comment.
3. Corriger sur une branche dédiée, avec un test qui reproduit la faille.
4. Évaluer l'exposition (journaux, données touchées) et la documenter.

## 12. Points ouverts

Aucune faille connue : le dépôt ne contient pas de code. Décisions de
sécurité encore ouvertes dans le PRD (« Questions ouvertes ») : hébergement
(VPS ACC ou cloud avec région africaine) et obligations de facturation
(facture normalisée de la DGI ivoirienne).

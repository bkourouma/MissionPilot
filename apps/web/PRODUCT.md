# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Le cabinet est le client payant ; ses collaborateurs utilisent le produit chaque jour, souvent sur un portable de bureau, parfois sur téléphone avec une connexion lente (3G).

- **Associé / directeur de mission** : voit rentabilité, carnet de commandes et charge du cabinet ; valide propositions, budgets, factures, livrables IA.
- **Chef de mission / consultant** : sait quoi faire cette semaine, saisit ses temps en une minute, produit ses livrables avec l'IA.
- **Gestionnaire administratif et financier, responsable des ressources, expert métier** : facturation et encaissements, plan de charge, référentiels.
- **Côté client** (portail, interface distincte) : dirigeant et contributeurs du client du cabinet, investisseurs qui commandent une due diligence.

Contexte : cabinets de conseil, d'audit et d'expertise d'Afrique francophone.

## Product Purpose

CabinetPilot (nom de marque confirmé, anciennement MissionPilot dans le code et l'interface) est le système de gestion du cabinet d'expertise : vendre, produire, piloter et facturer ses missions sur une seule plateforme, avec l'IA comme collaborateur. Deux piliers : la gestion du cabinet (missions, planification, temps, budget, facturation, rentabilité) et le conseil augmenté par l'IA (notation, due diligence, plan stratégique, pilotage KPI, redressement). Réussite : usage hebdomadaire par tous les collaborateurs, dérives de budget vues avant la mi-parcours, l'IA fait environ 60 % du travail de conseil.

## Positioning

Un seul outil relie la mission vendue, le temps passé, le budget, la facture et les livrables IA validés par un expert, pensé pour les cabinets africains francophones (FCFA, XOF/XAF, EUR, USD ; interface 100 % française).

## Operating Context

Application web Next.js, API Fastify, PostgreSQL. Plus de 15 modules au même niveau dans la navigation latérale actuelle (tableau de bord, planning, temps, missions, tâches, brief, copilote, pipeline, appels d'offres, banques, clients, collaborateurs, catalogue, services candidats, questionnaires, facturation, finance…). Barre basse sur téléphone. Portail client séparé. Déployé sur cabinetpilot.allianceconsultants.net.

## Capabilities and Constraints

- L'IA propose, l'expert dispose : tout contenu IA porte un statut (brouillon IA, modifié, validé) et son historique ; rien n'atteint un client sans validation d'un consultant.
- Les chiffres (jours, montants, marges, scores) viennent de moteurs de calcul, jamais du modèle de langage ; l'interface doit les montrer comme des faits calculés, distincts des textes IA.
- Données financières internes (coûts, taux, marges) réservées aux associés et gestionnaires : l'interface masque par rôle, pas par style.
- Budget initial figé à la signature, révisions versionnées ; périodes de temps clôturées verrouillées.
- Routes, fonctions et rôles existants inchangés : la refonte porte sur la présentation et le regroupement de la navigation.
- Contraintes techniques : polices système ou fichiers légers (réseau 3G), cibles tactiles de 44 px minimum, thème clair et sombre existants, contrastes WCAG 2.1 AA déjà vérifiés.
- Décision ouverte : regroupement exact des entrées de navigation par métier (à proposer dans le design, à valider par l'utilisateur).

## Brand Commitments

Logo CabinetPilot fourni par l'utilisateur : un dossier violet contenant une feuille lavande, entouré d'une flèche orbitale dorée à pastille ; mot-symbole « Cabinet » en violet profond, « Pilot » en or, sans empattement géométrique arrondi. Palette de marque : violet profond à violet vif, or chaud, lavande pâle. Le nom CabinetPilot remplace MissionPilot partout dans l'interface visible (décision de l'utilisateur).

## Evidence on Hand

- Logo : `C:\Users\BABA\AppData\Local\Temp\claude\D--APP-MissionPilot\778f44ba-4084-4546-a1ff-2bc4615389f6\images\1.webp` (image raster sur fond blanc, à copier dans le dépôt à l'implémentation).
- PRD et PRD complémentaire dans `docs/`, captures de recette dans `docs/recette/captures*`.
- Aucun témoignage, client réel ni chiffre commercial : les données de démonstration restent fictives et étiquetées comme telles.

## Product Principles

- La rentabilité d'une mission se lit d'un coup d'œil : budget, réalisé et dérive avant tout décor.
- Le produit distingue toujours ce qui est calculé, ce qui est proposé par l'IA et ce qui est validé par un expert.
- L'usage quotidien prime : la saisie des temps et la prochaine action se font en quelques secondes, sur ordinateur comme sur téléphone.
- Une navigation qui suit les métiers du cabinet, pas la liste des modules.
- Sobre en octets : l'interface reste utilisable sur une connexion lente.

## Accessibility & Inclusion

WCAG 2.1 AA (déjà vérifié sur les jetons actuels), focus clavier visible, cibles tactiles de 44 px, `prefers-reduced-motion` respecté, interface entièrement en français. Ne jamais coder l'état par la seule couleur.

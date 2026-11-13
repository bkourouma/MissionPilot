# ADR-014 — Interface bilingue français / anglais

- **Statut** : accepté (2026-11-13)
- **Contexte** : le PRD (« Localisation ») prévoit le français en V1 et l'anglais ensuite.
  L'utilisateur a demandé le 2026-11-13 de rendre l'application bilingue. L'interface compte
  près de 1 000 composants et 180 000 lignes de code web, avec des composants serveur, des
  composants clients et des bibliothèques de libellés partagées par les deux.

## Décision

1. **Deux langues** : `fr` (défaut et langue de référence des textes) et `en`
   (`packages/shared/src/langue.ts`). Formats `Intl` : `fr-FR` et `en-GB`. Les montants gardent
   « FCFA » dans les deux langues.
2. **Choix de la langue** : cookie `mp_langue` posé par le sélecteur FR / EN (en-tête de
   l'application, du portail, de la console plateforme et page de connexion), sinon
   `Accept-Language`, sinon français. Changer de langue recharge la page. Pas de préfixe d'URL,
   pas de préférence en base en V1.
3. **Traduction en ligne, sans dictionnaire central** : chaque texte porte ses deux versions là
   où il est écrit, `t("Enregistrer", "Save")`. Aucune bibliothèque ajoutée. Raisons : pas de
   fichier commun que vingt chantiers modifieraient en même temps, pas de clé à inventer, le
   français reste lisible dans le code, et le typage interdit d'oublier une version.
   - composant client : `const t = useT()` / `useLangue()` (`components/i18n/FournisseurLangue.tsx`) ;
   - composant serveur, `generateMetadata` : `await obtenirT()` / `obtenirLangue()` (`lib/i18n/serveur.ts`) ;
   - JSX d'un composant sans directive partagé entre serveur et client : `<T fr="…" en="…" />` ;
   - bibliothèque de libellés ou de messages : paramètre final facultatif `langue: Langue = "fr"`,
     ou table `…_EN` à côté de la table française (les tests existants restent en français).
   - une page serveur ne passe jamais `t` à un composant client (fonction non sérialisable) : elle
     passe `langue`.
4. **Messages d'erreur de l'API** : écrits en français dans le code ; le gestionnaire unique
   d'`app.ts` les rend dans la langue de la requête (en-tête `x-mp-langue` des appels serveur du
   web, cookie `mp_langue`, `Accept-Language`) par la table exacte et les motifs de
   `apps/api/src/i18n/messages-en.ts`. Un message sans traduction reste en français. Le test
   `i18n-messages.test.ts` vérifie que chaque clé figure encore dans le code.
5. **Hors champ en V1** : contenus saisis par les utilisateurs et produits par l'IA (prompts,
   brouillons), rapports PDF, e-mails et notifications, données de démonstration. Ils restent en
   français.

## Conséquences

- La règle « tout texte affiché est en français » devient « tout texte affiché a sa version
  française et anglaise » (`.claude/rules/review-checklist.md`, « Interface et textes affichés »).
- Un écran nouveau écrit ses textes avec `t(fr, en)` dès le départ.
- Les dates et nombres passent la langue aux fonctions de `lib/format.ts` (paramètre facultatif).

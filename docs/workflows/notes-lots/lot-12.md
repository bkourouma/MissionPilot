Reporté dans la documentation le 2026-10-22 (lot 9f).

# Lot 12 : derniers `router.refresh()` directs et mises à jour de sécurité (2026-10-22)

## Partie A : migration vers `useRafraichir`

Les 12 appels directs réintroduits par le lot 6 dans 9 composants passent par
`useRafraichir` (`const { rafraichir } = useRafraichir();`, même emplacement, même sémantique) :
`dossier/ImportEtatDocument`, `dossier/ImportEtatDocumentListe`, `due-diligence/DocumentsLecture` (2),
`due-diligence/DocumentsListe`, `due-diligence/DocumentsTeleversement`, `ingestion/BoutonRelance`,
`methodes/AmorcageDocuments` (2, une instance du hook par composant), `methodes/AmorcageProposition` (2).

`ingestion/ActualisationAuto` (rafraîchissement toutes les 3 s tant qu'un document est en cours de
lecture) n'utilise volontairement PAS le hook complet : sa relance à 1,5 s et son suivi d'attente
créeraient des requêtes RSC parasites à chaque tick. Il combine `useTransition()` et
`rafraichirEnTransition` (exporté par `useRafraichir.ts`, hook inchangé) et saute un tick tant que la
transition du précédent n'est pas terminée (`doitSauterTick`, testée), donc aucun empilement.

Résultat : `grep -rn "\.refresh()" apps/web/src` ne renvoie plus que `FormulaireConnexion.tsx` (volontaire),
`useRafraichir.ts` et son test, et les commentaires de `useAttenteRafraichissement.ts` et
`useFermetureDifferee.ts`. Tests web : 2351 (2349 avant, plus les 2 de `ActualisationAuto.test.ts`).

## Partie B : mises à jour de sécurité

Audit avant (`pnpm audit --prod`) : 3 vulnérabilités (1 critique, 1 haute, 1 basse).

| Paquet    | Avis                                                      | Gravité  | Versions touchées | Corrigé en | Retenue (exacte) | Publiée le (UTC)     | Âge au 2026-10-22 |
| --------- | --------------------------------------------------------- | -------- | ----------------- | ---------- | ---------------- | -------------------- | ----------------- |
| `next`    | GHSA-2464-fhr4-w9xw (RCE, optimisation d'images SVG)      | critique | >=10.0.0 <=15.5.27 | >=15.5.28  | **15.5.28**      | 2026-10-14 17:36     | 8 jours           |
| `next`    | GHSA-p3m5-59mp-jv5r (déni de service, Server Actions)     | haute    | >=13.0.0 <=15.5.27 | >=15.5.28  | **15.5.28**      | 2026-10-14 17:36     | 8 jours           |
| `fastify` | GHSA-389g-gv7q-r4x8 (contournement de validation d'en-tête) | basse    | >=5.12.2 <5.12.6  | >=5.12.6   | **5.12.6**       | 2026-10-13 06:50     | 9 jours           |

**Écart avec le brief (âge minimum de 2 semaines) : non tenable.** Aucune version corrigée n'a 14 jours :
`next` 15.5.28 est la seule de la branche 15.5 qui corrige (la suivante n'existe pas ; `latest` est 16.4.2,
un saut de version majeure hors périmètre) et `fastify` 5.12.6 date de 9 jours (5.12.7, publiée le même
jour 2026-10-13, est plus récente et n'est pas nécessaire). Décision : la plus petite version qui corrige
chaque avis a été retenue malgré l'âge, parce qu'une RCE critique non authentifiée vaut mieux que la
règle d'âge ; réversible (changement de deux lignes de `package.json` et du lockfile, rien n'est commité).
À confirmer par le superviseur.

Changements : `apps/web/package.json` `next` `^15.0.0` en `15.5.28` ; `apps/api/package.json` `fastify`
`^5.0.0` en `5.12.6` (versions exactes, comme `unpdf`). `pnpm-lock.yaml` : seules bougent les entrées de
`next` et de ses binaires natifs `@next/env` et `@next/swc-*` (15.5.27 vers 15.5.28) et de `fastify`
(5.12.5 vers 5.12.6) ; aucune dépendance transitive ajoutée ni retirée. Aucune montée de patch n'a cassé
quoi que ce soit.

Audit après (`pnpm audit --prod`) : **No known vulnerabilities found**.

## Vérifications

- `pnpm typecheck`, `pnpm lint`, `pnpm format` : verts.
- Tests : engines 2207 (138 fichiers), shared 525 (44 fichiers), web 2351 (155 fichiers).
- Build de production web (`next build`) : OK.
- API (base `missionpilot_o12a`), 18 fichiers, 218 tests verts : `isolation`, `portail-acces`,
  `portail-contexte`, `portail-gestion`, `jobs`, `jobs-equite`, `jobs-registre`, `ia-jobs`, `auth`,
  `auth-limiteur`, `auth-limiteur-horloge`, `origine-csrf`, `double-authentification`,
  `double-authentification-durcissement`, `limiteur-admin`, `ingestion-securite`,
  `ingestion-dd-securite`, `collaborateurs` (couvrent cookies, CORS/origine, multipart, limiteurs, plugins).

## Lignes à reporter dans `docs/governance/SECURITY.md` §14

> **Mise à jour du 2026-10-22 (lot 12).** Les trois vulnérabilités du relevé du lot 9e sont corrigées :
> `next` **15.5.28** (GHSA-2464-fhr4-w9xw critique, GHSA-p3m5-59mp-jv5r haute) et `fastify` **5.12.6**
> (GHSA-389g-gv7q-r4x8 basse), en versions exactes dans `apps/web/package.json` et `apps/api/package.json`.
> `pnpm audit --prod` : aucune vulnérabilité connue. Ces deux versions ont 8 et 9 jours au 2026-10-22 (règle
> d'âge de 2 semaines non tenable : aucune version corrigée plus ancienne n'existe). Le lockfile ne change
> que pour `next`, `@next/*` et `fastify`.

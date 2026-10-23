Reporté dans la documentation le 2026-10-22 (lot 9b).

# Notes du lot 5b (CAP-03, CAP-04, AO-01) — mises à jour de documentation à reporter

Fichier de transit : le chef de lot n'a pas le droit de modifier SECURITY.md, DECISIONS.md, CODING_STANDARDS.md, review-checklist.md ni HANDOFF.md.
Le superviseur reporte les blocs ci-dessous puis supprime ce fichier.

## 1. CODING_STANDARDS.md

- §1 (migrations) : consommées `0364`–`0367` (veille AO), `0466`–`0467` (efficacité CAP-03), `0470`–`0472` (observatoire CAP-04). Libres : AO `0368`–`0379`, CAP `0468`–`0469` et `0473`–`0479`.
- §2 (SQLSTATE) : préfixe `MQK` capitalisation et observatoire (`MQK01`–`MQK05` efficacité ; `MQK20`–`MQK27` observatoire) ; préfixe `MQA` appels d'offres (`MQA01`–`MQA05` veille).

## 2. SECURITY.md

- **Observatoire (CAP-04)** : seul chemin inter-cabinets = fonction `obs_agregats(p_indicateur)` (0472), `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE` retiré à `PUBLIC` et accordé au rôle applicatif ; refuse hors contexte de cabinet et dans le portail (MQK24), cabinet sans adhésion active (MQK25), indicateur inconnu (MQK26), cabinet adhérent SANS contribution éligible (MQK27, accès réservé aux CONTRIBUTEURS, décision n° 1 ; éligible = mois civil clos, versée depuis la dernière adhésion ; doublé dans `agregats()` ; 403 `OBSERVATOIRE_CONTRIBUTION_REQUISE`) ; ne renvoie que des agrégats par case (secteur × taille) AU-DESSUS des seuils (5 entreprises issues de 3 cabinets) : une case sous seuil n'est pas renvoyée du tout. Le moteur (`packages/engines/src/capitalisation/observatoire.ts`) re-vérifie les seuils, calcule les marges des seules cases publiées (pas d'attaque par différence), arrondit (moyenne, médiane, quartiles au point ; effectif à la tranche de 5 ; quartiles et répartition seulement à partir de 10 entreprises).
- Tables `obs_adhesion_evenements` (ajout seul), `obs_contributions` : RLS d'isolation + politique RESTRICTIVE `portail_interdit` ; le cabinet ne voit que ses lignes.
- **Atténuation de la différence temporelle** : gel mensuel (seuls les versements d'un mois civil UTC clos comptent, dernier versement de chaque cabinet) ; une ré-adhésion n'est prise en compte qu'avec un NOUVEAU versement (`verse_le >= date de la dernière adhésion`) ; versements sérialisés par verrou consultatif (sans lui, doublement des entreprises d'un cabinet, donc franchissement indu du seuil).
- **Risques résiduels** : (a) le retrait d'adhésion ou de contributions est IMMÉDIAT, donc visible de façon approchée par un adhérent qui compare deux lectures ; (b) RÈGLE DE DOMINANCE (décision de l'utilisateur, appliquée) : les seuils sont calculés HORS du cabinet appelant ; une case n'est publiée que si elle compte au moins 5 entreprises ET au moins 3 cabinets AUTRES que l'appelant (règle « des autres ») (`obs_agregats` renvoie aussi `effectif_entreprises_autres` et `effectif_cabinets_autres`, 0472 ; le moteur re-vérifie sur ces colonnes) ; en retranchant ses propres données, un cabinet ne peut donc isoler moins de 3 autres cabinets ni moins de 5 autres entreprises (hypothèse prudente : « 5 entreprises » compté aussi hors appelant). Les statistiques publiées incluent les données de l'appelant ; (c) COLLUSION entre contributeurs : trois cabinets contributeurs qui se concertent (chacun connaît ses propres valeurs) peuvent reconstituer ce que porte un quatrième ; la règle des autres protège contre un cabinet seul, pas contre une entente (limite assumée, à encadrer par les conditions d'adhésion) ; (c bis) effet de bord : avec exactement 3 contributeurs dans une case, elle est MASQUÉE pour chacun d'eux (les « autres » ne sont que 2) mais publiée pour un tiers qui contribue ailleurs ; à 4 cabinets elle devient publiée pour tous ; (c ter) classement du secteur par mots-clés (faux positifs possibles, sans enjeu de sécurité) ; (d) les contributions d'un cabinet retiré restent en base, exclues des agrégats, jusqu'à ce qu'il les retire (DELETE autorisé sur ses lignes).
- **CAP-03** : le seuil d'affichage d'un score par contexte ne peut que RELEVER le masquage (plancher 5, schéma Zod `EFFICACITE_SEUIL_OBSERVATIONS_MIN` et moteur ; 400 en dessous) ; l'effectif d'un contexte sous le seuil n'est pas servi (`effectif: null`) ; la liste des recommandations masque libellé, mission, type d'initiative, secteur, taille et score pour une mission non visible.
- **Portail** : aucune route nouvelle ouverte (liste blanche inchangée) ; toutes les tables nouvelles portent `portail_interdit`.
- **Veille AO** : adaptateurs SIMULÉS uniquement (test : aucun `fetch`/`http` dans les sources) ; l'API ne visite jamais l'URL d'un avis ; import 1 Mo / 200 avis ; plafond 5000 résultats par cabinet (MQA03) et 500 occurrences par résultat (MQA04). Un adaptateur réel exigera un ADR (SSRF, délai, clé).

## 3. DECISIONS.md (valeurs provisoires à valider)

- CAP-03 : délai d'effet 30 jours après la mise en œuvre (`EFFICACITE_DELAI_EFFET_JOURS`) ; seuil minimal d'observations avant d'afficher un score par contexte : 5 (`EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT`) ; score = part de l'écart attendu (base → cible) comblée à la date d'effet, bornée 0–100 ; écart nul ou mesure manquante = non évaluable.
- CAP-04 : seuils 5 entreprises / 3 cabinets, calculés hors du cabinet appelant (dominance) ; un seul indicateur (`notation_score_global` : score ajusté de la dernière notation publiée de chaque client, client sans taille écarté) ; gel mensuel UTC ; observatoire consultable par associé et directeur de mission, adhésion et versement par l'associé seul.
- AO-01 : veille avec TROIS sources simulées activables par cabinet (désactivées par défaut, aucun appel réseau) ; collecte déclenchée à la main (pas de job) ; plafonds 5000 résultats par cabinet et 500 occurrences par résultat, import 1 Mo / 200 avis.

## 4. HANDOFF.md

- Lot 5b livré (voir rapport) : CAP-03, CAP-04, AO-01 retirés de « Reste à faire » (lots C et I partiellement) ; NOT-14 (percentile) reste à faire ; CAP-04 n'a qu'un indicateur.
- Fichiers chauds touchés de façon additive : `packages/shared/src/roles.ts` (+ test), `apps/api/src/app.ts`, `apps/web/src/lib/navigation.ts` (+ test), index shared/engines.

## 5. review-checklist.md, recherche n° 7 (`LIMIT` littéraux)

LIMIT littéraux neufs du lot (plafonds déclarés, tous bornés) : `apps/api/src/capitalisation/efficacite.ts` (historique des instantanés `LIMIT 50` ; KPI d'une mission `LIMIT 200` ; initiatives du plan `LIMIT 200`) ; `apps/api/src/capitalisation/observatoire.ts` historique d'adhésion : passé en paramètre (`OBSERVATOIRE_HISTORIQUE_MAX = 200`). Les `LIMIT 1` sont des sélections d'une ligne.

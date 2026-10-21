Reporté dans la documentation le 2026-10-21 (lot 9a).

# Notes du lot 1 « Socle IA » (2026-10-20)

Mises à jour à reporter par le superviseur dans les documents interdits au lot
(SECURITY.md, DECISIONS.md, CODING_STANDARDS.md, review-checklist.md, HANDOFF.md).
Branche `orch/2026-10-20-reste-lot-1`. Rien n'est commité.

## Migrations posées

| N°   | Objet                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0275 | Rejeu OpenRouter : fonctions `SECURITY DEFINER` `rejeu_evaluation_demarrer`, `_inscrire_appel`, `_terminer`, garde de la table `jobs` (type rejeu), droits par colonne retirés au rôle applicatif |
| 0276 | `modele_recommande`, `modele_route`, `garder_activation_prompt` liée au modèle routé, `controler_execution_evaluee` alignée                                                                    |
| 0277 | Registre standard : agent `copilote` version 3                                                                                                                                              |
| 0305 | `reserver_job_a` équitable par cabinet + 3 index sur `jobs`                                                                                                                                 |
| 0550 | Espace `brief_requetes` du limiteur persistant (hors plage AUT : voir ci-dessous)                                                                                                           |

Prochains libres : AGT `0278` ; AUT `0306` à `0312` (0306 ne doit PAS servir à redéfinir
`tentatives_auth_regles`, voir 0550) ; canaux `0551`. SQLSTATE : `MPG12` à `MPG15` pris (reste `MPG16` à `MPG20`).

**0550 hors plage** : le migrateur applique par ordre alphabétique ; une redéfinition de
`tentatives_auth_regles` numérotée 0306 aurait été écrasée par celle de 0544. Toute nouvelle
redéfinition de cette fonction doit porter un numéro supérieur à 0550 (ou fusionner les espaces) et reprendre ses 6 espaces
(`connexion`, `reauth`, `facteur`, `webhook_canal`, `webhook_invalide`, `brief_requetes`).
0550 est HORS plage (une 0520 est impossible : 0544, appliquée après, écraserait la règle ; testé) ; 0549 est pris par le lot 3 ; si le lot 3 redéfinit aussi cette fonction, le numéro le plus élevé doit reprendre les espaces des deux.

## SECURITY.md

### §15 : lignes à remplacer ou retirer

1. « Rejeu réel : la file `jobs` est FIFO globale… » : la RÉCLAMATION est équitable depuis 0305 (cabinet
   ayant le moins de jobs `en_cours`, puis tourniquet sur le dernier `verrouille_le`, puis plus ancien
   `execute_a`). Reste : le worker traite UN job à la fois (`traiterUn`) ; un rejeu de 8 à 13 minutes
   bloque la boucle, l'équité joue à la réservation, pas à l'exécution (piste : file dédiée aux jobs
   longs ou second worker). Après un échec ou une libération de job bloqué, `verrouille_le` est remis à
   NULL : le tourniquet perd la date de ce job (le critère « moins de jobs en cours » garde l'équité).
2. « Rejeu réel : la garde de provenance… contournable » : GARDE FAITE (0275) dans la mesure du possible.
   Garanti : un INSERT/UPDATE direct ne produit plus une demande `en_cours`, un appel d'évaluation inscrit
   ni une évaluation `openrouter` ; un job de rejeu ne peut être inséré `en_cours` à la main ; un contexte
   ou un job d'un autre cabinet est refusé. RESTE (dette) : du SQL arbitraire à plusieurs instructions du
   même rôle applicatif peut mettre en file une demande et son job, réserver ce job lui-même par
   `reserver_job_a` (accordée à ce rôle) puis appeler les trois fonctions en déclarant des appels `succes`
   (coût, jetons et issue sont déclarés par l'appelant : la base ne connaît pas les tarifs). Traces
   conservées : évaluation et appels en ajout seul, `job_id` posé une fois ; la ligne du job reste
   supprimable. Garde complète = rôle PostgreSQL distinct pour le worker, seul à exécuter
   `reserver_job_a`, `reserver_job` et ces fonctions : nouvel ADR, connexion dédiée (`db/pool.ts`,
   `config.ts`, `jobs/worker.ts`), non fait.
3. « `prompt_evalue` avec `p_modele` nul » : LEVÉE (0276). L'activation exige une évaluation sur le modèle
   routé du cabinet (`ia_modeles_taches`, sinon recommandé). Limite : revenir au modèle recommandé
   (suppression de la ligne de `ia_modeles_taches`) n'est pas gardé à l'activation ; l'exécution d'un
   prompt non évalué avec ce modèle reste refusée (filet `exigerPromptEvalue`). `modele_recommande()` en
   SQL duplique `MODELES_RECOMMANDES` (`ia/modeles.ts`) : un test les compare ; changer un modèle
   recommandé exige une migration. Reste non contrôlé : contenu client réel dans un jeu d'essai.
4. « Copilote : les noms propres… partent en CLAIR » : remplacer par : les noms CONNUS du cabinet
   (raisons sociales des clients, noms des utilisateurs, des contacts clients, intitulés de missions),
   écrits en entier, sont masqués avant envoi (jetons restitués localement) en plus des formats ; PARTENT
   en clair : un nom absent des fiches, un fragment seul (prénom, un mot d'une raison sociale), une faute
   de frappe ou des lettres espacées, le texte libre autour, le nom d'un autre cabinet tapé par
   l'utilisateur ; au-delà de 2 000 noms candidats par table ou 200 noms distincts par message, le
   surplus part en clair. Toujours non vérifié avec un vrai modèle.
5. « Brief quotidien : plafond de débit EN MÉMOIRE » : LEVÉE. Le plafond (60 par 10 minutes et par
   utilisateur) est tenu par le limiteur persistant (espace `brief_requetes`, 0550, clé = identifiant de
   l'utilisateur en HMAC). Coût : une transaction courte en base par appel du brief. Retirer l'exception
   au modèle `journal_audit` du §5 septies (« Plafond de débit EN MÉMOIRE »).
6. Ajouter : copilote, `ajouter_commentaire` (texte de 600 caractères au plus stocké dans
   `copilote_actions.parametres` et `resume`, anonymisé à 30 jours, jamais au journal d'échange) et
   `planifier_relance` (relance MANUELLE de niveau suivant d'une facture échue, sans e-mail au client,
   sans montant dans le résumé).

### §5 septies (brief) et section copilote

- Types du brief : 30 types en trois familles, « À décider » (16), « Ça dérive » (8), « Prêt à envoyer »
  (6), 29 sources (le KPI au rouge et le KPI à l'orange partagent une source).
- Sources ajoutées : offre technique d'appel d'offres dont la dernière version n'est pas validée
  (`ao.gerer`, hors créateur, auteur de version et demandeur de génération IA ; sans visibilité de mission :
  une offre n'a pas de mission) ; plan (`plan.valider` ET responsable de la mission visible et non clôturée ;
  contenu `modifie` ou `brouillon_ia`, ou modèle financier non validé ; hors contenu écrit depuis la
  dernière validation et hors modèle dont l'utilisateur est l'auteur) ; révision de budget non figée
  (`budget.reviser`, directeur de la mission ou associé, mission signée/en cours/à clôturer et visible, hors
  auteur ; palier FIN-15 recalculé pour un non-associé ; jamais de montant, jour, devise ni écart, FIN-02).
  Le brief n'exempte aucun associé de la séparation des tâches (plus strict que les routes).
- Source encore écartée : rapports « validés non diffusés » : `rapports_mission` est en ajout seul, son
  `statut` `valide` est fixé à la génération par le code, aucune table d'envoi, de partage du portail ni de
  signature ne le référence (le seul vestige, `journal_audit` `telechargement`, est interne). À rouvrir
  quand une trace de diffusion au client existera.
- Copilote : trois actions (`creer_tache`, `ajouter_commentaire`, `planifier_relance`), proposition puis
  confirmation à usage unique du même utilisateur, droits revérifiés, niveau N2, service commun de la route,
  journal `via: "copilote"`. Deux lectures nouvelles : `missions_en_retard` (missions dont l'utilisateur est
  directeur, chef ou membre ; jalon non atteint dépassé, ou date de fin dépassée pour une mission signée ou
  en cours ; `mission.lire`) et `retard_feuilles_temps` (`temps.saisir` ET (`temps.valider` OU
  `indicateurs.cabinet` OU `mission.lire_toutes`), périmètre de `routes/discipline-temps.ts`, 4 dernières
  semaines écoulées, noms et nombres de semaines seulement). Sous N1 : outils d'action retirés de l'aide et du
  catalogue envoyé au modèle ; une demande d'action reçoit 200 `statut: refuse` (« Cette action n'est pas
  disponible… ») au lieu de 409 ; la confirmation d'une proposition antérieure reste 409.
- Routage du copilote : plus aucun appel direct au fournisseur depuis `copilote/` ; point d'entrée
  `admettreSansDemande` / `appelerSansDemande` de `ia/orchestrateur.ts` (admission, réservation du plafond
  sous verrou, une tentative, règlement, coût `copilote = true`, journal sans contenu). Le journal d'échange
  ajoute `termes_masques` (compte seulement).
- §4 (fonctions `SECURITY DEFINER`) : ajouter `rejeu_evaluation_demarrer`, `rejeu_evaluation_inscrire_appel`,
  `rejeu_evaluation_terminer` (accordées à `missionpilot_app`), `rejeu_controler_job`,
  `rejeu_demande_verrouillee`, `rejeu_controler_fin` (internes, non accordées), `modele_route`,
  `modele_recommande` ; `reserver_job_a` est désormais en plpgsql.
- Droits retirés au rôle applicatif (0275) : INSERT de `agents_evaluations` limité aux 12 colonnes d'une
  évaluation locale ; INSERT de `agents_evaluations_demandes` limité à 8 colonnes, UPDATE limité à `statut`,
  `cause`, `termine_le`, `job_id` ; un INSERT dans `ia_consommations` avec `evaluation_demande_id` est refusé
  par déclencheur (MPG12) ; garde des jobs de type `agents_evaluation_openrouter` (naissent `en_attente`,
  `tentatives_max = 1`, type/charge/clé/cabinet figés, jamais `en_cours` à la main). SQLSTATE : `MPG12`
  écriture réservée au job de rejeu, `MPG13` job invalide ou contexte absent, `MPG14` demande dans un état
  incompatible, `MPG15` paramètre invalide (erreurs API 409 `ECRITURE_RESERVEE_REJEU`,
  `EVALUATION_INCOHERENTE`).
- Web du copilote : la conversation peut être conservée dans le `sessionStorage` de l'onglet (jamais envoyée
  au serveur, 20 questions au plus, 30 minutes d'inactivité, bouton « Effacer la conversation », propositions
  d'action en attente jamais restaurées, portée = identifiant de l'utilisateur). Le serveur ne conserve
  toujours aucune conversation.

## DECISIONS.md

- Brief, périmètre : « 30 types d'éléments, À décider (16), Ça dérive (8), Prêt à envoyer (6) » ; reste à
  valider « le périmètre des 30 types ».
- Brief, sources écartées : « Non reprises : rapports validés non diffusés (pas de trace de diffusion).
  Reprises : offres techniques, plans, révisions de budget (SECURITY.md §5 septies). Un livrable signé n'est
  à transmettre que 7 jours, une facture émise non envoyée que 30 jours. »
- Brief, débit : « 60 requêtes par utilisateur et par 10 minutes, compteur PARTAGÉ en base (limiteur
  persistant, espace `brief_requetes`) » ; reste à valider : la valeur.
- « Date rejouée du brief » : interprétée comme persistée DANS L'URL (`?date=`) avec sélecteur et mention
  « Brief du … (rejeu) » ; l'autre lecture (persistance serveur de la date du brief quotidien) n'est pas faite.
- Valeurs provisoires nouvelles : rejeu (2 appels au plus par cas ; appel : jetons d'entrée <= 2 000 000,
  de sortie <= 1 000 000, coût <= 100 USD, durée <= 1 h ; horodatages du job : 1 minute avant le début, 1 jour
  après maintenant) ; masquage des noms (2 000 noms lus par table, 200 termes retenus, 3 caractères
  minimum, 200 mots du message) ; copilote (commentaire de 600 caractères ; 4 semaines de retard de feuilles,
  200 collaborateurs lus ; une relance copilote par facture et par jour ; relance toujours sans e-mail
  client ; conversation web 30 minutes / 20 questions) ; limiteur du brief (capacité 100 000 clés).

## CODING_STANDARDS.md

- §1 plages de migrations : prochains libres AGT `0278`, AUT `0306` à `0312`, canaux `0551` ; 0550 pris par le
  limiteur du brief ; rappel : un fichier qui redéfinit `tentatives_auth_regles` doit avoir un numéro
  supérieur au dernier qui la redéfinit (ordre alphabétique d'application).
- SQLSTATE `MPG12` à `MPG15` utilisés.

## review-checklist.md

- Recherche n° 16 (`rg -n "GRANT EXECUTE" apps/api/migrations`) : +1 ligne pour 0275 (trois fonctions) ; 0305
  conserve les GRANT de 0030 ; à recompter avec la commande exacte de la checklist.
- Compte des migrations : 180 + 5 = 185.
- Routes : aucune route ajoutée (les routes `copilote` et `brief` existent déjà).

## HANDOFF.md

- Lots B et C : points 1 à 8 livrés (voir ci-dessus), non commités sur `orch/2026-10-20-reste-lot-1`.
- Reste de la dette : rôle PostgreSQL distinct pour le worker (ADR) ; worker mono-tâche ; file dédiée aux
  jobs longs ; retrait de `evaluation_demande_id` de l'INSERT de `ia/couts.ts` (champ désormais inutilisé,
  un REVOKE par colonne pourrait remplacer le déclencheur) ; rapports « validés non diffusés ».
- NON vérifié : tout vrai fournisseur ; l'affichage du copilote dans un navigateur (carte « Reformuler »,
  « Effacer la conversation », restauration après rechargement, sélecteur de date du brief).
- Fichiers touchés hors liste du lot (additif minimal, à valider) : `apps/api/src/auth/limiteur.ts` (type
  `EspaceLimiteur` + `"brief_requetes"`) ; extractions de code sans changement de comportement :
  `apps/api/src/collaboration/commentaires.ts` (depuis `routes/commentaires.ts`),
  `apps/api/src/finance/relance-manuelle.ts` (depuis `routes/relances.ts`), `routes/commentaires.ts` et
  `routes/relances.ts` modifiés pour les appeler.

## review-checklist.md : ajustements supplémentaires (verdict du vérificateur)

- **Recherche mécanique n° 21** (`rg -n "INSERT INTO agents_evaluations\b" apps/api/src`) : attendu désormais
  **1 ligne** (`agents/evaluations.ts`, l'évaluation locale). L'INSERT de l'évaluation `openrouter` est
  passé dans la fonction SQL `rejeu_evaluation_terminer` (migration 0275) ; il n'existe plus dans
  `agents/evaluations-openrouter.ts`. Mettre à jour le commentaire qui dit « 2 lignes » : l'évaluation
  réelle n'est plus écrite par le code TypeScript mais par la fonction `SECURITY DEFINER`, sous garde du job.
- **Ligne « Contenu IA »** : remplacer « seule exception le routage du copilote » par : le routage du copilote
  ne passe plus par une exception ; il utilise le point d'entrée `admettreSansDemande` /
  `appelerSansDemande` de `ia/orchestrateur.ts` (aucun import de `fournisseurDepuisConfig` dans
  `apps/api/src/copilote/`, test d'inventaire dans `copilote-masquage-noms.test.ts`). Le fournisseur n'est
  donc plus appelé que depuis l'orchestrateur (et le rejeu `agents/evaluations-openrouter.ts`).
- Fonctions de déclencheur `garder_*` de 0275 : `SET search_path = public, pg_temp` posé sur les quatre.

## Correctifs après vérification (2026-10-20)

- Copilote, `planifier_relance` : la règle « une relance copilote par facture et par jour » est revérifiée À LA
  CONFIRMATION (`action-relance.ts`, `planifierRelance`), sous verrou consultatif par facture ; la seconde
  confirmation répond 409 `RELANCE_DEJA_ENREGISTREE` (la proposition reste `proposee` jusqu'à son expiration).
- Web : `BoutonDeconnexion` efface la conversation du copilote (`effacerConversation(stockageSession())`). Aucun
  test de composant n'existe pour ce bouton (la configuration web est en environnement node) : couvert par les
  tests de `lib/copilote-session.ts` (effacement, stockage indisponible).

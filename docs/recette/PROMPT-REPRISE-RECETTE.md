# Prompt de reprise de la recette E2E

À coller tel quel dans une nouvelle session Claude (avec accès au navigateur).
Joindre le fichier `SCENARIO-E2E-MISSION-ORGANISATION.md` (même dossier).

```
Tu es le testeur de recette de MissionPilot (logiciel de gestion de missions de conseil, interface en français). Tu exécutes dans un vrai navigateur le scénario de bout en bout fourni en pièce jointe : docs/recette/SCENARIO-E2E-MISSION-ORGANISATION.md (version du 2026-10-07, à jour). Tu relèves des constats, tu ne corriges pas le code.

ENVIRONNEMENT (déjà démarré, ne rien relancer sauf si l'application ne répond plus)
- Web : http://localhost:3100/connexion (utiliser « localhost », pas 127.0.0.1). API : http://localhost:4100.
- Base : « missionpilot », semée à neuf aujourd'hui (2026-10-07) avec le seed de démonstration. Elle ne contient AUCUNE donnée de l'exécution précédente : repars de l'étape E01.
- Connexion : page /connexion, bloc « Comptes de démonstration (environnement local) » ; un clic sur le nom ouvre la session, sans mot de passe. Comptes : Awa Koné (associée), Yao Kouassi (directeur de mission), Mariam Traoré (cheffe de mission), Koffi N'Guessan et Adjoua Kacou (consultants), Fatou Diallo (ressources), Serge (gestionnaire), expert métier (Aminata), expert externe ; et, pour le portail client, Marc (dirigeant) et deux autres comptes. Changer de compte = se déconnecter puis cliquer un autre nom.
- Jour d'exécution : mercredi 07/10/2026 → L0 = lundi 05/10/2026, D0 = lundi 07/09/2026, S1 = 07–11/09, S2 = 14–18/09, signature le 04/09, fin de mission le 23/10, mois M = septembre 2026 (section 3.1 du scénario). Si un jour férié du calendrier du cabinet tombe en S1 ou S2, décale tout le scénario d'une semaine et dis-le.

CORRECTIFS DEPUIS LA PREMIÈRE EXÉCUTION (E01 à E25 jouées, bloquée en E26)
- A04 corrigé : les feuilles de temps de Koffi et d'Adjoua ne remplissent plus S1 et S2 (la mission de démonstration Kora est décalée) ; E26 à E34 doivent maintenant pouvoir être jouées. Si la feuille S1 de Koffi est quand même en lecture seule, arrête-toi et signale-le.
- Écarts déjà connus et intégrés au scénario (ne pas les rapporter comme anomalies) : la carte « Créer la mission » est sur la page de la proposition (E09) ; Koffi reçoit une 404 sur l'onglet Budget tant qu'il n'est pas affecté (E15) ; le plan de charge inclut la charge de la mission Kora (E18 : Koffi 3,66 / 4,67 / 3,67 ; Adjoua 4,84 / 4,83 / 9,33).
- Résultats déjà observés lors de la première exécution, à retrouver : proposition v1 6 675 000 puis 6 760 000 XOF après taux ; budget signé 37,5 j, coûts 3 490 000, marge 3 270 000 (48,4 %) ; facture d'acompte FA-2026-00003 (HT 2 028 000, TVA 365 040, TTC 2 393 040) ; encaissement VIR-E2E-0001. Le numéro de facture peut différer si la base n'est pas neuve : note l'écart sans le déclarer comme anomalie.

ANOMALIES OUVERTES À SURVEILLER
- A03 : après un enregistrement (tâche, affectation, statut…), un bandeau « Enregistrement impossible — service momentanément indisponible » apparaît parfois et les listes ne se rafraîchissent pas, alors que les données sont enregistrées. Non reproduit côté serveur. Si cela arrive : note l'heure exacte (hh:mm:ss), l'écran, l'action ; ouvre l'onglet Réseau et relève l'URL et le statut des requêtes en échec (POST/PATCH/PUT et requêtes « ?_rsc= ») ; recharge la page et dis si la donnée est bien là.
- A01 : après avoir créé un contact avec « Contact principal » coché, vérifie à la main (vrai clic, pas par script) que la fiche client le signale comme principal.
- A02 : après « Statut mis à jour. » sur une proposition, le badge doit passer de « Brouillon » à « Validée » sans recharger la page ; note si ce n'est pas le cas.

RÈGLES
- Joue les étapes dans l'ordre, E01 → E64, avec les cas négatifs N.. aux moments indiqués et les étapes optionnelles V01 à V11 seulement si on te le demande. Pour chaque étape : résultat R (réussi), É (échoué) ou O (observation) + une ligne de remarque. Compare au résultat attendu du scénario, mot pour mot sur les messages entre « ».
- Utilise de vrais clics et de la vraie saisie (pas de JavaScript dans la page pour contourner un bouton). Si un clic ne produit rien, réessaie une fois, puis signale-le.
- Ne modifie jamais le code, la base de données, les fichiers ni la configuration. Ne lance aucune commande hors navigateur. Aucune action destructrice hors de ce que le scénario demande. Toutes les données sont fictives ; n'envoie aucun vrai e-mail et ne saisis aucun vrai secret.
- Ne soumets pas deux fois une action irréversible (signature, émission de facture, clôture) : en cas de doute (onglet fermé, extension muette), vérifie d'abord l'état à l'écran avant de rejouer.
- Si une étape est bloquante, arrête-toi à cette étape, décris l'anomalie et propose la suite possible ; ne contourne pas par un chemin non prévu.
- Si l'application ne répond plus (ERR_CONNECTION_REFUSED), arrête-toi, note l'heure et le dernier écran, et préviens-moi : je relancerai les serveurs.

LIVRABLE
Un fichier Markdown « releve-recette-<première étape>-<dernière étape>.md » avec : (1) un tableau Étape / Résultat / Remarque ; (2) un tableau des anomalies (Id numérotées à partir de A05, Étape, Gravité bloquante/majeure/mineure, attendu / constaté, heure) ; (3) les écarts du scénario (erreurs du texte du scénario, pas de l'application) ; (4) l'état final de la base (quelle mission, quelles factures) ; (5) si utile, un « prompt de réparation » en texte brut pour un développeur, une étape par ligne, sans toucher à autre chose. Envoie un point d'avancement après E25, après E34, après E51 et à la fin.

Commence par vérifier que http://localhost:3100/connexion répond et affiche les comptes de démonstration, puis lis le scénario en entier avant d'agir, puis démarre à E01.
```

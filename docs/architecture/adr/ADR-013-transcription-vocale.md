# ADR-013 : Transcription vocale (AGT-11) : interface, fournisseur simulé, brouillon à relire

## Statut

Accepté par l'utilisateur le 2026-10-14 (mode SIMULÉ seulement : aucun fournisseur de transcription réel ; les langues locales
réellement couvertes et les coûts sont OUVERTS :
[SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md), §17, O-08, O-09).

## Date

2026-10-11

## Contexte

Le PRD complémentaire demande la « transcription et compréhension de la voix (notes de terrain,
entretiens, réponses vocales), langues locales prioritaires du marché » (AGT-11, V4), des réponses
vocales par WhatsApp (CLI-02, parcours §15) et la saisie de KPI en vocal (KPI-14). Il range la
transcription parmi les « adaptateurs remplaçables » (§17) et exige que les sous-traitants
(« IA, WhatsApp, transcription ») soient déclarés et que les durées de conservation des
« enregistrements d'entretiens » soient décidées avant le pilote (§16).

Constats sur le code (vérifiés le 2026-10-11) :

- Aucune entrée audio n'existe. La liste blanche des fichiers (`fichiers.type_mime`, `0070`, et
  `stockage/detection.ts`) n'admet ni OGG, ni MP3, ni M4A, ni WAV ; la contrainte `CHECK` est
  posée par `0070` et aucune migration ne l'a étendue.
- Les agents `terrain` (« notes vocales et photos en observations ») et `entretien` (« transcrit,
  code les verbatims ») existent au registre (`0260`, niveaux N2 et N3) ; ils lisent du texte, pas
  de l'audio. La compréhension (structuration en observations, codage de verbatims) relève de ces
  agents et de l'orchestrateur (`ia/orchestrateur.ts`), pas de ce lot.
- Tout contenu client est une donnée non fiable avant d'entrer dans un prompt
  (`ia/donnees-non-fiables.ts`, AGT-07) ; le masquage (`ia/masquage.ts`) ne repère les noms que
  s'ils sont fournis comme termes sensibles.
- La purge ou l'anonymisation d'un contenu suit un modèle (`0104`, `0274` : fonction `SECURITY
  DEFINER` bornée au cabinet, tâche planifiée) ; toute durée par défaut est « à valider »
  (`DECISIONS.md`).
- `fichier_orphelin` (dernière définition `0384`) doit citer toute colonne qui référence
  `fichiers`, sinon la purge à 24 h efface le fichier (inventaire automatique de
  `fichiers-orphelins-references.test.ts`).
- Un coût IA est une donnée FIN-02 (absente de la réponse sans `finance.lire`) ; les plafonds IA
  existent par évaluation et par mois (`ia_consommations`, `IA_PLAFOND_PLATEFORME_MICRO_USD`).

**Règle ferme décidée par l'utilisateur** : interfaces (ports) + fournisseur simulé/local
uniquement ; aucune donnée réelle de personnes ; points non vérifiés OUVERTS.

## Décision

1. **Un port `Transcripteur`** (`apps/api/src/canaux/ports.ts`) : `transcrire(demande)` rend un
   texte, des segments horodatés avec une confiance (entier de 0 à 1000), la langue détectée et la
   durée de l'audio ; `langues()` liste les langues prises en charge. Il déclare `fournisseur` et
   `mode`.
2. **Un seul fournisseur livré : `TranscripteurSimule`** (`TRANSCRIPTION_FOURNISSEUR=simule`, défaut
   `aucun`). Il ne décode **aucun vrai audio** : il ne lit qu'un conteneur de test (signature OGG,
   marqueur `MPSIM1`, charge JSON avec le texte attendu) et rejette tout autre audio
   (`AUDIO_NON_SIMULE`). Aucune voix réelle ne peut donc être traitée dans ce mode. `simule` hors
   développement local fait refuser le démarrage.
3. **Fichiers audio** : la liste blanche des fichiers s'étend à `audio/ogg`, `audio/mpeg`,
   `audio/mp4` (marque M4A), `audio/wav`, détectés par le contenu comme les autres types.
   `fichier_orphelin` est redéfinie pour citer `transcriptions.fichier_id`.
4. **Une transcription est un brouillon, jamais une preuve ni un fait.** La version 1 (origine
   `automatique`) est un « brouillon IA » au sens du statut de contenu existant ; un humain la relit
   et la corrige (nouvelles versions en ajout seul), puis un valideur la valide (`transcription.valider`).
   Séparation des tâches : le valideur n'est pas le dernier à avoir modifié le texte, sauf associé
   (déclencheur `MPH07`), comme pour un document de mission. Une transcription non validée ne
   alimente ni le dossier client, ni le registre des preuves, ni un rapport.
5. **Consentement à l'enregistrement** : créer une transcription exige la déclaration que la
   personne enregistrée y a consenti et la référence de cette preuve (colonnes `NOT NULL`). Le
   consentement d'un destinataire WhatsApp à recevoir des messages (ADR-008) ne vaut pas
   consentement à l'enregistrement de sa voix.
6. **Les nombres d'une transcription sont du texte.** Une saisie de KPI dictée suit la même voie
   qu'une saisie écrite (ADR-008, décision 9) avec en plus une double confirmation, car une
   reconnaissance vocale se trompe sur les chiffres (OUVERT : mesure de ce taux d'erreur).
   L'audio reçu par WhatsApp n'est **pas conservé** : il est transcrit en mémoire, ne sert
   qu'à proposer une saisie, et ni l'audio ni son texte ne sont écrits en base ni dans un
   journal ; seule la voie « téléversement par le cabinet » (décisions 3 à 5) crée une
   transcription.
7. **Limites** (valeurs provisoires) : audio de 30 minutes au plus, 600 minutes de transcription par
   cabinet et par mois, 10 transcriptions en file par cabinet, 20 créations par 10 minutes et par
   utilisateur. Coût par minute inconnu : 0 en mode simulé ; le champ de coût existe et n'est visible
   qu'avec `finance.lire`.
8. **Conservation** (provisoire, OUVERTE) : audio effacé 30 jours après la validation ou le rejet
   (ou 90 jours sans décision) ; texte conservé 365 jours après la validation puis anonymisé par une
   fonction `SECURITY DEFINER` planifiée ; le journal ne contient jamais le texte.
9. **La compréhension n'est pas dans ce lot** : le texte validé pourra nourrir les agents `terrain`
   et `entretien` par l'orchestrateur (bloc de données non fiables, masquage, validation
   humaine) ; ce branchement est OUVERT (O-20).
10. **Langues** : `fr` livré ; langues locales prioritaires à titre PROVISOIRE (`dyu` dioula, `wol`
    wolof, `bam` bambara, `lin` lingala) déclarées au port mais non vérifiées contre un vrai
    fournisseur (OUVERT O-08).

## Conséquences positives

- La chaîne (audio, file, transcription, relecture, validation) est testable sans fournisseur et
  sans voix réelle.
- Le texte d'une transcription reste un brouillon relu, conforme à « l'IA propose, l'expert
  dispose ».
- Le port isole le choix d'un sous-traitant (déclaration ARTCI, hébergement de l'audio).

## Conséquences négatives

- Le conteneur de test n'a aucune ressemblance acoustique avec du vrai audio : la qualité de
  reconnaissance, les langues locales, la tenue des chiffres ne sont pas évaluées.
- Stocker de l'audio ajoute des fichiers lourds au stockage du cabinet (quota 2 Go par défaut) et
  une durée de conservation à décider.
- Étendre la liste blanche des fichiers élargit la surface de réception (nouvelles signatures à
  détecter, tests de refus d'un faux audio).

## Alternatives écartées

- **Transcrire avec un modèle multimodal d'OpenRouter** — enverrait la voix de personnes à un
  tiers sans port ni consentement décidés, hors du cadre « aucune donnée réelle » ; et le
  fournisseur de modèles n'est pas un fournisseur de transcription déclaré.
- **Un moteur de reconnaissance local embarqué** — dépendance lourde et qualité inconnue pour les
  langues locales ; pas une solution pour le mode simulé.
- **Ne pas conserver l'audio** — la relecture d'une transcription exige de réécouter ; supprimé
  seulement après décision (décision 8).
- **Créer un nouvel agent « transcription » au registre** — la transcription n'est pas une
  génération gouvernée par niveau d'autonomie : c'est un service technique dont la sortie est un
  brouillon ; les agents `terrain` et `entretien` consomment le résultat.

## Liens

- [SPEC-3c](../../workflows/specs/SPEC-3c-canaux-simules.md), §3 et §10.
- PRD complémentaire §7.2 (AGT-11), §13 (CLI-02), §11.4 (KPI-14), §15, §16, §17.
- `apps/api/migrations/0070`, `0260`, `0384` ; `apps/api/src/stockage/detection.ts` ;
  `apps/api/src/ia/donnees-non-fiables.ts`, `masquage.ts`.
- ADR-003 (IA OpenRouter), ADR-005 (agents), ADR-008 (canal WhatsApp), ADR-010 (signature).

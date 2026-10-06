# Décisions métier et techniques — CapStrat V1

Ce fichier consigne les règles validées par le commanditaire et les décisions techniques prises pour livrer la V1.

## Règles métier validées (06/10/2026)

| Sujet | Décision |
| --- | --- |
| Échelle de notation (NOT-03) | Score global 0–100, 5 classes : A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, E < 35 |
| Publication du rapport de notation (NOT-07) | Un utilisateur au rôle `expert` doit obligatoirement valider ; le consultant ne peut pas publier seul |
| Statut KPI (KPI-03) | Atteinte de la cible : vert ≥ 95 %, orange 80–95 %, rouge < 80 % ; sens de lecture (plus haut / plus bas = mieux) défini par KPI |
| Horizon du modèle financier (PLA-06) | 5 ans par défaut, modifiable de 3 à 5 ans à la création du plan |
| IA | Fournisseur **OpenRouter**. L'utilisateur choisit le modèle par tâche ; le système recommande un modèle par défaut. Sans clé API : repli sur gabarits déterministes, signalés comme tels et soumis à la même validation humaine |
| Relances questionnaires | Automatiques par e-mail à J+3 puis J+7 ; relance manuelle possible par le consultant |

## Règles posées pour avancer (à confirmer)

- Seuls les rôles `dirigeant` et `contributeur` répondent aux questionnaires ; `consultant` et `admin` rédigent, valident et envoient.
- Questionnaire collectif : une réponse partagée, verrouillée à la première soumission.
- Questionnaire par fonction : un libellé de fonction obligatoire par répondant.

## Décisions techniques

- **File de tâches** : table `jobs` PostgreSQL (`FOR UPDATE SKIP LOCKED`) au lieu de BullMQ/Redis. Moins de composants à exploiter ; même garantie d'exécution unique. Redis reste disponible dans `docker-compose.yml` si le volume l'exige plus tard.
- **Recherche sémantique** : pgvector si une clé OpenRouter permet de calculer des embeddings ; recherche plein texte PostgreSQL (français) dans tous les cas, utilisée seule en repli.
- **Chiffres** : tous les calculs (scores, états financiers, KPI) vivent dans `packages/engines`, couverture ≥ 90 % imposée en CI.
- **Rapports** : HTML rendu en PDF par Chromium headless ; DOCX via `docx`, PPTX via `pptxgenjs`.

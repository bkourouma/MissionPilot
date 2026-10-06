# ADR-003 : IA via OpenRouter, hors V1

## Statut

Accepté

## Date

2026-10-06

## Contexte

Le PRD prévoit Claude appelé par un orchestrateur ; `docs/DECISIONS.md`
retient OpenRouter avec modèle choisi par tâche et repli sans clé. Aucune
fonction IA n'est dans le périmètre V1 ; les services IA arrivent en V2.
Contraintes : l'IA propose, l'expert dispose ; aucun chiffre ne vient du
modèle ; le fournisseur ne doit pas s'entraîner sur les données clients ;
coût IA d'une mission ≤ 5 % de son prix.

## Décision

- Fournisseur **OpenRouter** (API compatible OpenAI), derrière une interface
  `LlmProvider` unique dans `apps/api` ; c'est le seul composant qui appelle
  un modèle.
- Le modèle est choisi par tâche (rédaction, extraction, classification) ;
  le système recommande un modèle par défaut, modifiable par le cabinet.
  Claude reste un choix de modèle possible via OpenRouter.
- **Sans clé API** : repli sur gabarits déterministes, marqués « gabarit » et
  soumis à la même validation humaine.
- Chaque sortie IA est stockée avec statut (brouillon IA, modifié, validé),
  version de prompt, modèle et sources (SOC-06). Prompts versionnés en base.
- Les données identifiantes sont masquées avant envoi quand c'est possible.
- Aucun appel IA avant la V2 ; la V1 n'introduit que les colonnes de statut
  de contenu nécessaires à SOC-06.

## Conséquences positives

- Changement de modèle sans changement de code ; coût maîtrisable par tâche.
- Le produit reste utilisable sans clé.

## Conséquences négatives

- Dépendance à un intermédiaire ; la clause « pas d'entraînement sur les
  données » doit être vérifiée par modèle choisi (action métier avant pilote).

## Alternatives écartées

- **Appel direct à Claude uniquement** — moins de choix par tâche.

## Liens

- `docs/DECISIONS.md` ; PRD, « Exigences non fonctionnelles » ; ADR-001.

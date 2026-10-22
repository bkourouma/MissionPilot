# Données de langue de l'OCR local

Données du moteur OCR local (tesseract.js 7.0.0, ADR-009 décision 16). Elles sont **vendorées** : le moteur ne
télécharge jamais rien et refuse de démarrer si une empreinte ne correspond pas
(`apps/api/src/ingestion/ocr-local.ts`, `diagnosticOcrLocal`).

| Fichier           | Langue   | Octets    | SHA-256                                                            |
| ----------------- | -------- | --------- | ------------------------------------------------------------------ |
| `fra.traineddata` | français | 1 130 365 | `ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca` |
| `eng.traineddata` | anglais  | 4 113 088 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |

## Origine et licence

- Dépôt officiel `tesseract-ocr/tessdata_fast` (modèles LSTM « rapides », entiers 8 bits), étiquette `4.1.0`,
  commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`, téléchargés le 2026-10-22 depuis
  `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/<commit>/<langue>.traineddata`.
- Contrôle d'origine : l'empreinte git (SHA-1 de blob) de chaque fichier est identique à celle de l'arbre du
  commit publié par GitHub (`fra` : `d9e2b2160be0d1ca3b8f1bf2730fae476ef3b4a6`, `eng` :
  `bbef4675053b5b468cdb477053e28b1c698ba08e`).
- Licence : Apache License 2.0 (fichier `LICENSE`, copié du même commit).
- « fast » plutôt que « best » : 5,2 Mo au lieu de 19,4 Mo ; les modèles flottants « best » font avorter le cœur
  WebAssembly de `tesseract.js-core` 7.0.0, et « fast » retrouve déjà 100 % des montants des scans nets de test
  (mesures : `docs/workflows/notes-lots/lot-11.md`).

## Vérifier

```bash
node scripts/ocr-verifier-donnees.cjs            # Node pur, sans réseau ; code de sortie 1 si écart
```

## Mettre à jour ou ajouter une langue

1. Choisir un commit du dépôt officiel (`git ls-remote https://github.com/tesseract-ocr/tessdata_fast`).
2. Télécharger le fichier dans un dossier vide, vérifier son SHA-1 de blob (`git hash-object`) contre l'arbre du
   commit (`https://api.github.com/repos/tesseract-ocr/tessdata_fast/git/trees/<commit>`).
3. Le copier ici, régénérer `SHA256SUMS` (`sha256sum *.traineddata > SHA256SUMS`, format « empreinte, deux
   espaces, nom »), mettre à jour ce tableau, puis lancer `node scripts/ocr-verifier-donnees.cjs` et
   `npx vitest run test/ocr-moteur` (dans `apps/api`).
4. Une nouvelle langue n'est utilisée que si `REGLAGES_OCR.langues` (`ocr-local.ts`) la cite.

import { z } from "zod";
import {
  DECIMALES_DEVISE,
  ErreurDossier,
  extraireEtatDepuisTableau,
  extraireEtatParRegles,
  forcerRevueEtat,
  lireLignesEtatIa,
  preparerTexteModele,
  proposerCorrectionsOcr,
  type ExtractionEtat,
  type LigneEtatExtraite,
} from "@missionpilot/engines";
import {
  CORRECTIONS_OCR_MAX,
  PLAFONDS_INGESTION,
  correctionOcrSchema,
  deviseSchema,
  type CorrectionOcr,
  type LigneEtatFinancierSaisie,
} from "@missionpilot/shared";
import { exigerDossierVisible } from "../dossier/acces.js";
import { ingererEtat, type EnTeteEtat } from "../dossier/etats.js";
import { lettresColonne } from "../dossier/import-etats.js";
import { AppError } from "../errors.js";
import { ErreurIngestion } from "./erreurs.js";
import { demanderLignesIa } from "./ia-lignes.js";
import { assurerPromptEtat, NOM_PROMPT_ETAT_LIGNES } from "./prompts-etat.js";
import type { Structureur } from "./structuration.js";
import { lignesDeTexteTableur } from "./tableur.js";

/*
 * Structuration d'un état financier (DOS-03, ADR-009 décisions 7 et 8) : transforme le texte des pages d'un
 * PDF ou d'un classeur en lignes d'état, puis les confie à `ingererEtat` (contrôles du moteur, acceptation
 * automatique seulement si TOUT passe, sinon revue).
 *
 * - PDF : l'IA propose des lignes SI elle est disponible (`ia.utiliser` de l'auteur, IA activée, clé, plafond) ;
 *   le moteur ne retient que les lignes dont le montant se retrouve exactement dans la page citée
 *   (`lireLignesEtatIa`) ; sans IA, ou si elle ne rend aucune ligne retenue, les règles déterministes
 *   lisent le texte (`extraireEtatParRegles`). Excel : règles seules, jamais d'IA.
 * - Les CHIFFRES viennent du texte du document, vérifiés par le moteur ; jamais d'un calcul du modèle.
 * - OCR (lot 11) : une ligne lue sur une page reconnue par OCR porte `reference.ocr = true` et la confiance de la
 *   page (`confiance_pm`). Les CORRECTIONS PROPOSÉES (confusions O/0, l/1, virgule/point, voir
 *   `proposerCorrectionsOcr`) sont inscrites dans `ingestion_documents.corrections_ocr` pendant la structuration ;
 *   elles ne modifient JAMAIS les lignes retenues ni les rejets, et le montant d'une ligne proposée n'entre pas
 *   dans l'état. Pour un document qui n'est pas lu par OCR, la colonne reste NULL.
 * - Revue forcée (jamais d'acceptation automatique) si une ligne est restée rejetée, si le texte vient d'un
 *   OCR, si aucun poste n'a été retenu, ou si le texte transmis au modèle a été tronqué.
 * - Aucune ligne lue : le document est `termine` / `rien_trouve`, aucun état n'est créé.
 * - Le dossier doit rester visible de l'auteur (sinon DOSSIER_INACCESSIBLE) ; une erreur du dossier ou du
 *   moteur (date, dossier plein, structure invalide) donne ETAT_INVALIDE.
 */

const MOTS_CLES = ["actif", "passif", "bilan", "compte de resultat", "total"];

const parametresSchema = z
  .object({
    exercice: z.number().int(),
    date_cloture: z.string(),
    devise: deviseSchema,
    tolerance: z.number().int().min(0),
  })
  .strict();

/** Confiance (0 à 1000) des pages lues par OCR, par numéro de page. */
type PagesOcr = ReadonlyMap<number, number | null>;

const METHODES_OCR = ["ocr", "ocr_simule"];

function lignesPourEtat(
  extraction: ExtractionEtat,
  nom: string,
  excel: boolean,
  pagesOcr: PagesOcr,
): LigneEtatFinancierSaisie[] {
  return extraction.lignes.map((l: LigneEtatExtraite): LigneEtatFinancierSaisie => {
    const reference =
      excel && l.ligne !== undefined
        ? {
            fichier: nom,
            ...(l.colonne !== undefined
              ? { cellule: `${lettresColonne(l.colonne)}${l.ligne}` }
              : {}),
            ligne: l.ligne,
          }
        : { fichier: nom, page: l.page, ...referenceOcr(pagesOcr, l.page) };
    return {
      code: l.code,
      libelle: l.libelle,
      section: l.section,
      montant: l.montant,
      parent: l.parent,
      role: l.role,
      reference,
    };
  });
}

function referenceOcr(pagesOcr: PagesOcr, page: number) {
  if (!pagesOcr.has(page)) return {};
  const confiance = pagesOcr.get(page);
  return {
    ocr: true as const,
    ...(typeof confiance === "number" ? { confiance_pm: confiance } : {}),
  };
}

/** Marge d'octets par entrée : jsonb::text ajoute des blancs après « : » et « , » (limite de 40 000 octets). */
const MARGE_OCTETS_ENTREE = 20;
const OCTETS_CORRECTIONS_MAX = 40_000 - 1_000;

/** Corrections valides au schéma, au plus CORRECTIONS_OCR_MAX et dans la limite d'octets de la colonne. */
function validerCorrections(brutes: readonly unknown[]): CorrectionOcr[] {
  const retenues: CorrectionOcr[] = [];
  let octets = 2;
  for (const brute of brutes) {
    if (retenues.length >= CORRECTIONS_OCR_MAX) break;
    const lue = correctionOcrSchema.safeParse(brute);
    if (!lue.success) continue;
    octets += Buffer.byteLength(JSON.stringify(lue.data)) + MARGE_OCTETS_ENTREE;
    if (octets > OCTETS_CORRECTIONS_MAX) break;
    retenues.push(lue.data);
  }
  return retenues;
}

export const structurerEtatFinancier: Structureur = async (ctx) => {
  const { document, pages, db, auth } = ctx;
  const clientId = document.client_id;
  const parametres = parametresSchema.safeParse(document.parametres);
  if (clientId === null || !parametres.success) throw new ErreurIngestion("ETAT_INVALIDE");
  const p = parametres.data;
  try {
    await exigerDossierVisible(db, auth, clientId);
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) {
      throw new ErreurIngestion("DOSSIER_INACCESSIBLE");
    }
    throw error;
  }
  const decimales = DECIMALES_DEVISE[p.devise];
  const textes = pages.map((x) => ({ numero: x.numero, texte: x.texte }));
  const excel = document.format === "xlsx";
  const pagesOcr: PagesOcr = new Map(
    excel
      ? []
      : pages
          .filter((x) => METHODES_OCR.includes(x.methode))
          .map((x) => [x.numero, x.confiance_pm]),
  );
  let extraction: ExtractionEtat;
  /** Extraction faite sur le texte brut, rejets du modèle compris : base des corrections OCR proposées. */
  let pourCorrections: ExtractionEtat | null = null;
  let tronque = false;
  try {
    if (excel) {
      extraction = extraireEtatDepuisTableau(
        lignesDeTexteTableur(pages[0]?.texte ?? ""),
        decimales,
      );
    } else {
      const texte = preparerTexteModele(textes, {
        max: PLAFONDS_INGESTION.caracteresTransmisAuModele,
        motsCles: MOTS_CLES,
      });
      const ia =
        texte.texte.length === 0
          ? { lignes: null }
          : await demanderLignesIa({
              database: ctx.database,
              deps: ctx.deps.ia,
              auth,
              promptNom: NOM_PROMPT_ETAT_LIGNES,
              assurerPrompt: assurerPromptEtat,
              variables: {
                contexte: `Devise : ${p.devise} (${decimales} décimale(s)). Exercice : ${p.exercice}.`,
                pages: texte.texte,
              },
              variablesNonFiables: ["pages"],
              entite: { type: "ingestion_document", id: document.id },
            });
      const proposee = ia.lignes === null ? null : lireLignesEtatIa(ia.lignes, textes, decimales);
      if (proposee !== null && proposee.lignes.length > 0) {
        extraction = proposee;
        tronque = texte.tronque;
      } else {
        extraction = extraireEtatParRegles(textes, decimales);
      }
      if (pagesOcr.size > 0) {
        pourCorrections = {
          lignes: extraction.lignes,
          rejets: [
            ...extraction.rejets,
            ...(extraction === proposee ? [] : (proposee?.rejets ?? [])),
          ],
        };
      }
    }
  } catch (error) {
    // Paramètres hors bornes pour le moteur (décimales…) : le document n'est pas exploitable.
    if (error instanceof ErreurDossier) throw new ErreurIngestion("ETAT_INVALIDE");
    throw error;
  }
  // Corrections OCR proposées : inscrites pendant la structuration (le document est encore `structuration`).
  let corrections: CorrectionOcr[] | null = null;
  if (pourCorrections !== null) {
    try {
      corrections = validerCorrections(
        proposerCorrectionsOcr(textes, pourCorrections, decimales).filter((c) =>
          pagesOcr.has(c.page),
        ),
      );
    } catch (error) {
      if (error instanceof ErreurDossier) throw new ErreurIngestion("ETAT_INVALIDE");
      throw error;
    }
  }
  await db.query("UPDATE ingestion_documents SET corrections_ocr = $2::jsonb WHERE id = $1", [
    document.id,
    corrections === null ? null : JSON.stringify(corrections),
  ]);
  if (extraction.lignes.length === 0) return { resultat: "rien_trouve" };

  const entete: EnTeteEtat = {
    exercice: p.exercice,
    date_cloture: p.date_cloture,
    devise: p.devise,
    tolerance: p.tolerance,
    source_libelle:
      `${excel ? "Extraction Excel (liasse)" : "Extraction PDF"} : ${document.nom}`.slice(0, 300),
  };
  const forcerRevue =
    forcerRevueEtat(extraction, {
      ocr: document.methode !== "texte" && document.methode !== "tableur",
    }) || tronque;
  await db.query("SAVEPOINT ingestion_etat");
  try {
    const etat = await ingererEtat(
      db,
      auth,
      clientId,
      entete,
      lignesPourEtat(extraction, document.nom, excel, pagesOcr),
      excel ? "excel" : "pdf",
      { nom: document.nom, sha256: document.sha256, taille: document.taille },
      { forcerRevue },
    );
    await db.query("RELEASE SAVEPOINT ingestion_etat");
    return { resultat: "etat_cree", etat_financier_id: etat.id };
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT ingestion_etat");
    // Erreur du moteur, date incohérente, dossier plein, contrainte : état inexploitable (échec définitif).
    if (error instanceof ErreurDossier || error instanceof AppError) {
      throw new ErreurIngestion("ETAT_INVALIDE");
    }
    throw error;
  }
};

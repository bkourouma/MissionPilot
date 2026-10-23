import { lirePropositionIa, preparerTexteModele } from "@missionpilot/engines";
import { PLAFONDS_INGESTION, contenuPropositionSchema } from "@missionpilot/shared";
import { BORNES_NOMS_INGESTION, termesNomsPropres } from "../copilote/noms-propres.js";
import { neutraliserContenuClient } from "../ia/donnees-non-fiables.js";
import { creerBrouillon } from "./extractions.js";
import { demanderLignesIa, lignesSansTermes } from "./ia-lignes.js";
import { lireMethode, lireVersion } from "../standard/contenu.js";
import { assurerPromptStandard, NOM_PROMPT_STANDARD_PROPOSITION } from "./prompts-standard.js";
import type { Structureur } from "./structuration.js";

/*
 * Structuration d'un document historique du cabinet (STD-13, ADR-009 décision 10) : le texte des pages est
 * confié à l'IA, qui PROPOSE des étapes, briques, éléments et rubriques génériques ; `lirePropositionIa`
 * (moteur) relit les lignes (format, bornes, pages citées) et le résultat devient un BROUILLON
 * (`standard_proposition`) que les experts corrigent puis valident. Rien n'est appliqué à la méthode ici.
 *
 * - IA indisponible (droit `ia.utiliser` de l'auteur, IA désactivée, plafond, panne) : `ia_indisponible`,
 *   rien n'est inventé ; une relance reste possible (routes).
 * - Aucune ligne retenue : `rien_trouve`.
 * - Un brouillon déjà ouvert pour ce document n'est jamais recréé (ni l'IA rappelée).
 * - FIN-02 : une proposition d'amorçage ne porte NI taux NI honoraires. `lirePropositionIa` (moteur) rejette
 *   les lignes qui en contiennent (`contientDonneeFinanciere`, motif `donnee_financiere`).
 * - MASQUAGE DES NOMS (décision du 2026-10-22) : les noms de personnes et de clients connus du cabinet qui
 *   figurent dans le texte envoyé sont remplacés par des jetons avant l'appel (`termesSensibles`) ; la sortie
 *   étant démasquée, toute ligne contenant un de ces noms est ÉCARTÉE : le standard ne contient aucun nom de
 *   client. Aucun nom dans les journaux.
 * - Une proposition de standard ne porte aucun chiffre : `chiffres_non_verifies` vaut toujours faux.
 */

const MOTS_CLES = [
  "mission",
  "etape",
  "phase",
  "livrable",
  "gabarit",
  "methodologie",
  "approche",
  "diagnostic",
  "calendrier",
  "rapport",
];

export const structurerStandard: Structureur = async (ctx) => {
  const { document, pages, db, auth } = ctx;
  const ouvert = await db.query(
    `SELECT 1 FROM ingestion_extractions WHERE document_id = $1 AND statut IN ('brouillon_ia', 'modifie')`,
    [document.id],
  );
  if (ouvert.rows[0]) return { resultat: "brouillon_cree" };

  const textes = pages.map((p) => ({ numero: p.numero, texte: p.texte }));
  const texte = preparerTexteModele(textes, {
    max: PLAFONDS_INGESTION.caracteresTransmisAuModele,
    motsCles: MOTS_CLES,
  });
  if (texte.texte.length === 0) return { resultat: "rien_trouve" };

  // Code (forme contrôlée) de la méthode cible : seul élément de confiance ajouté au prompt.
  let methode = "";
  if (document.version_methode_id) {
    const version = await lireVersion(db, document.version_methode_id);
    methode = `Méthode cible : ${(await lireMethode(db, version.methode_id)).code}.`;
  }

  // Noms du cabinet présents dans le texte (neutralisé d'abord, comme le fait l'orchestrateur) : masqués à l'envoi.
  const { termes } = await termesNomsPropres(
    db,
    document.cabinet_id,
    neutraliserContenuClient(texte.texte),
    BORNES_NOMS_INGESTION,
  );

  const ia = await demanderLignesIa({
    database: ctx.database,
    deps: ctx.deps.ia,
    auth,
    promptNom: NOM_PROMPT_STANDARD_PROPOSITION,
    assurerPrompt: assurerPromptStandard,
    variables: { methode, pages: texte.texte },
    variablesNonFiables: ["pages"],
    entite: { type: "ingestion_document", id: document.id },
    termesSensibles: termes,
  });
  if (ia.lignes === null) return { resultat: "ia_indisponible" };

  const { contenu } = lirePropositionIa(lignesSansTermes(ia.lignes, termes), textes);
  const total =
    contenu.etapes.length +
    contenu.briques.length +
    contenu.elements.length +
    contenu.rubriques.length;
  if (total === 0) return { resultat: "rien_trouve" };
  // Garde-fou : le contenu relu par le moteur doit satisfaire le schéma partagé (sinon rien n'est retenu).
  const valide = contenuPropositionSchema.safeParse({ ...contenu, tronque: texte.tronque });
  if (!valide.success) return { resultat: "rien_trouve" };

  await creerBrouillon(db, document, {
    nature: "standard_proposition",
    contenu: valide.data,
    iaDemandeId: ia.demandeId,
    chiffresNonVerifies: false,
  });
  return { resultat: "brouillon_cree" };
};

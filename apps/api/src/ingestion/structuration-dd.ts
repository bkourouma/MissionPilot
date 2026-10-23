import { contientNonVerifie, lireLecturesIa, preparerTexteModele } from "@missionpilot/engines";
import { LIBELLES_USAGE_INGESTION, PLAFONDS_INGESTION } from "@missionpilot/shared";
import { AppError } from "../errors.js";
import { creerBrouillon } from "./extractions.js";
import { demanderLignesIa } from "./ia-lignes.js";
import { assurerPromptLecture, NOM_PROMPT_LECTURE_DOCUMENT } from "./prompts-lecture.js";
import type { Structureur } from "./structuration.js";

/*
 * Structuration des usages `dd_rapport` et `dd_salle` (DD-02, DD-10 ; ADR-009 décision 9) : l'IA lit le texte
 * des pages et PROPOSE un résumé et des éléments (fait, risque, chiffre, engagement, autre), chacun avec sa
 * page et un extrait recopié. Le moteur (`lireLecturesIa`) vérifie que l'extrait et chaque nombre cité se
 * retrouvent dans la page ; un élément non retrouvé est gardé avec `verifie: false`.
 *
 * - Sans IA (désactivée, sans clé, sans `ia.utiliser` de l'auteur, plafond, sortie inexploitable) :
 *   `ia_indisponible`, rien n'est inventé ; la lecture est relançable (route de relance).
 * - Aucun résumé ni élément retenu : `rien_trouve`.
 * - Sinon un brouillon `lecture_document` ; le drapeau « chiffres non vérifiés » vient de NOTRE contrôle de
 *   source (`verifie` des éléments), pas du garde-chiffres de l'orchestrateur (les nombres du document ne
 *   sont pas dans sa liste blanche).
 * - Un brouillon déjà ouvert n'est jamais écrasé ni doublé.
 */

const MOTS_CLES = ["risque", "engagement", "garantie", "litige", "total", "chiffre d'affaires"];

export const structurerDd: Structureur = async (ctx) => {
  const { document, pages, db, auth } = ctx;
  const textes = pages.map((p) => ({ numero: p.numero, texte: p.texte }));
  const texte = preparerTexteModele(textes, {
    max: PLAFONDS_INGESTION.caracteresTransmisAuModele,
    motsCles: MOTS_CLES,
  });
  if (texte.texte.length === 0) return { resultat: "rien_trouve" };

  const ia = await demanderLignesIa({
    database: ctx.database,
    deps: ctx.deps.ia,
    auth,
    promptNom: NOM_PROMPT_LECTURE_DOCUMENT,
    assurerPrompt: assurerPromptLecture,
    variables: {
      type_document: LIBELLES_USAGE_INGESTION[document.usage],
      pages: texte.texte,
    },
    variablesNonFiables: ["pages"],
    entite: { type: "ingestion_document", id: document.id },
  });
  if (ia.lignes === null) return { resultat: "ia_indisponible" };

  const { contenu } = lireLecturesIa(ia.lignes, textes);
  if (contenu.resume.length === 0 && contenu.elements.length === 0) {
    return { resultat: "rien_trouve" };
  }
  const complet = { ...contenu, tronque: texte.tronque };
  try {
    await creerBrouillon(db, document, {
      nature: "lecture_document",
      contenu: complet,
      iaDemandeId: ia.demandeId,
      chiffresNonVerifies: contientNonVerifie(complet),
    });
  } catch (error) {
    // Un brouillon est déjà ouvert : rien n'est recréé.
    if (!(error instanceof AppError && error.code === "EXTRACTION_OUVERTE")) throw error;
  }
  return { resultat: "brouillon_cree" };
};

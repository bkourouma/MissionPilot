import type { ModuleLot } from "./commun.js";
import { semerDerogations } from "./standard-derogations.js";
import { semerDictionnaire } from "./standard-dictionnaire.js";
import { semerMethodes } from "./standard-methodes.js";
import { semerLiaisons } from "./standard-missions.js";
import { semerPropositionsDerogations } from "./standard-capitalisation.js";
import { semerPropositions } from "./standard-propositions.js";

/*
 * Module « standard » de la phase ia-qualite-standard : STANDARD ET MÉTHODES du cabinet.
 * Exécuté EN PREMIER de la phase, par les vraies routes (routes/standard.ts) :
 *   1. dictionnaire du cabinet, facteurs de contexte et notes (STD-04, STD-06, STD-10) ;
 *   2. méthodes propres (due diligence, redressement), variantes du standard (plan stratégique en
 *      deux versions, diagnostic flash), brouillons laissés en cours (notation, pilotage des KPI) ;
 *   3. mission figée sur sa méthode (STD-08), migration de la variante du plan de Baobab ;
 *   4. dérogations (STD-07) de statuts variés, avec leurs validations selon la classe de risque ;
 *   5. propositions d'évolution du standard (STD-12) à tous les stades du circuit, dont celles tirées
 *      des dérogations fréquentes (CAP-05, standard-capitalisation.ts).
 * Aucune mission n'est clôturée ici. Amorçage depuis un document (routes/ingestion-standard.ts) : non
 * semé, il exige un téléversement PDF/XLSX suivi d'une extraction (OCR) et d'une structuration par
 * un job asynchrone, hors du périmètre d'un seed sans réseau ni worker.
 * Idempotent : chaque objet est retrouvé par sa clé naturelle (code, mission + brique, titre).
 */
export const semerStandard: ModuleLot = async (ctx) => {
  await semerDictionnaire(ctx);
  await semerMethodes(ctx);
  await semerLiaisons(ctx);
  await semerDerogations(ctx);
  await semerPropositions(ctx);
  await semerPropositionsDerogations(ctx);
};

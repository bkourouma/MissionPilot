import { composerBrief, type BriefCompose, type SourceBrief } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { creerContexte, type Extracteur } from "./commun.js";
import {
  atterrissagesDepasses,
  facturesEchues,
  feuillesNonSoumises,
  jalonsEnRetard,
  kpisQuiDerivent,
  questionnairesSansReponse,
  tachesEnRetard,
} from "./derives.js";
import {
  cloturesEnAttente,
  congesAValider,
  deboursAValider,
  facturesAApprouver,
  feuillesAValider,
  propositionsAValider,
  retoursAValider,
} from "./decisions.js";
import {
  demandesSalleAEnvoyer,
  facturesAEmettre,
  facturesAEnvoyer,
  livrablesSignes,
  propositionsAEnvoyer,
  relancesPretes,
} from "./envois.js";
import {
  brouillonsAutomatisation,
  derogationsAAccorder,
  livrablesARelire,
  livrablesASigner,
  notationsAPublier,
  piecesAExaminer,
} from "./validations.js";

/*
 * Brief quotidien d'un utilisateur (AUT-07) : calcul DÉTERMINISTE, aucun appel IA. Chaque source
 * est consultée dans les droits de l'utilisateur ; le moteur du brief compose le résultat. Les
 * sources sont lues l'une après l'autre : une transaction ne porte qu'une requête à la fois.
 */

/** Sources dans l'ordre de lecture ; l'ordre du résultat est celui du moteur, pas celui-ci. */
export const EXTRACTEURS_BRIEF: readonly Extracteur[] = [
  // À décider
  facturesAApprouver,
  deboursAValider,
  feuillesAValider,
  congesAValider,
  propositionsAValider,
  notationsAPublier,
  livrablesARelire,
  livrablesASigner,
  derogationsAAccorder,
  piecesAExaminer,
  brouillonsAutomatisation,
  retoursAValider,
  cloturesEnAttente,
  // Ça dérive
  kpisQuiDerivent,
  atterrissagesDepasses,
  facturesEchues,
  jalonsEnRetard,
  tachesEnRetard,
  feuillesNonSoumises,
  questionnairesSansReponse,
  // Prêt à envoyer
  propositionsAEnvoyer,
  facturesAEmettre,
  facturesAEnvoyer,
  relancesPretes,
  demandesSalleAEnvoyer,
  livrablesSignes,
];

/**
 * Brief de `auth` à la date de référence (AAAA-MM-JJ), dans la transaction reçue (RLS du
 * cabinet). L'appelant a vérifié la permission `brief.lire`.
 */
export async function calculerBrief(db: Db, auth: Auth, date: string): Promise<BriefCompose> {
  const contexte = creerContexte(db, auth, date);
  const sources: SourceBrief[] = [];
  for (const extraire of EXTRACTEURS_BRIEF) {
    const source = await extraire(contexte);
    if (source) sources.push(source);
  }
  return composerBrief({ date_reference: date, sources });
}

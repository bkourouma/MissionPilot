import type { ContexteTenantDemo } from "../contexte.js";
import { semerNotesMboa } from "./dd-notes-mboa.js";
import { semerNotesWouri } from "./dd-notes-wouri.js";
import { semerPortailMboa } from "./dd-portail.js";

/*
 * Due diligence, seconde moitié : notes, validations, note au comité et portail investisseur
 * (missions 4 et 11). Appelé par `due-diligence.ts` APRÈS `semerDdDossiers`, dont il retrouve les
 * dossiers par les routes.
 *
 *   1. Mission 4 « Due diligence — Mboa Solaire » : quatre notes par thème et la note au comité
 *      (recommandation « réservée » : trois hypothèses infirmées) rédigées par les consultants,
 *      validées par des tiers (dd-notes-mboa.ts) ;
 *   2. publication de la note validée au portail investisseur avec ses rapports, retrait,
 *      correction et republication (dd-portail.ts) ;
 *   3. mission 11 « Due diligence — Wouri Distribution » : deux brouillons, version 1
 *      (dd-notes-wouri.ts).
 * Tout passe par les routes `/api/dd/**` et `/api/portail/**` ; les dates sont antidatées au
 * calendrier des missions (dd-notes-outils.ts).
 */
export async function semerDdNotes(ctx: ContexteTenantDemo): Promise<void> {
  const mboa = await semerNotesMboa(ctx);
  await semerPortailMboa(ctx, mboa);
  await semerNotesWouri(ctx);
}

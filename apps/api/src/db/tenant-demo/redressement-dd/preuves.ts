import type { ContexteTenantDemo } from "../contexte.js";
import { etape } from "./commun.js";
import { REGISTRE_SICAFE } from "./preuves-donnees-1.js";
import { REGISTRE_BRASSERIES } from "./preuves-donnees-2.js";
import { REGISTRE_MBOA } from "./preuves-donnees-3.js";
import { REGISTRE_SAHEL_COTON } from "./preuves-donnees-4.js";
import { REGISTRE_ATLANTIQUE } from "./preuves-donnees-5.js";
import { semerDossierMissions } from "./preuves-dossier.js";
import { semerRegistreMission } from "./preuves-ecriture.js";

/*
 * Preuves, assertions et dossier client des missions 1 à 5 du Tenant démo (PRV-01 à PRV-05, DOS-01
 * à DOS-07), par les VRAIES routes de l'API, avec les comptes qui ont `preuve.ecrire` et
 * `dossier.ecrire` répartis entre auteurs, arbitres et valideurs.
 *
 * - registre des preuves de chaque mission : dimensions, 7 à 8 preuves de types variés avec une
 *   révision (version 2), assertions « pour » et « contre », contradictions arbitrées par un
 *   compte différent des auteurs, avis d'expert signé par un associé (preuves-donnees-*.ts) ;
 * - la mission 4 (Due diligence — Mboa Solaire) porte six assertions « Mboa Solaire : … » que le
 *   lot de la due diligence lit pour y rattacher ses hypothèses ;
 * - dossier client : faits proposés puis confirmés ou rejetés par un autre compte, facteurs de
 *   contexte, exports (preuves-dossier.ts). La mission 11 n'est pas touchée.
 *
 * Les missions restent OUVERTES pendant la phase : aucune réouverture. Chaque bloc est une étape
 * marquée (`etape`) : une phase déjà faite n'est pas rejouée.
 */
export async function semerPreuves(ctx: ContexteTenantDemo): Promise<void> {
  const registres = [
    REGISTRE_SICAFE,
    REGISTRE_SAHEL_COTON,
    REGISTRE_BRASSERIES,
    REGISTRE_MBOA,
    REGISTRE_ATLANTIQUE,
  ];
  for (const def of registres) {
    await etape(ctx, `preuves:registre:${def.mission}`, () => semerRegistreMission(ctx, def));
  }
  await etape(ctx, "preuves:dossier-client", () => semerDossierMissions(ctx));
}

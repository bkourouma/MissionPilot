import { assurerAbsences } from "./absences.js";
import { assurerClients } from "./clients.js";
import {
  assurerCabinet,
  assurerComptesCabinet,
  assurerComptesPortail,
  marquerCabinetTenant,
} from "./comptes.js";
import type { ContexteTenantDemo } from "./contexte.js";
import { assurerCollaborateurs } from "./equipe.js";
import { assurerParametres } from "./parametres.js";

/*
 * SOCLE du cabinet « Tenant démo » : tout ce dont les phases de domaine ont besoin, rien de
 * plus (aucune mission, aucun temps, aucune facture : ce sont les phases).
 *
 * `semerSocle(ctx)` est IDEMPOTENT par clé naturelle (e-mail, code de grade, raison sociale,
 * nom de collaborateur) : cabinet déjà présent = rien n'est dupliqué, le contexte est simplement
 * rempli à nouveau (c'est ce qui permet de relancer les phases). Étapes, dans l'ordre :
 *
 *   1. cabinet « Tenant démo » + associé fondateur (`creer_cabinet`), drapeau `est_demo` posé par
 *      UPDATE du rôle propriétaire sur CE cabinet seulement (refus net si l'adresse fondatrice
 *      appartient à un autre cabinet), cabinet antidaté à octobre 2024 ;
 *   2. 19 comptes du cabinet (2 au moins par rôle de `ROLES`) invités puis acceptés par les
 *      vraies routes, sessions ouvertes ;
 *   3. paramètres : cabinet (pays, devise, unité de temps), grades et barèmes (taux de vente par
 *      grade), catalogue de services de conseil (types de mission), temps (contrôle de capacité,
 *      activités internes), calendrier (jours fériés 2024 à 2027), mentions légales de facturation ;
 *   4. collaborateurs de tous les types (interne, externe, sous-traitant), tous les grades, coûts
 *      journaliers datés, compétences, secteurs, langues, capacités (temps partiel), un inactif ;
 *   5. absences (congés, maladie, formation, autre ; validées, refusées, demandées, annulées) ;
 *   6. clients : 12 entreprises (CI, SN, CM, BF, ML, GA, FR), contacts, taux négociés, groupes
 *      (participations), dossiers client (faits) ;
 *   7. comptes du portail client (3 rôles, 2 comptes chacun, rattachés à des clients).
 *
 * En sortie, `ctx` est COMPLET : `cabinetId`, `sessions`, `comptes`, `utilisateurs`,
 * `collaborateurs`, `clients`, `dossiers`, `grades`, `typesMission`.
 */

export interface ResumeSocle {
  cabinetId: string;
  /** Vrai si le cabinet a été créé par cette exécution. */
  cabinetCree: boolean;
  comptes: number;
  collaborateurs: number;
  clients: number;
}

export async function semerSocle(ctx: ContexteTenantDemo): Promise<ResumeSocle> {
  const cabinetCree = await assurerCabinet(ctx);
  ctx.journal(`${cabinetCree ? "Création" : "Reprise"} du cabinet « Tenant démo ».`);
  await marquerCabinetTenant(ctx);
  await assurerComptesCabinet(ctx);
  await assurerParametres(ctx);
  await assurerCollaborateurs(ctx);
  await assurerAbsences(ctx);
  await assurerClients(ctx);
  await assurerComptesPortail(ctx);
  return {
    cabinetId: ctx.cabinetId,
    cabinetCree,
    comptes: Object.keys(ctx.comptes).length,
    collaborateurs: Object.keys(ctx.collaborateurs).length,
    clients: Object.keys(ctx.clients).length,
  };
}

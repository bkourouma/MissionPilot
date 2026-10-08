import { journaliser } from "../audit.js";
import type { HandlerJob } from "../jobs/registre.js";

/*
 * Conservation des générations IA (migration 0104). Le texte démasqué d'une
 * génération n'est gardé que `ia_parametres_cabinet.conservation_jours` jours
 * (365 par défaut, 30 à 3 650) après la DERNIÈRE version de la demande ; passé
 * ce délai, le job « ia_conservation » l'anonymise (texte vidé, données et
 * nombres effacés), tout le reste de la trace est conservé.
 *
 * Job planifié par cabinet et par jour (planificateur.ts, clé unique), pour
 * les seuls cabinets ayant une demande échue. L'horloge est celle du worker
 * (injectable en test). L'anonymisation passe par `purger_textes_ia`
 * (SECURITY DEFINER, limitée au cabinet du contexte) : le rôle applicatif
 * n'a aucun droit de modifier `ia_generations`.
 */

export const TYPE_JOB_CONSERVATION_IA = "ia_conservation";
export const CONSERVATION_IA_JOURS_DEFAUT = 365;
const LOT_PURGE = 1000;
const LOTS_MAX = 50;

export function planificationConservationIa(maintenant: Date): { cle: string; executeA: Date } {
  return {
    cle: `ia_conservation:${maintenant.toISOString().slice(0, 10)}`,
    executeA: maintenant,
  };
}

export function creerHandlerConservationIa(): HandlerJob {
  return async ({ db, cabinetId, maintenant }) => {
    let total = 0;
    for (let i = 0; i < LOTS_MAX; i++) {
      const r = await db.query("SELECT purger_textes_ia($1, $2) AS n", [maintenant, LOT_PURGE]);
      const n = r.rows[0].n as number;
      total += n;
      if (n < LOT_PURGE) break;
    }
    if (total > 0) {
      await journaliser(db, {
        cabinetId,
        utilisateurId: null,
        action: "purge_textes_ia",
        entite: "ia_generation",
        details: { versions: total, a: maintenant.toISOString() },
      });
    }
  };
}

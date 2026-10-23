import { agregerTresorerieMensuelle } from "@missionpilot/engines";
import type { RedTresorerieMensuelleVue } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import type { DossierRed } from "./acces.js";
import { projectionCourante } from "./tresorerie.js";

/*
 * Vue mensuelle de la trésorerie (RED-06, lot 2) : aucune table, aucun journal. La projection
 * hebdomadaire de la version courante (réalisés compris) est agrégée par mois civil du lundi par le
 * moteur `agregerTresorerieMensuelle` ; l'API ne fait aucune addition.
 */
export async function lireTresorerieMensuelle(
  db: Db,
  dossier: DossierRed,
): Promise<RedTresorerieMensuelleVue> {
  const courant = await projectionCourante(db, dossier.id);
  if (!courant) return { version: null, mensuel: null };
  const m = agregerTresorerieMensuelle(courant.projection);
  return {
    version: {
      id: courant.version.id,
      version: courant.version.version,
      date_debut: courant.version.date_debut,
      seuil_tension: courant.version.seuil_tension,
    },
    mensuel: {
      mois: m.mois.map((x) => ({
        mois: x.mois,
        semaines: [...x.semaines],
        debut: x.debut,
        fin: x.fin,
        partiel: x.partiel,
        semaines_realisees: x.semainesRealisees,
        encaissements: x.encaissements,
        decaissements: x.decaissements,
        flux_net: x.fluxNet,
        solde_ouverture: x.soldeOuverture,
        solde_fin: x.soldeFin,
        solde_minimum: { semaine: x.soldeMinimum.semaine, montant: x.soldeMinimum.montant },
        tension: x.tension,
        semaines_tension: [...x.semainesTension],
      })),
      mois_tension: [...m.moisTension],
      premier_mois_tension: m.premierMoisTension,
      solde_minimum: {
        mois: m.soldeMinimum.mois,
        semaine: m.soldeMinimum.semaine,
        montant: m.soldeMinimum.montant,
      },
      totaux: {
        encaissements: m.totaux.encaissements,
        decaissements: m.totaux.decaissements,
        flux_net: m.totaux.fluxNet,
      },
    },
  };
}

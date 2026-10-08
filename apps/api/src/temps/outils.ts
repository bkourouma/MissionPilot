import {
  ajouterJours,
  arrondiEntier,
  depuisCentiemes,
  estDateSaisieModifiable,
  estPasValide,
  lundiDeLaSemaine,
  SEUILS_SUIVI_DEFAUT,
  sommerHeuresEnJours,
  sommerJours,
  type Granularite,
  type SeuilsSuivi,
} from "@missionpilot/engines";
import {
  aPermission,
  SEUIL_CONSOMMATION_DEFAUT_PCT,
  type ControleCapacite,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import { estAssocie } from "../missions/acces.js";

/** Paramètres de saisie des temps d'un cabinet (SOC-04, TPS-01, TPS-07). */
export interface ParametresTemps {
  granularite: Granularite;
  heuresParJour: number;
  controleCapacite: ControleCapacite;
  seuilConsommationPct: number;
}

export async function lireParametresTemps(db: Db, cabinetId: string): Promise<ParametresTemps> {
  const r = await db.query(
    `SELECT c.unite_saisie_temps, c.heures_par_jour::float8 AS heures,
       coalesce(p.controle_capacite, 'signaler') AS controle_capacite,
       coalesce(p.seuil_consommation_pct, $2) AS seuil
     FROM cabinets c LEFT JOIN parametres_temps p ON p.cabinet_id = c.id
     WHERE c.id = $1`,
    [cabinetId, SEUIL_CONSOMMATION_DEFAUT_PCT],
  );
  const l = r.rows[0] as
    | {
        unite_saisie_temps: Granularite;
        heures: number;
        controle_capacite: ControleCapacite;
        seuil: number;
      }
    | undefined;
  return {
    granularite: l?.unite_saisie_temps ?? "demi_journee",
    heuresParJour: l?.heures ?? 8,
    controleCapacite: l?.controle_capacite ?? "signaler",
    seuilConsommationPct: Number(l?.seuil ?? SEUIL_CONSOMMATION_DEFAUT_PCT),
  };
}

/** Seuils de couleur du moteur, avec le seuil de consommation du cabinet. */
export function seuilsSuivi(p: Pick<ParametresTemps, "seuilConsommationPct">): SeuilsSuivi {
  return { ...SEUILS_SUIVI_DEFAUT, consommationOrangePct: p.seuilConsommationPct };
}

/* ----- Unités ----- */

/** Centièmes de jour stockés → jours. */
export const jours = (centiemes: unknown): number => depuisCentiemes(Number(centiemes));

/** Valeur saisie en jours (cabinet à la demi-journée) ou en heures (cabinet à l'heure). */
export interface SaisieDuree {
  jours?: number | undefined;
  heures?: number | undefined;
}

/**
 * Contrôle l'unité de saisie du cabinet et le pas : demi-journée → `jours`
 * multiples de 0,5 ; heure → `heures` en minutes entières.
 */
export function exigerUniteDuCabinet(s: SaisieDuree, p: ParametresTemps, quoi: string): void {
  if (p.granularite === "demi_journee") {
    if (s.jours === undefined) {
      throw requeteInvalide(`${quoi} : le cabinet saisit les temps en jours (pas de 0,5).`);
    }
    if (!estPasValide(s.jours, "demi_journee")) {
      throw requeteInvalide(`${quoi} : les temps se saisissent à la demi-journée (pas de 0,5).`);
    }
    return;
  }
  if (s.heures === undefined) {
    throw requeteInvalide(`${quoi} : le cabinet saisit les temps en heures.`);
  }
  if (Math.abs(s.heures * 60 - arrondiEntier(s.heures * 60)) > 1e-6) {
    throw requeteInvalide(`${quoi} : les heures doivent correspondre à des minutes entières.`);
  }
}

/** Minutes entières d'une saisie en heures. */
export const minutesDe = (heures: number): number => arrondiEntier(heures * 60);

/**
 * Valeur en jours d'une case : en heures, la somme des heures est convertie
 * une seule fois par le moteur (`sommerHeuresEnJours`).
 */
export function joursDeSaisies(saisies: readonly SaisieDuree[], p: ParametresTemps): number {
  if (p.granularite === "heure") {
    return sommerHeuresEnJours(
      saisies.map((s) => s.heures ?? 0),
      p.heuresParJour,
    );
  }
  return sommerJours(saisies.map((s) => s.jours ?? 0));
}

/* ----- Semaines et périodes ----- */

export const semaineDe = (date: string) => {
  const debut = lundiDeLaSemaine(date);
  return { debut, fin: ajouterJours(debut, 6) };
};

/** Mois clôturés du cabinet (`AAAA-MM`). */
export async function moisClotures(db: Db): Promise<string[]> {
  const r = await db.query(
    "SELECT mois FROM periodes_temps WHERE statut = 'cloturee' ORDER BY mois",
  );
  return r.rows.map((l) => l.mois as string);
}

/** Refuse (409 PERIODE_CLOTUREE) toute date d'une période clôturée (moteur). */
export function exigerDatesModifiables(dates: Iterable<string>, clotures: readonly string[]): void {
  const fermees = [...new Set(dates)].filter(
    (d) => !estDateSaisieModifiable(d, { moisClotures: clotures }),
  );
  if (fermees.length > 0) {
    throw new AppError(
      409,
      "PERIODE_CLOTUREE",
      `Période de temps clôturée (${fermees.sort().join(", ")}) : passer par une demande de correction.`,
    );
  }
}

/* ----- Droits ----- */

/** Décide des activités internes : associé, ou validateur qui voit tout le cabinet. */
export const valideInterne = (auth: Auth): boolean =>
  estAssocie(auth) ||
  (aPermission(auth.roles, "temps.valider") && aPermission(auth.roles, "mission.lire_toutes"));

/** Voit toutes les feuilles de temps du cabinet (associé, directeur de mission). */
export const voitToutesLesFeuilles = valideInterne;

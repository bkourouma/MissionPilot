import { analyserDateISO, dateISODepuisJourUTC, type DateISO } from "../commun/dates";
import { ErreurAppelsOffres } from "./commun";

/**
 * Rétro-planning de réponse et alertes avant la date limite (AO-08) ; cycle de vie d'une fiche.
 *
 * Rétro-planning : étapes standard placées à rebours de la date limite (`joursAvantLimite`).
 * Si le temps restant est plus court que la plus longue des avances, toutes les avances sont
 * COMPRESSÉES proportionnellement (plancher), de sorte qu'aucune étape ne tombe avant le jour
 * de génération ni après la date limite, et que l'ordre des étapes est conservé.
 *
 * Alertes : pour une fiche encore ouverte (détectée, en go/no-go, en réponse), niveau selon les
 * jours restants (« depassee » < 0 ≤ « j1 » ≤ 1 < « j3 » ≤ 3 < « j7 » ≤ 7) ; étapes non faites
 * en retard ou du jour. La date du jour est TOUJOURS un paramètre.
 */

export const STATUTS_APPEL_OFFRES = [
  "detecte",
  "go_no_go",
  "en_reponse",
  "depose",
  "gagne",
  "perdu",
  "no_go",
] as const;
export type StatutAppelOffres = (typeof STATUTS_APPEL_OFFRES)[number];

/** Transitions admises (doublées en base par le déclencheur de la migration 0360). */
export const TRANSITIONS_APPEL_OFFRES: Readonly<
  Record<StatutAppelOffres, readonly StatutAppelOffres[]>
> = {
  detecte: ["go_no_go"],
  go_no_go: ["en_reponse", "no_go"],
  en_reponse: ["depose", "no_go"],
  depose: ["gagne", "perdu"],
  gagne: [],
  perdu: [],
  no_go: [],
};

/** Statuts où la réponse est encore en préparation (alertes, rétro-planning, matrice modifiable). */
export const STATUTS_AO_OUVERTS: readonly StatutAppelOffres[] = [
  "detecte",
  "go_no_go",
  "en_reponse",
];

export function transitionAppelOffresAutorisee(
  de: StatutAppelOffres,
  vers: StatutAppelOffres,
): boolean {
  return TRANSITIONS_APPEL_OFFRES[de].includes(vers);
}

export interface EtapeModele {
  code: string;
  libelle: string;
  joursAvantLimite: number;
}

export const ETAPES_RETROPLANNING_STANDARD: readonly EtapeModele[] = [
  { code: "decision_go", libelle: "Décision go/no-go de l'associé", joursAvantLimite: 21 },
  {
    code: "analyse_dossier",
    libelle: "Analyse du dossier et matrice de conformité",
    joursAvantLimite: 18,
  },
  { code: "equipe_cv", libelle: "Constitution de l'équipe et des CV", joursAvantLimite: 14 },
  { code: "offre_technique", libelle: "Premier jet de l'offre technique", joursAvantLimite: 10 },
  { code: "offre_financiere", libelle: "Offre financière", joursAvantLimite: 8 },
  { code: "revue_qualite", libelle: "Revue qualité de l'offre", joursAvantLimite: 5 },
  {
    code: "pieces_administratives",
    libelle: "Pièces administratives et signatures",
    joursAvantLimite: 3,
  },
  { code: "depot", libelle: "Dépôt de l'offre", joursAvantLimite: 1 },
];

export interface EtapePlanifiee {
  ordre: number;
  code: string;
  libelle: string;
  datePrevue: DateISO;
}

export interface RetroPlanning {
  etapes: EtapePlanifiee[];
  joursDisponibles: number;
  compresse: boolean;
}

function jour(date: string, quoi: string): number {
  const a = analyserDateISO(date);
  if (!a.valide) throw new ErreurAppelsOffres("DATE_INVALIDE", `${quoi} invalide.`);
  return a.jourUTC;
}

/** Étapes datées à rebours de la date limite. */
export function retroPlanning(
  dateLimite: DateISO,
  aujourdhui: DateISO,
  modele: readonly EtapeModele[] = ETAPES_RETROPLANNING_STANDARD,
): RetroPlanning {
  const limite = jour(dateLimite, "Date limite");
  const debut = jour(aujourdhui, "Date du jour");
  const disponibles = limite - debut;
  if (disponibles <= 0) {
    throw new ErreurAppelsOffres(
      "DATE_LIMITE_PASSEE",
      "La date limite est atteinte : aucun rétro-planning possible.",
    );
  }
  if (
    modele.length === 0 ||
    !modele.every((e) => Number.isSafeInteger(e.joursAvantLimite) && e.joursAvantLimite >= 0)
  ) {
    throw new ErreurAppelsOffres("ENTREE_INVALIDE", "Modèle d'étapes invalide.");
  }
  const plusLongue = Math.max(...modele.map((e) => e.joursAvantLimite));
  const compresse = plusLongue > disponibles;
  const etapes = [...modele]
    .sort((a, b) => b.joursAvantLimite - a.joursAvantLimite)
    .map((e, i) => {
      const avance = compresse
        ? Math.floor((e.joursAvantLimite * disponibles) / plusLongue)
        : e.joursAvantLimite;
      return {
        ordre: i + 1,
        code: e.code,
        libelle: e.libelle,
        datePrevue: dateISODepuisJourUTC(limite - avance),
      };
    });
  return { etapes, joursDisponibles: disponibles, compresse };
}

export const NIVEAUX_ALERTE_AO = ["depassee", "j1", "j3", "j7"] as const;
export type NiveauAlerteAo = (typeof NIVEAUX_ALERTE_AO)[number];

export interface EtapeSuivie {
  code: string;
  libelle: string;
  datePrevue: DateISO;
  faite: boolean;
}

export interface AppelOffresSuivi {
  id: string;
  statut: StatutAppelOffres;
  dateLimite: DateISO | null;
  etapes?: readonly EtapeSuivie[];
}

export type AlerteAppelOffres =
  | {
      aoId: string;
      type: "date_limite";
      niveau: NiveauAlerteAo;
      joursRestants: number;
    }
  | {
      aoId: string;
      type: "etape_en_retard" | "etape_du_jour";
      etapeCode: string;
      etapeLibelle: string;
      joursRestants: number;
    };

/** Niveau d'alerte selon les jours restants avant la date limite, ou `null`. */
export function niveauAlerteAo(joursRestants: number): NiveauAlerteAo | null {
  if (joursRestants < 0) return "depassee";
  if (joursRestants <= 1) return "j1";
  if (joursRestants <= 3) return "j3";
  if (joursRestants <= 7) return "j7";
  return null;
}

/** Alertes des fiches ouvertes, triées par urgence (jours restants), puis fiche et étape. */
export function alertesAppelsOffres(
  fiches: readonly AppelOffresSuivi[],
  aujourdhui: DateISO,
): AlerteAppelOffres[] {
  const j0 = jour(aujourdhui, "Date du jour");
  const alertes: AlerteAppelOffres[] = [];
  for (const f of fiches) {
    if (!STATUTS_AO_OUVERTS.includes(f.statut)) continue;
    if (f.dateLimite) {
      const restants = jour(f.dateLimite, "Date limite") - j0;
      const niveau = niveauAlerteAo(restants);
      if (niveau)
        alertes.push({ aoId: f.id, type: "date_limite", niveau, joursRestants: restants });
    }
    for (const e of f.etapes ?? []) {
      if (e.faite) continue;
      const restants = jour(e.datePrevue, "Date d'étape") - j0;
      if (restants > 0) continue;
      alertes.push({
        aoId: f.id,
        type: restants < 0 ? "etape_en_retard" : "etape_du_jour",
        etapeCode: e.code,
        etapeLibelle: e.libelle,
        joursRestants: restants,
      });
    }
  }
  const cle = (a: AlerteAppelOffres) => `${a.aoId}\u0000${"etapeCode" in a ? a.etapeCode : ""}`;
  return alertes.sort(
    (a, b) => a.joursRestants - b.joursRestants || (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0),
  );
}

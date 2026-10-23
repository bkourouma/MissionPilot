/** Indicateurs : valeurs affichées des onze indicateurs du cabinet. */
import {
  formaterJours,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import {
  DEFINITIONS,
  type DefinitionIndicateur,
  type IdIndicateur,
} from "./indicateurs-definitions";
import { estNombre } from "./indicateurs-nombre";
import {
  statutConsommation,
  statutDelai,
  statutEcart,
  statutFacturabilite,
  statutMarge,
  statutOccupation,
  statutRatio,
  statutRealisation,
  type StatutAffiche,
} from "./indicateurs-statuts";
import {
  lireCarnet,
  type IndicateursCabinet,
  type Ratio,
  type ReponseIndicateurs,
} from "./indicateurs-types";

const INFORMATION: StatutAffiche = { tonalite: "neutre", libelle: "Pour information" };

// --- Valeurs affichées ---------------------------------------------------------------------

export interface IndicateurAffiche {
  definition: DefinitionIndicateur;
  /** `false` : champ absent de la réponse (droit manquant) ; rien n'est affiché. */
  present: boolean;
  valeur: string;
  detail: string | null;
  statut: StatutAffiche | null;
}

/** « 12 / 15 » d'un ratio des moteurs. */
export const detailRatio = (r: Ratio) =>
  r.attendus === 0 ? "Rien d'attendu sur la période" : `${r.reussis} sur ${r.attendus}`;

/** « +3 j (+12 %) » : signe affiché, valeurs de l'API. */
export function formaterEcartJours(jours: number, relatif: number | null): string {
  const signe = jours > 0 ? "+" : jours < 0 ? "−" : "";
  const j = `${signe}${formaterJours(Math.abs(jours))}`;
  if (relatif === null) return j;
  const sr = relatif > 0 ? "+" : relatif < 0 ? "−" : "";
  return `${j} (${sr}${formaterPourcentage(Math.abs(relatif))})`;
}

export function formaterDelai(jours: number | null | undefined): string {
  return estNombre(jours) ? formaterNombre(jours, 1) + " j" : VALEUR_ABSENTE;
}

const absent = (definition: DefinitionIndicateur): IndicateurAffiche => ({
  definition,
  present: false,
  valeur: "",
  detail: null,
  statut: null,
});

function valeur(
  id: IdIndicateur,
  c: IndicateursCabinet,
  devise: Devise,
): Omit<IndicateurAffiche, "definition" | "present"> | null {
  switch (id) {
    case "occupation":
      return {
        valeur: formaterPourcentage(c.taux_occupation),
        detail: `${formaterJours(c.jours_affectes)} affectés sur ${formaterJours(c.jours_disponibles)} disponibles`,
        statut: statutOccupation(c.taux_occupation),
      };
    case "facturabilite":
      return {
        valeur: formaterPourcentage(c.taux_facturabilite),
        detail: `${formaterJours(c.jours_facturables)} facturables sur ${formaterJours(c.jours_disponibles)} disponibles`,
        statut: statutFacturabilite(c.taux_facturabilite),
      };
    case "consommation":
      return {
        valeur: formaterPourcentage(c.consommation_budgetaire),
        detail: `${formaterJours(c.jours_realises)} réalisés sur ${formaterJours(c.jours_budget)} budgétés`,
        statut: statutConsommation(c.consommation_budgetaire),
      };
    case "ecart": {
      const e = c.ecart_terminaison;
      return {
        valeur: formaterEcartJours(e.jours, e.relatif_jours),
        detail:
          e.couts_production === undefined
            ? `Atterrissage ${formaterJours(c.jours_atterrissage)} pour ${formaterJours(c.jours_budget)} budgétés`
            : `En coûts de production : ${formaterMontantMineur(e.couts_production, devise)}`,
        statut: statutEcart(e.relatif_jours, e.jours),
      };
    }
    case "marge":
      if (!c.marge) return null;
      return {
        valeur: formaterPourcentage(c.marge.taux_marge),
        detail: `Marge ${formaterMontantMineur(c.marge.marge, devise)} sur ${formaterMontantMineur(c.marge.honoraires, devise)} d'honoraires`,
        statut: statutMarge(c.marge.taux_marge, c.marge.marge),
      };
    case "realisation":
      if (c.taux_realisation === undefined) return null;
      return {
        valeur: formaterPourcentage(c.taux_realisation),
        detail: "Cumul jusqu'à la fin de la période",
        statut: statutRealisation(c.taux_realisation),
      };
    case "encours":
      if (!c.encours) return null;
      return {
        valeur: formaterMontantMineur(c.encours.encours_production, devise),
        detail: `Facturé d'avance : ${formaterMontantMineur(c.encours.facture_d_avance, devise)}`,
        statut: INFORMATION,
      };
    case "delai":
      return {
        valeur: formaterDelai(c.delai_moyen_encaissement),
        detail:
          c.factures_soldees === 0
            ? "Aucune facture soldée sur la période"
            : `${c.factures_soldees} facture${c.factures_soldees > 1 ? "s" : ""} soldée${c.factures_soldees > 1 ? "s" : ""} sur la période`,
        statut: statutDelai(c.delai_moyen_encaissement),
      };
    case "carnet": {
      const carnet = lireCarnet(c);
      if (carnet === null) return null;
      return {
        valeur: formaterMontantMineur(carnet.valeur, devise),
        detail: carnet.libelle,
        statut: INFORMATION,
      };
    }
    case "jalons":
      return {
        valeur: formaterPourcentage(c.respect_jalons.taux),
        detail: detailRatio(c.respect_jalons),
        statut: statutRatio(c.respect_jalons),
      };
    case "discipline":
      return {
        valeur: formaterPourcentage(c.discipline_saisie.taux),
        detail: detailRatio(c.discipline_saisie),
        statut: statutRatio(c.discipline_saisie),
      };
  }
}

/** Les onze indicateurs du cabinet, dans l'ordre du PRD ; un champ absent reste absent. */
export function indicateursAffiches(r: ReponseIndicateurs): IndicateurAffiche[] {
  return DEFINITIONS.map((d) => {
    const v = valeur(d.id, r.cabinet, r.devise);
    return v === null ? absent(d) : { definition: d, present: true, ...v };
  });
}

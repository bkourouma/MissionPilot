/** Indicateurs : valeurs affichées des onze indicateurs du cabinet. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
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
  definitionLocalisee,
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

const informationStatut = (langue: Langue): StatutAffiche => ({
  tonalite: "neutre",
  libelle: creerTraduire(langue)("Pour information", "For information"),
});

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
export const detailRatio = (r: Ratio, langue: Langue = "fr") =>
  r.attendus === 0
    ? creerTraduire(langue)("Rien d'attendu sur la période", "Nothing expected in the period")
    : creerTraduire(langue)(`${r.reussis} sur ${r.attendus}`, `${r.reussis} of ${r.attendus}`);

/** « +3 j (+12 %) » : signe affiché, valeurs de l'API. */
export function formaterEcartJours(
  jours: number,
  relatif: number | null,
  langue: Langue = "fr",
): string {
  const signe = jours > 0 ? "+" : jours < 0 ? "−" : "";
  const j = `${signe}${formaterJours(Math.abs(jours), langue)}`;
  if (relatif === null) return j;
  const sr = relatif > 0 ? "+" : relatif < 0 ? "−" : "";
  return `${j} (${sr}${formaterPourcentage(Math.abs(relatif), 1, langue)})`;
}

export function formaterDelai(jours: number | null | undefined, langue: Langue = "fr"): string {
  return estNombre(jours)
    ? formaterNombre(jours, 1, langue) + (langue === "en" ? "\u00a0d" : "\u00a0j")
    : VALEUR_ABSENTE;
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
  langue: Langue,
): Omit<IndicateurAffiche, "definition" | "present"> | null {
  const t = creerTraduire(langue);
  const information = informationStatut(langue);
  const jours = (v: number | null | undefined) => formaterJours(v, langue);
  const montant = (v: number | null | undefined) => formaterMontantMineur(v, devise, langue);
  const pct = (v: number | null | undefined) => formaterPourcentage(v, 1, langue);
  switch (id) {
    case "occupation":
      return {
        valeur: pct(c.taux_occupation),
        detail: t(
          `${jours(c.jours_affectes)} affectés sur ${jours(c.jours_disponibles)} disponibles`,
          `${jours(c.jours_affectes)} assigned out of ${jours(c.jours_disponibles)} available`,
        ),
        statut: statutOccupation(c.taux_occupation, langue),
      };
    case "facturabilite":
      return {
        valeur: pct(c.taux_facturabilite),
        detail: t(
          `${jours(c.jours_facturables)} facturables sur ${jours(c.jours_disponibles)} disponibles`,
          `${jours(c.jours_facturables)} billable out of ${jours(c.jours_disponibles)} available`,
        ),
        statut: statutFacturabilite(c.taux_facturabilite, langue),
      };
    case "consommation":
      return {
        valeur: pct(c.consommation_budgetaire),
        detail: t(
          `${jours(c.jours_realises)} réalisés sur ${jours(c.jours_budget)} budgétés`,
          `${jours(c.jours_realises)} worked out of ${jours(c.jours_budget)} budgeted`,
        ),
        statut: statutConsommation(c.consommation_budgetaire, langue),
      };
    case "ecart": {
      const e = c.ecart_terminaison;
      return {
        valeur: formaterEcartJours(e.jours, e.relatif_jours, langue),
        detail:
          e.couts_production === undefined
            ? t(
                `Atterrissage ${jours(c.jours_atterrissage)} pour ${jours(c.jours_budget)} budgétés`,
                `Landing ${jours(c.jours_atterrissage)} for ${jours(c.jours_budget)} budgeted`,
              )
            : t(
                `En coûts de production : ${montant(e.couts_production)}`,
                `In production costs: ${montant(e.couts_production)}`,
              ),
        statut: statutEcart(e.relatif_jours, e.jours, langue),
      };
    }
    case "marge":
      if (!c.marge) return null;
      return {
        valeur: pct(c.marge.taux_marge),
        detail: t(
          `Marge ${montant(c.marge.marge)} sur ${montant(c.marge.honoraires)} d'honoraires`,
          `Margin ${montant(c.marge.marge)} on ${montant(c.marge.honoraires)} of fees`,
        ),
        statut: statutMarge(c.marge.taux_marge, c.marge.marge, langue),
      };
    case "realisation":
      if (c.taux_realisation === undefined) return null;
      return {
        valeur: pct(c.taux_realisation),
        detail: t("Cumul jusqu'à la fin de la période", "Cumulative up to the end of the period"),
        statut: statutRealisation(c.taux_realisation, langue),
      };
    case "encours":
      if (!c.encours) return null;
      return {
        valeur: montant(c.encours.encours_production),
        detail: t(
          `Facturé d'avance : ${montant(c.encours.facture_d_avance)}`,
          `Invoiced in advance: ${montant(c.encours.facture_d_avance)}`,
        ),
        statut: information,
      };
    case "delai":
      return {
        valeur: formaterDelai(c.delai_moyen_encaissement, langue),
        detail:
          c.factures_soldees === 0
            ? t("Aucune facture soldée sur la période", "No invoice settled in the period")
            : t(
                `${c.factures_soldees} facture${c.factures_soldees > 1 ? "s" : ""} soldée${c.factures_soldees > 1 ? "s" : ""} sur la période`,
                `${c.factures_soldees} invoice${c.factures_soldees > 1 ? "s" : ""} settled in the period`,
              ),
        statut: statutDelai(c.delai_moyen_encaissement, langue),
      };
    case "carnet": {
      const carnet = lireCarnet(c, langue);
      if (carnet === null) return null;
      return {
        valeur: montant(carnet.valeur),
        detail: carnet.libelle,
        statut: information,
      };
    }
    case "jalons":
      return {
        valeur: pct(c.respect_jalons.taux),
        detail: detailRatio(c.respect_jalons, langue),
        statut: statutRatio(c.respect_jalons, langue),
      };
    case "discipline":
      return {
        valeur: pct(c.discipline_saisie.taux),
        detail: detailRatio(c.discipline_saisie, langue),
        statut: statutRatio(c.discipline_saisie, langue),
      };
  }
}

/** Les onze indicateurs du cabinet, dans l'ordre du PRD ; un champ absent reste absent. */
export function indicateursAffiches(
  r: ReponseIndicateurs,
  langue: Langue = "fr",
): IndicateurAffiche[] {
  return DEFINITIONS.map((d) => {
    const definition = definitionLocalisee(d, langue);
    const v = valeur(d.id, r.cabinet, r.devise, langue);
    return v === null ? absent(definition) : { definition, present: true, ...v };
  });
}

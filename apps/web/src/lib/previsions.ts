import type { Devise } from "@missionpilot/shared";
import { ETAT_CHARGE, type EtatCharge } from "./planification";

/*
 * Prévisions du cabinet (AUT-12) : types de la réponse de `GET /api/previsions` et libellés.
 * Aucun calcul ici : tous les chiffres viennent du moteur via l'API.
 */

export interface MoisPrevision {
  mois: string;
  debut: string;
  fin: string;
  ca_carnet: number;
  ca_pipeline: number;
  ca_total: number;
  capacite_jours: number;
  charge_carnet_jours: number;
  charge_a_pourvoir_jours: number;
  charge_pipeline_jours: number;
  charge_totale_jours: number;
  ecart_jours: number;
  taux_occupation: number | null;
  etat: EtatCharge;
}

export type EtapePipeline = "prospection" | "qualification" | "proposition" | "negociation";

export interface EtapePrevision {
  etape: EtapePipeline;
  nombre: number;
  montant: number;
  montant_pondere: number;
}

export interface ReponsePrevisions {
  devise: Devise;
  date_reference: string;
  mois: MoisPrevision[];
  totaux: {
    ca_carnet: number;
    ca_pipeline: number;
    ca_total: number;
    capacite_jours: number;
    charge_carnet_jours: number;
    charge_a_pourvoir_jours: number;
    charge_pipeline_jours: number;
    charge_totale_jours: number;
  };
  au_dela: { ca_carnet: number; ca_pipeline: number };
  en_retard: { nombre: number; montant: number };
  par_etape: EtapePrevision[];
  nombre_echeances: number;
  nombre_opportunites: number;
  opportunites_sans_date: number;
  opportunites_sans_charge: number;
  opportunites_en_retard: number;
  exclusions: { echeances_sans_taux_change: number; opportunites_autre_devise: number };
  hypotheses: {
    probabilite_defaut_par_etape: Record<EtapePipeline, number>;
    delai_signature_mois: number;
    duree_mois: number;
    delai_sans_date_mois: number;
  };
}

export const LIBELLE_ETAPE: Record<EtapePipeline, string> = {
  prospection: "Prospection",
  qualification: "Qualification",
  proposition: "Proposition",
  negociation: "Négociation",
};

const MOIS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** « 2026-10 » → « octobre 2026 » ; une valeur inattendue est rendue telle quelle. */
export function libelleMois(mois: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mois);
  return m ? `${MOIS_FR[Number(m[2]) - 1]} ${m[1]}` : mois;
}

/** « 2026-10 » → « oct. 2026 » (colonnes étroites). */
export function libelleMoisCourt(mois: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mois);
  if (!m) return mois;
  const nom = MOIS_FR[Number(m[2]) - 1] as string;
  return `${nom.length > 4 ? `${nom.slice(0, 3)}.` : nom} ${m[1]}`;
}

/** Libellé d'état de charge d'un mois (mêmes états que le plan de charge). */
export function etatMois(m: Pick<MoisPrevision, "etat">) {
  return ETAT_CHARGE[m.etat];
}

/** Notes à afficher sous les tableaux : ce qui est écarté, supposé ou hors horizon. */
export function notesPrevision(r: ReponsePrevisions, formater: (v: number) => string): string[] {
  const notes: string[] = [];
  if (r.en_retard.nombre > 0) {
    notes.push(
      `${r.en_retard.nombre} échéance(s) en retard (${formater(r.en_retard.montant)}) comptée(s) dans le premier mois.`,
    );
  }
  if (r.au_dela.ca_carnet > 0 || r.au_dela.ca_pipeline > 0) {
    notes.push(
      `Hors horizon : ${formater(r.au_dela.ca_carnet)} de carnet signé et ${formater(r.au_dela.ca_pipeline)} de pipeline pondéré.`,
    );
  }
  if (r.opportunites_sans_date > 0) {
    notes.push(
      `${r.opportunites_sans_date} opportunité(s) sans date de clôture prévue : démarrage supposé à ${r.hypotheses.delai_sans_date_mois} mois.`,
    );
  }
  if (r.opportunites_en_retard > 0) {
    notes.push(
      `${r.opportunites_en_retard} opportunité(s) à la clôture prévue dépassée : démarrage supposé le premier mois.`,
    );
  }
  if (r.opportunites_sans_charge > 0) {
    notes.push(
      `${r.opportunites_sans_charge} opportunité(s) sans proposition chiffrée en jours : aucune charge estimée.`,
    );
  }
  if (r.exclusions.echeances_sans_taux_change > 0) {
    notes.push(
      `${r.exclusions.echeances_sans_taux_change} échéance(s) écartée(s) : taux de change de la mission non figé.`,
    );
  }
  if (r.exclusions.opportunites_autre_devise > 0) {
    notes.push(
      `${r.exclusions.opportunites_autre_devise} opportunité(s) écartée(s) : devise différente de celle du cabinet.`,
    );
  }
  return notes;
}

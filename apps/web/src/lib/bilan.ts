/**
 * Bilan de clôture d'une mission : contrat de `GET /api/missions/:id/bilan` et règles du
 * retour d'expérience, testés dans `bilan.test.ts`. Tous les chiffres sont figés par l'API à
 * la clôture (moteurs) ; les blocs `finance` et `atterrissage` sont ABSENTS sans « finance.lire ».
 */
import { DELAI_RETOUR_EXPERIENCE_JOURS, type Role } from "@missionpilot/shared";
import type { Devise } from "./format";
import type { Resultat } from "./saisie";

export interface JoursBilan {
  budget: number;
  realise: number;
  reste_a_faire: number;
  atterrissage: number;
  ecart_atterrissage: number;
  ecart_realise: number;
  ecart_relatif: number | null;
  consommation: number | null;
}

export interface SyntheseBilan {
  devise: Devise;
  jours_vendus: number;
  honoraires?: number;
  debours_refacturables?: number;
  debours_non_refacturables?: number;
  couts_internes?: number;
  sous_traitance?: number;
  marge?: number;
  taux_marge?: number | null;
  jours_production?: number;
}

export interface FinanceBilan {
  devise: Devise;
  budget: SyntheseBilan | null;
  realise: {
    honoraires_factures: number;
    valeur_produite: number;
    valeur_standard: number;
    couts_internes: number;
    sous_traitance: number;
    debours_non_refactures: number;
    marge: number;
    taux_marge: number | null;
  };
  taux_realisation: number | null;
  ecart: {
    jours: number;
    couts_production: number;
    relatif_jours: number | null;
    marge: number | null;
  } | null;
  encours: { encours_production: number; facture_d_avance: number };
  jours_non_valorises: number;
  jours_sans_cout: number;
}

export interface AtterrissageBilan {
  type: "atterrissage";
  version_reference_id: string | null;
  lignes: { cle: string; libelle: string; jours: number | null; montant: number }[];
  synthese: SyntheseBilan | null;
  ecart_terminaison?: {
    jours: number;
    couts_production: number;
    relatif_jours: number | null;
  } | null;
}

export interface Bilan {
  id: string;
  mission_id: string;
  cloture_le: string;
  date_cloture: string;
  jours: JoursBilan;
  retour_experience: string | null;
  retour_modifie_par: string | null;
  retour_modifie_le: string | null;
  retour_modifiable_jusqu_au: string;
  cree_par: string;
  cree_le: string;
  devise?: Devise;
  finance?: FinanceBilan;
  atterrissage?: AtterrissageBilan;
}

export const DELAI_RETOUR = DELAI_RETOUR_EXPERIENCE_JOURS;

/**
 * Le retour d'expérience se rédige par le directeur de la mission ou un associé, jusqu'à la
 * date limite servie par l'API (30 jours après la clôture). L'API reste seule juge.
 */
export function retourModifiable(
  b: Pick<Bilan, "retour_modifiable_jusqu_au">,
  c: {
    utilisateurId: string;
    roles: readonly Role[];
    directeurId: string | null;
    maintenant: Date;
  },
): { modifiable: boolean; raison: string | null } {
  const limite = new Date(b.retour_modifiable_jusqu_au);
  if (Number.isNaN(limite.getTime()) || c.maintenant.getTime() > limite.getTime())
    return {
      modifiable: false,
      raison: "Le délai de 30 jours après la clôture est écoulé : le retour d'expérience est figé.",
    };
  if (c.directeurId !== c.utilisateurId && !c.roles.includes("associe"))
    return {
      modifiable: false,
      raison: "Le retour d'expérience est rédigé par le directeur de la mission ou un associé.",
    };
  return { modifiable: true, raison: null };
}

export function validerRetourExperience(texte: string): Resultat<{ texte: string }, "texte"> {
  const t = texte.trim();
  if (t === "") return { ok: false, erreurs: { texte: "Rédigez le retour d'expérience." } };
  if (t.length > 10_000) return { ok: false, erreurs: { texte: "10 000 caractères au plus." } };
  return { ok: true, charge: { texte: t } };
}

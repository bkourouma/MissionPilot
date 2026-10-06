import type { BaseRetenue } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/**
 * Paramètres de facturation du cabinet (FIN-07). Absence de ligne : valeurs
 * de départ. TVA 18 % (Côte d'Ivoire) et retenue à la source désactivée sont
 * des VALEURS DE DÉPART à faire valider par le métier (`valeurs_validees`).
 */
export interface ParametresFacturation {
  raison_sociale: string | null;
  forme_juridique: string | null;
  rccm: string | null;
  compte_contribuable: string | null;
  regime_fiscal: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  banque: string | null;
  iban: string | null;
  autres_coordonnees: string | null;
  mentions_complementaires: string | null;
  prefixe_facture: string;
  prefixe_avoir: string;
  chiffres_numero: number;
  delai_paiement_jours: number;
  taux_tva_defaut: number;
  taux_tva_autorises: number[];
  taux_tva_debours: number;
  retenue_active: boolean;
  retenue_taux: number;
  retenue_base: BaseRetenue;
  retenue_libelle: string;
  valeurs_validees: boolean;
}

export const COLONNES_PARAMETRES = `raison_sociale, forme_juridique, rccm, compte_contribuable,
  regime_fiscal, adresse, telephone, email, banque, iban, autres_coordonnees, mentions_complementaires,
  prefixe_facture, prefixe_avoir, chiffres_numero, delai_paiement_jours,
  taux_tva_defaut::float8 AS taux_tva_defaut, taux_tva_autorises::float8[] AS taux_tva_autorises,
  taux_tva_debours::float8 AS taux_tva_debours, retenue_active, retenue_taux::float8 AS retenue_taux,
  retenue_base, retenue_libelle, valeurs_validees, modifie_par, modifie_le`;

export const PARAMETRES_DEPART: ParametresFacturation = {
  raison_sociale: null,
  forme_juridique: null,
  rccm: null,
  compte_contribuable: null,
  regime_fiscal: null,
  adresse: null,
  telephone: null,
  email: null,
  banque: null,
  iban: null,
  autres_coordonnees: null,
  mentions_complementaires: null,
  prefixe_facture: "FA",
  prefixe_avoir: "AV",
  chiffres_numero: 5,
  delai_paiement_jours: 30,
  taux_tva_defaut: 18,
  taux_tva_autorises: [0, 18],
  taux_tva_debours: 0,
  retenue_active: false,
  retenue_taux: 0,
  retenue_base: "HT",
  retenue_libelle: "Retenue à la source",
  valeurs_validees: false,
};

/** Paramètres du cabinet ; `personnalises` faux tant qu'aucune ligne n'est enregistrée. */
export async function lireParametresFacturation(
  db: Db,
  cabinetId: string,
  verrouiller = false,
): Promise<
  ParametresFacturation & {
    personnalises: boolean;
    modifie_par: string | null;
    modifie_le: string | null;
  }
> {
  const r = await db.query(
    `SELECT ${COLONNES_PARAMETRES} FROM parametres_facturation WHERE cabinet_id = $1
     ${verrouiller ? "FOR UPDATE" : ""}`,
    [cabinetId],
  );
  const ligne = r.rows[0];
  if (!ligne) {
    return { ...PARAMETRES_DEPART, personnalises: false, modifie_par: null, modifie_le: null };
  }
  return { ...ligne, personnalises: true };
}

/** Raison sociale de l'émetteur : paramétrée, sinon le nom du cabinet. */
export async function raisonSocialeEmetteur(
  db: Db,
  cabinetId: string,
  p: Pick<ParametresFacturation, "raison_sociale">,
): Promise<string> {
  if (p.raison_sociale) return p.raison_sociale;
  const c = await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId]);
  return (c.rows[0]?.nom as string | undefined) ?? "";
}

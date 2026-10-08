import {
  calculerMarge,
  calculerSuivi,
  ecartTerminaison,
  encoursMission,
  montantLigne,
  soustraire,
  sommer,
  tauxRealisation,
  type Devise,
  type SyntheseBudget,
} from "@missionpilot/engines";
import { DELAI_RETOUR_EXPERIENCE_JOURS } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { vueSynthese, versVersionMoteur } from "../missions/budget.js";
import { aujourdhui, type DroitsBudget } from "../missions/outils.js";
import {
  analyserMissions,
  chargerMissions,
  coutsProduction,
  suiviMission,
  syntheseReference,
  versionAtterrissage,
} from "./donnees.js";

/*
 * BILAN DE CLÔTURE (cycle de vie d'une mission), écrit dans la transaction
 * de POST /missions/:id/cloturer et IMMUABLE ensuite (migration 0062).
 * - jours : budget, réalisé, reste à faire, atterrissage, écart et
 *   consommation (suivi, moteur planning) ;
 * - finance : budget de référence, réalisé (honoraires facturés, valeur
 *   produite, valeur au taux standard, coûts internes, sous-traitance,
 *   débours non refacturés), marge et taux (moteur), taux de réalisation,
 *   écart budget / réalisé en jours et en coûts de production
 *   (ecartTerminaison), écart de marge, encours à la clôture ;
 * - atterrissage : version budgétaire « atterrissage » (FIN-03) recalculée
 *   sur les jours d'atterrissage, conservée avec ses lignes et sa synthèse.
 * Lecture : sans « finance.lire », les blocs finance et atterrissage sont
 * ABSENTS (pas masqués).
 */

const vueSyntheseComplete = (s: SyntheseBudget) =>
  vueSynthese(s, { montants: true, finance: true });

export async function enregistrerBilanCloture(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<void> {
  const [mission] = await chargerMissions(db, auth, [missionId]);
  if (!mission) throw introuvable("Mission");
  const [analyse] = await analyserMissions(db, [mission], null, null);
  if (!analyse) throw introuvable("Mission");
  const suivi = await suiviMission(db, auth.cabinetId, missionId);
  const s = suivi.arbre.suivi;
  const devise = mission.devise as Devise;
  const reference = syntheseReference(analyse.tarification);
  const atterrissage = analyse.tarification.reference
    ? versionAtterrissage(analyse.tarification.reference, suivi, mission.mode_facturation)
    : null;

  const realise = calculerMarge({
    honoraires: analyse.honoraires_factures,
    coutsInternes: analyse.couts_internes,
    deboursNonRefactures: analyse.debours_non_refactures,
    sousTraitance: analyse.sous_traitance,
  });
  const coutsReels = sommer([analyse.couts_internes, analyse.sous_traitance], devise);
  const ecart = reference
    ? ecartTerminaison(
        { jours: s.budget, montant: coutsProduction(reference) },
        { jours: s.realise, montant: coutsReels },
      )
    : null;
  const ecartRealise = calculerSuivi({ budget: s.budget, realise: s.realise, resteAFaire: 0 });
  const encours = encoursMission(analyse.valeur_produite, analyse.honoraires_factures);

  const jours = {
    budget: s.budget,
    realise: s.realise,
    reste_a_faire: s.resteAFaire,
    atterrissage: s.atterrissage,
    ecart_atterrissage: s.ecart,
    ecart_realise: ecartRealise.ecart,
    ecart_relatif: ecartRealise.ecartRelatif,
    consommation: s.consommation,
  };
  const finance = {
    devise,
    budget: reference ? vueSyntheseComplete(reference) : null,
    realise: {
      honoraires_factures: analyse.honoraires_factures.valeur,
      valeur_produite: analyse.valeur_produite.valeur,
      valeur_standard: analyse.valeur_standard.valeur,
      couts_internes: analyse.couts_internes.valeur,
      sous_traitance: analyse.sous_traitance.valeur,
      debours_non_refactures: analyse.debours_non_refactures.valeur,
      marge: realise.marge.valeur,
      taux_marge: realise.taux,
    },
    taux_realisation: tauxRealisation(analyse.honoraires_factures, analyse.valeur_standard),
    ecart: ecart
      ? {
          jours: ecart.ecartJours,
          couts_production: ecart.ecartMontant.valeur,
          relatif_jours: ecart.ecartRelatifJours,
          marge: reference ? soustraire(realise.marge, reference.marge).valeur : null,
        }
      : null,
    encours: {
      encours_production: encours.encoursProduction.valeur,
      facture_d_avance: encours.factureDAvance.valeur,
    },
    jours_non_valorises: analyse.jours_non_valorises,
    jours_sans_cout: analyse.jours_sans_cout,
  };
  const lignesMoteur = atterrissage
    ? versVersionMoteur({
        id: "atterrissage",
        numero: 1,
        type: "atterrissage",
        devise,
        figee: false,
        motif: null,
        lignes: atterrissage.lignes,
      }).lignes
    : [];
  const versionAtt = atterrissage
    ? {
        type: "atterrissage",
        version_reference_id: analyse.tarification.reference?.id ?? null,
        lignes: atterrissage.lignes.map((l, i) => ({
          cle: l.cle,
          libelle: l.libelle,
          nature: l.nature,
          grade_code: l.grade_code,
          jours: l.jours,
          prix_journalier: l.prix_journalier,
          montant_forfait: l.montant_forfait,
          refacturable: l.refacturable,
          montant: montantLigne(lignesMoteur[i] as (typeof lignesMoteur)[number], devise).valeur,
        })),
        synthese: vueSyntheseComplete(atterrissage.synthese),
        ecart_terminaison: reference
          ? (() => {
              const e = ecartTerminaison(
                { jours: s.budget, montant: coutsProduction(reference) },
                { jours: s.atterrissage, montant: coutsProduction(atterrissage.synthese) },
              );
              return {
                jours: e.ecartJours,
                couts_production: e.ecartMontant.valeur,
                relatif_jours: e.ecartRelatifJours,
              };
            })()
          : null,
      }
    : { type: "atterrissage", version_reference_id: null, lignes: [], synthese: null };

  await db.query(
    `INSERT INTO bilans_mission (cabinet_id, mission_id, cloture_le, date_cloture, devise, jours,
       finance, atterrissage, cree_par)
     VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8)
     ON CONFLICT (cabinet_id, mission_id) DO NOTHING`,
    [
      auth.cabinetId,
      missionId,
      aujourdhui(),
      devise,
      JSON.stringify(jours),
      JSON.stringify(finance),
      JSON.stringify(versionAtt),
      auth.utilisateurId,
    ],
  );
}

export interface BilanDb {
  id: string;
  mission_id: string;
  cloture_le: string;
  date_cloture: string;
  devise: Devise;
  jours: Record<string, unknown>;
  finance: Record<string, unknown>;
  atterrissage: Record<string, unknown>;
  retour_experience: string | null;
  retour_modifie_par: string | null;
  retour_modifie_le: string | null;
  cree_par: string;
  cree_le: string;
}

export async function lireBilan(db: Db, missionId: string, verrouiller = false): Promise<BilanDb> {
  const r = await db.query(
    `SELECT id, mission_id, cloture_le, date_cloture::text AS date_cloture, devise, jours, finance,
       atterrissage, retour_experience, retour_modifie_par, retour_modifie_le, cree_par, cree_le
     FROM bilans_mission WHERE mission_id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [missionId],
  );
  if (!r.rows[0]) throw introuvable("Bilan de clôture");
  return r.rows[0] as BilanDb;
}

/** Fin du délai de complétion du retour d'expérience. */
export function finDelaiRetour(b: Pick<BilanDb, "cloture_le">): Date {
  return new Date(
    new Date(b.cloture_le).getTime() + DELAI_RETOUR_EXPERIENCE_JOURS * 24 * 3600 * 1000,
  );
}

export function vueBilan(b: BilanDb, droits: DroitsBudget): Record<string, unknown> {
  return {
    id: b.id,
    mission_id: b.mission_id,
    cloture_le: b.cloture_le,
    date_cloture: b.date_cloture,
    jours: b.jours,
    retour_experience: b.retour_experience,
    retour_modifie_par: b.retour_modifie_par,
    retour_modifie_le: b.retour_modifie_le,
    retour_modifiable_jusqu_au: finDelaiRetour(b).toISOString(),
    cree_par: b.cree_par,
    cree_le: b.cree_le,
    ...(droits.finance
      ? { devise: b.devise, finance: b.finance, atterrissage: b.atterrissage }
      : {}),
  };
}

import {
  DELAI_SANS_DATE_MOIS_DEFAUT,
  DELAI_SIGNATURE_MOIS_DEFAUT,
  DUREE_MOIS_DEFAUT,
  ErreurPrevision,
  genererMois,
  montant,
  periodeDuMois,
  prevoirCabinet,
  PROBABILITE_ETAPE_DEFAUT,
  sommerJours,
  versCentiemes,
  type Affectation,
  type EcheanceCarnet,
  type EtapePipeline,
  type OpportunitePrevision,
  type PrevisionCabinet,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import { deviseDuCabinet, versDeviseCabinet } from "../finance/donnees.js";
import { STATUTS_SIGNES } from "../missions/acces.js";
import { chargerCalendrier, nombre } from "../missions/outils.js";
import { absencesValidees } from "../planification/charge.js";

/*
 * PRÉVISIONS DU CABINET (AUT-12).
 *
 * Cette couche ne lit que des lignes et les passe au moteur `prevoirCabinet`
 * (packages/engines/src/previsions) : aucune somme, aucune pondération ni aucun
 * arrondi ici (les calculs vivent dans les moteurs).
 *
 * Cabinet entier, sans filtre de visibilité par mission : la route est réservée à
 * `finance.lire`, que seuls l'associé et le gestionnaire détiennent, et ils
 * détiennent aussi `mission.lire_toutes`. Les montants sont agrégés dans la
 * devise du cabinet au taux figé de chaque mission ; une échéance sans taux figé
 * exploitable ou une opportunité dans une autre devise est écartée ET comptée
 * (`exclusions`) plutôt que convertie à un taux inventé.
 */

export interface DonneesPrevision {
  devise: Awaited<ReturnType<typeof deviseDuCabinet>>;
  echeances: EcheanceCarnet[];
  opportunites: OpportunitePrevision[];
  collaborateurs: {
    id: string;
    tempsTravailPct: number;
    absences: { debut: string; fin: string }[];
  }[];
  affectations: Affectation[];
  affectationsAPourvoir: Affectation[];
  calendrier: Awaited<ReturnType<typeof chargerCalendrier>>;
  exclusions: { echeances_sans_taux_change: number; opportunites_autre_devise: number };
}

export async function chargerDonneesPrevision(
  db: Db,
  cabinetId: string,
  dateReference: string,
  nbMois: number,
): Promise<DonneesPrevision> {
  // Une date de référence refusée par le moteur (hors des années 0001 à 9999, jour inexistant)
  // est une requête invalide (400), jamais une erreur interne.
  let mois: string[];
  try {
    mois = genererMois(dateReference, nbMois);
  } catch (error) {
    if (error instanceof ErreurPrevision) throw requeteInvalide(error.message);
    throw error;
  }
  const horizon = {
    debut: periodeDuMois(mois[0] as string).debut,
    fin: periodeDuMois(mois[mois.length - 1] as string).fin,
  };
  const devise = await deviseDuCabinet(db, cabinetId);

  // Carnet signé : échéances de facturation pas encore facturées des missions signées.
  const e = await db.query(
    `SELECT e.mission_id, e.date_prevue::text AS date, e.montant, e.devise,
       m.taux_change::text AS taux_change, m.devise_reference, m.date_signature::text AS date_signature
     FROM echeances_facturation e JOIN missions m ON m.id = e.mission_id
     WHERE e.statut IN ('prevue', 'a_facturer') AND m.statut = ANY ($1::text[])
     ORDER BY e.date_prevue, e.id`,
    [STATUTS_SIGNES],
  );
  const echeances: EcheanceCarnet[] = [];
  let sansTaux = 0;
  for (const l of e.rows) {
    const converti = versDeviseCabinet(
      montant(nombre(l.montant), l.devise),
      {
        devise: l.devise,
        taux_change: l.taux_change,
        devise_reference: l.devise_reference,
        date_signature: l.date_signature,
      },
      devise,
    );
    if (!converti) {
      sansTaux += 1;
      continue;
    }
    echeances.push({
      missionId: l.mission_id as string,
      date: l.date as string,
      montant: converti,
    });
  }

  // Pipeline : opportunités ouvertes, jours de leur dernière proposition.
  const o = await db.query(
    `SELECT id, etape, probabilite, montant_estime, devise, date_cloture_prevue::text AS cloture
     FROM opportunites WHERE statut = 'ouverte' ORDER BY id`,
  );
  const j = await db.query(
    `SELECT p.opportunite_id, l.jours::text AS jours
     FROM propositions p JOIN proposition_lignes l ON l.proposition_id = p.id
     WHERE p.opportunite_id = ANY ($1::uuid[])
       AND p.numero = (SELECT max(x.numero) FROM propositions x WHERE x.opportunite_id = p.opportunite_id)`,
    [o.rows.map((l) => l.id as string)],
  );
  const joursParOpportunite = new Map<string, number[]>();
  for (const l of j.rows) {
    const liste = joursParOpportunite.get(l.opportunite_id as string) ?? [];
    liste.push(nombre(l.jours));
    joursParOpportunite.set(l.opportunite_id as string, liste);
  }
  const opportunites: OpportunitePrevision[] = [];
  let autreDevise = 0;
  for (const l of o.rows) {
    if (l.devise !== devise) {
      autreDevise += 1;
      continue;
    }
    const jours = joursParOpportunite.get(l.id as string);
    opportunites.push({
      id: l.id as string,
      etape: l.etape as EtapePipeline,
      probabilitePct: nombre(l.probabilite),
      montant: montant(nombre(l.montant_estime), devise),
      dateCloturePrevue: (l.cloture as string | null) ?? null,
      joursCentiemes: jours ? versCentiemes(sommerJours(jours)) : null,
    });
  }

  // Capacité (collaborateurs internes actifs) et charge (affectations de missions non clôturées).
  const c = await db.query(
    `SELECT id, capacite_pct FROM collaborateurs WHERE actif AND type = 'interne' ORDER BY id`,
  );
  const ids = c.rows.map((l) => l.id as string);
  const absences = await absencesValidees(db, ids, horizon);
  const a = await db.query(
    `SELECT a.id, a.collaborateur_id, a.tache_id, a.jours_alloues::text AS jours,
       a.date_debut::text AS debut, a.date_fin::text AS fin
     FROM affectations a JOIN missions m ON m.id = a.mission_id
     WHERE m.statut <> 'cloturee' AND a.date_debut <= $2 AND a.date_fin >= $1
       AND (a.collaborateur_id = ANY ($3::uuid[]) OR a.collaborateur_id IS NULL)
     ORDER BY a.id`,
    [horizon.debut, horizon.fin, ids],
  );
  const vers = (l: Record<string, unknown>, personneId: string): Affectation => ({
    id: l.id as string,
    personneId,
    tacheId: l.tache_id as string,
    joursAlloues: nombre(l.jours),
    debut: l.debut as string,
    fin: l.fin as string,
  });
  return {
    devise,
    echeances,
    opportunites,
    collaborateurs: c.rows.map((l) => ({
      id: l.id as string,
      tempsTravailPct: nombre(l.capacite_pct),
      absences: absences.get(l.id as string) ?? [],
    })),
    affectations: a.rows
      .filter((l) => l.collaborateur_id !== null)
      .map((l) => vers(l, l.collaborateur_id as string)),
    affectationsAPourvoir: a.rows
      .filter((l) => l.collaborateur_id === null)
      .map((l) => vers(l, "a_pourvoir")),
    calendrier: await chargerCalendrier(db, cabinetId),
    exclusions: { echeances_sans_taux_change: sansTaux, opportunites_autre_devise: autreDevise },
  };
}

/** Calcule la prévision (moteur) ; une entrée refusée par le moteur devient un 400. */
export function calculerPrevision(
  d: DonneesPrevision,
  dateReference: string,
  nbMois: number,
): PrevisionCabinet {
  try {
    return prevoirCabinet({
      devise: d.devise,
      dateReference,
      echeances: d.echeances,
      opportunites: d.opportunites,
      collaborateurs: d.collaborateurs,
      affectations: d.affectations,
      affectationsAPourvoir: d.affectationsAPourvoir,
      calendrier: d.calendrier,
      parametres: { nbMois },
    });
  } catch (error) {
    if (error instanceof ErreurPrevision) throw requeteInvalide(error.message);
    throw error;
  }
}

/** Vue JSON (snake_case) de la prévision. */
export function vuePrevision(
  p: PrevisionCabinet,
  d: DonneesPrevision,
  dateReference: string,
): Record<string, unknown> {
  return {
    devise: p.devise,
    date_reference: dateReference,
    mois: p.mois.map((m) => ({
      mois: m.mois,
      debut: m.periode.debut,
      fin: m.periode.fin,
      ca_carnet: m.caCarnet,
      ca_pipeline: m.caPipeline,
      ca_total: m.caTotal,
      capacite_jours: m.capaciteJours,
      charge_carnet_jours: m.chargeCarnetJours,
      charge_a_pourvoir_jours: m.chargeAPourvoirJours,
      charge_pipeline_jours: m.chargePipelineJours,
      charge_totale_jours: m.chargeTotaleJours,
      ecart_jours: m.ecartJours,
      taux_occupation: m.tauxOccupation,
      etat: m.etat,
    })),
    totaux: {
      ca_carnet: p.totaux.caCarnet,
      ca_pipeline: p.totaux.caPipeline,
      ca_total: p.totaux.caTotal,
      capacite_jours: p.totaux.capaciteJours,
      charge_carnet_jours: p.totaux.chargeCarnetJours,
      charge_a_pourvoir_jours: p.totaux.chargeAPourvoirJours,
      charge_pipeline_jours: p.totaux.chargePipelineJours,
      charge_totale_jours: p.totaux.chargeTotaleJours,
    },
    au_dela: { ca_carnet: p.auDela.caCarnet, ca_pipeline: p.auDela.caPipeline },
    en_retard: p.enRetard,
    par_etape: p.parEtape.map((e) => ({
      etape: e.etape,
      nombre: e.nombre,
      montant: e.montant,
      montant_pondere: e.montantPondere,
    })),
    nombre_echeances: p.nombreEcheances,
    nombre_opportunites: p.nombreOpportunites,
    opportunites_sans_date: p.opportunitesSansDate,
    opportunites_sans_charge: p.opportunitesSansCharge,
    opportunites_en_retard: p.opportunitesEnRetard,
    exclusions: d.exclusions,
    hypotheses: {
      probabilite_defaut_par_etape: PROBABILITE_ETAPE_DEFAUT,
      delai_signature_mois: DELAI_SIGNATURE_MOIS_DEFAUT,
      duree_mois: DUREE_MOIS_DEFAUT,
      delai_sans_date_mois: DELAI_SANS_DATE_MOIS_DEFAUT,
    },
  };
}

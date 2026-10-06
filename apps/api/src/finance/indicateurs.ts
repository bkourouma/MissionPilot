import {
  ajouterJours,
  calculerMarge,
  capacite,
  carnetCommandes,
  consommationBudgetaire,
  delaiMoyenEncaissement,
  disciplineSaisie,
  ecartTerminaison,
  encoursMission,
  encoursPortefeuille,
  joursAffectesSurPeriode,
  lundiDeLaSemaine,
  respectJalons,
  semainesCouvrant,
  sommer,
  sommerJours,
  tauxFacturabilite,
  tauxOccupation,
  tauxRealisation,
  zero,
  type CommandeMission,
  type ComposantesMarge,
  type Devise,
  type Encours,
  type FactureEncaissee,
  type FeuilleAttendue,
  type Jalon,
  type Montant,
  type Periode,
} from "@missionpilot/engines";
import type { NiveauIndicateurs } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { chargerCalendrier } from "../missions/outils.js";
import { absencesValidees, affectationsDe } from "../planification/charge.js";
import { jours as joursDe } from "../temps/outils.js";
import type { SuiviMission } from "../temps/suivi.js";
import {
  analyserMissions,
  chargerMissions,
  chargerReferencesAnalyse,
  coutsProduction,
  deviseDuCabinet,
  suivisMissions,
  syntheseReference,
  versDeviseCabinet,
  versionAtterrissage,
  type AnalyseMission,
  type MissionDonnees,
} from "./donnees.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "./paiements.js";

/*
 * INDICATEURS DE PILOTAGE DU CABINET (PRD, table « Indicateurs de pilotage
 * du cabinet »). Toute formule vient des moteurs ; l'API ne fait que
 * rassembler les données et sommer par le moteur.
 *
 * | Indicateur                 | Calcul (moteur)                                         | Niveaux            |
 * | Taux d'occupation          | tauxOccupation(jours affectés, capacité)                | collaborateur, grade, cabinet |
 * | Taux de facturabilité      | tauxFacturabilite(jours validés sur missions, capacité) | collaborateur, grade, cabinet |
 * | Consommation budgétaire    | consommationBudgetaire(réalisé, budget) en jours        | mission, associé, cabinet |
 * | Écart à terminaison        | ecartTerminaison(budget, atterrissage) : jours, et      | mission, associé, cabinet |
 * |                            | coûts de production (finance.lire)                      |                    |
 * | Marge de mission           | calculerMarge sur la période (finance.lire)             | mission, client, associé, cabinet |
 * | Taux de réalisation        | tauxRealisation(facturé, valeur au taux standard)       | mission, associé, cabinet |
 * |                            | cumulé jusqu'à la fin de période (finance.lire)         |                    |
 * | Encours de production      | encoursMission / encoursPortefeuille (finance.lire)     | mission, associé, cabinet |
 * | Délai moyen d'encaissement | delaiMoyenEncaissement des factures soldées dans la     | client, cabinet    |
 * |                            | période (date du dernier encaissement)                  |                    |
 * | Carnet de commandes        | carnetCommandes(signé, valeur produite), missions non   | mission, associé, cabinet |
 * |                            | clôturées (finance.lire : dérivé des taux de vente)     |                    |
 * | Carnet de commandes        | carnetCommandes(signé, facturé cumulé), missions non    | mission, associé, cabinet |
 * | facturé                    | clôturées (budget.lire_montants ou finance.lire)        |                    |
 * | Respect des jalons         | respectJalons des jalons prévus dans la période         | mission, associé, cabinet |
 * | Discipline de saisie       | disciplineSaisie des feuilles attendues de la période   | collaborateur, grade, cabinet |
 *
 * Choix documentés :
 * - Capacité : jours ouvrés du calendrier du cabinet − absences validées, ×
 *   capacité % ; collaborateurs internes actifs seulement.
 * - Jalon atteint : la date d'atteinte n'est pas horodatée en V1 ; elle est
 *   approchée par la date de dernière modification du jalon (dette).
 * - Feuille attendue : chaque semaine de la période, pour les collaborateurs
 *   rattachés à un utilisateur actif, depuis la semaine de leur création ;
 *   date limite le dimanche ; les semaines importées ne comptent pas
 *   (comme GET /temps/discipline).
 * - Champs monétaires ABSENTS sans le droit requis (jamais masqués).
 * - Carnet de commandes : `carnet_commandes` (signé − valeur produite) est
 *   dérivé des taux de vente (FIN-02) : en faisant varier `au` d'un jour, la
 *   différence révélerait le taux journalier d'un collaborateur. Il est donc
 *   réservé à « finance.lire ». Avec « budget.lire_montants » seul, le champ
 *   distinct `carnet_commandes_facture` (Σ max(0, signé − facturé cumulé à la
 *   fin de période), même moteur `carnetCommandes`) ne repose que sur des
 *   montants déjà visibles de ce lecteur (budget signé, factures émises).
 * - Montants agrégés dans la devise du cabinet au taux figé de chaque mission.
 */

export interface OptionsIndicateurs {
  du: string;
  au: string;
  dateReference: string;
  niveau: NiveauIndicateurs;
  finance: boolean;
  montants: boolean;
}

/* ----- Collaborateurs : occupation, facturabilité, discipline ----- */

interface CollaborateurIndicateurs {
  id: string;
  nom: string;
  grade_code: string | null;
  grade_libelle: string | null;
  grade_ordre: number;
  disponibles: number;
  affectes: number;
  facturables: number;
  feuilles: FeuilleAttendue[];
}

async function indicateursCollaborateurs(
  db: Db,
  cabinetId: string,
  periode: Periode,
): Promise<CollaborateurIndicateurs[]> {
  const r = await db.query(
    `SELECT c.id, c.nom, c.capacite_pct, g.code AS grade_code, g.libelle AS grade_libelle,
       coalesce(g.ordre, 2147483647) AS grade_ordre, (u.id IS NOT NULL AND u.actif) AS saisit,
       (c.cree_le AT TIME ZONE 'UTC')::date::text AS depuis
     FROM collaborateurs c LEFT JOIN grades g ON g.id = c.grade_id
     LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
     WHERE c.actif AND c.type = 'interne'
     ORDER BY lower(c.nom), c.id`,
  );
  const ids = r.rows.map((c) => c.id as string);
  const calendrier = await chargerCalendrier(db, cabinetId);
  const absences = await absencesValidees(db, ids, periode);
  const affectations = await affectationsDe(db, ids, periode);
  const t = await db.query(
    `SELECT f.collaborateur_id, l.centiemes FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE f.collaborateur_id = ANY ($1::uuid[]) AND f.statut IN ('validee', 'verrouillee')
       AND l.mission_id IS NOT NULL AND l.date BETWEEN $2 AND $3
     UNION ALL
     SELECT x.collaborateur_id, x.nouvelle_centiemes - x.ancienne_centiemes FROM corrections_temps x
     WHERE x.collaborateur_id = ANY ($1::uuid[]) AND x.statut = 'validee'
       AND x.mission_id IS NOT NULL AND x.date BETWEEN $2 AND $3`,
    [ids, periode.debut, periode.fin],
  );
  const semaines = semainesCouvrant({
    debut: lundiDeLaSemaine(periode.debut),
    fin: periode.fin,
  }).map((s) => s.debut);
  const f = await db.query(
    `SELECT collaborateur_id, semaine::text AS semaine, origine,
       (premiere_soumission_le AT TIME ZONE 'UTC')::date::text AS soumise_le
     FROM feuilles_temps WHERE collaborateur_id = ANY ($1::uuid[]) AND semaine = ANY ($2::date[])`,
    [ids, semaines],
  );
  const feuilles = new Map(
    f.rows.map((l) => [`${l.collaborateur_id as string}|${l.semaine as string}`, l]),
  );
  // Regroupement par collaborateur en un passage (au lieu d'un filtre par collaborateur).
  const affectationsPar = new Map<string, typeof affectations>();
  for (const a of affectations) {
    const liste = affectationsPar.get(a.personneId);
    if (liste) liste.push(a);
    else affectationsPar.set(a.personneId, [a]);
  }
  const facturablesPar = new Map<string, number[]>();
  for (const l of t.rows) {
    const liste = facturablesPar.get(l.collaborateur_id as string);
    if (liste) liste.push(joursDe(l.centiemes));
    else facturablesPar.set(l.collaborateur_id as string, [joursDe(l.centiemes)]);
  }
  return r.rows.map((c) => {
    const id = c.id as string;
    const attendues: FeuilleAttendue[] = c.saisit
      ? semaines
          .filter((s) => s >= lundiDeLaSemaine(c.depuis as string))
          .flatMap((s) => {
            const feuille = feuilles.get(`${id}|${s}`);
            if (feuille?.origine === "import") return [];
            return [
              {
                dateLimite: ajouterJours(s, 6),
                dateSoumission: (feuille?.soumise_le as string | null | undefined) ?? null,
              },
            ];
          })
      : [];
    return {
      id,
      nom: c.nom as string,
      grade_code: (c.grade_code as string | null) ?? null,
      grade_libelle: (c.grade_libelle as string | null) ?? null,
      grade_ordre: Number(c.grade_ordre),
      disponibles: capacite(periode, calendrier, absences.get(id) ?? [], Number(c.capacite_pct)),
      affectes: sommerJours(
        (affectationsPar.get(id) ?? []).map((a) => joursAffectesSurPeriode(a, periode, calendrier)),
      ),
      facturables: sommerJours(facturablesPar.get(id) ?? []),
      feuilles: attendues,
    };
  });
}

function vueCharge(
  c: Pick<CollaborateurIndicateurs, "disponibles" | "affectes" | "facturables" | "feuilles">,
  dateReference: string,
) {
  return {
    jours_disponibles: c.disponibles,
    jours_affectes: c.affectes,
    taux_occupation: tauxOccupation(c.affectes, c.disponibles),
    jours_facturables: c.facturables,
    taux_facturabilite: tauxFacturabilite(c.facturables, c.disponibles),
    discipline_saisie: disciplineSaisie(c.feuilles, dateReference),
  };
}

function cumulerCharge(liste: readonly CollaborateurIndicateurs[]) {
  return {
    disponibles: sommerJours(liste.map((c) => c.disponibles)),
    affectes: sommerJours(liste.map((c) => c.affectes)),
    facturables: sommerJours(liste.map((c) => c.facturables)),
    feuilles: liste.flatMap((c) => c.feuilles),
  };
}

/* ----- Missions ----- */

interface MissionIndicateurs {
  mission: MissionDonnees;
  budget: number;
  realise: number;
  atterrissage: number;
  jalons: Jalon[];
  /** Montants convertis dans la devise du cabinet (null : non convertible ou pas de droit). */
  m: {
    periode: ComposantesMarge;
    factureCumul: Montant;
    standardCumul: Montant;
    encours: Encours;
    coutsBudget: Montant;
    coutsAtterrissage: Montant;
    /** Signé − valeur produite (taux de vente) : finance.lire seulement. */
    commande: CommandeMission | null;
    /** Signé − facturé (données déjà visibles avec budget.lire_montants). */
    commandeFacturee: CommandeMission | null;
  } | null;
}

async function jalonsDesMissions(
  db: Db,
  ids: readonly string[],
  periode: Periode,
): Promise<Map<string, Jalon[]>> {
  const parMission = new Map<string, Jalon[]>();
  if (ids.length === 0) return parMission;
  const r = await db.query(
    `SELECT mission_id, date_prevue::text AS date_prevue, atteint,
       (modifie_le AT TIME ZONE 'UTC')::date::text AS modifie
     FROM mission_jalons
     WHERE mission_id = ANY ($1::uuid[]) AND date_prevue BETWEEN $2 AND $3`,
    [ids, periode.debut, periode.fin],
  );
  for (const j of r.rows) {
    const id = j.mission_id as string;
    parMission.set(id, [
      ...(parMission.get(id) ?? []),
      { datePrevue: j.date_prevue as string, dateReelle: j.atteint ? (j.modifie as string) : null },
    ]);
  }
  return parMission;
}

function montantsMission(
  a: AnalyseMission,
  cumul: AnalyseMission,
  coutsBudget: Montant,
  coutsAtterrissage: Montant,
  signe: Montant | null,
  devise: Devise,
): MissionIndicateurs["m"] {
  const c = (m: Montant) => versDeviseCabinet(m, a.mission, devise);
  const encours = encoursMission(cumul.valeur_produite, cumul.honoraires_factures);
  const valeurs = [
    c(a.honoraires_factures),
    c(a.couts_internes),
    c(a.debours_non_refactures),
    c(a.sous_traitance),
    c(cumul.honoraires_factures),
    c(cumul.valeur_standard),
    c(encours.encoursProduction),
    c(encours.factureDAvance),
    c(coutsBudget),
    c(coutsAtterrissage),
    c(cumul.valeur_produite),
    signe === null ? zero(devise) : c(signe),
  ];
  if (valeurs.some((v) => v === null)) return null;
  const [hon, ci, dnr, st, fact, std, enc, avance, cb, ca, produit, signeC] = valeurs as Montant[];
  return {
    periode: {
      honoraires: hon as Montant,
      coutsInternes: ci as Montant,
      deboursNonRefactures: dnr as Montant,
      sousTraitance: st as Montant,
    },
    factureCumul: fact as Montant,
    standardCumul: std as Montant,
    encours: { encoursProduction: enc as Montant, factureDAvance: avance as Montant },
    coutsBudget: cb as Montant,
    coutsAtterrissage: ca as Montant,
    commande:
      signe === null
        ? null
        : { honorairesSignes: signeC as Montant, honorairesProduits: produit as Montant },
    commandeFacturee:
      signe === null
        ? null
        : { honorairesSignes: signeC as Montant, honorairesProduits: fact as Montant },
  };
}

async function indicateursMissions(
  db: Db,
  auth: Auth,
  periode: Periode,
  devise: Devise,
): Promise<{ missions: MissionIndicateurs[]; exclues: string[] }> {
  const toutes = (await chargerMissions(db, auth)).filter(
    (m) =>
      (m.cloturee_le === null || m.cloturee_le >= periode.debut) &&
      (m.date_signature === null || m.date_signature <= periode.fin),
  );
  const ids = toutes.map((m) => m.id);
  const jalons = await jalonsDesMissions(db, ids, periode);
  // Coûts et tarifications lus une fois pour les deux analyses (période et cumul).
  const references = await chargerReferencesAnalyse(db, toutes);
  const surPeriode = await analyserMissions(db, toutes, periode.debut, periode.fin, references);
  const cumulees = await analyserMissions(db, toutes, null, periode.fin, references);
  // Suivi en jours de toutes les missions en lot (nombre de requêtes constant).
  const suivis = await suivisMissions(db, auth.cabinetId, ids);
  const exclues: string[] = [];
  const missions: MissionIndicateurs[] = [];
  for (const [i, mission] of toutes.entries()) {
    const a = surPeriode[i] as AnalyseMission;
    const cumul = cumulees[i] as AnalyseMission;
    const suivi = suivis.get(mission.id) as SuiviMission;
    const s = suivi.arbre.suivi;
    const reference = syntheseReference(cumul.tarification);
    const atterrissage = cumul.tarification.reference
      ? versionAtterrissage(cumul.tarification.reference, suivi, mission.mode_facturation)
      : null;
    const m = montantsMission(
      a,
      cumul,
      reference ? coutsProduction(reference) : zero(mission.devise),
      atterrissage ? coutsProduction(atterrissage.synthese) : zero(mission.devise),
      reference && mission.statut !== "cloturee" ? reference.honoraires : null,
      devise,
    );
    if (m === null) exclues.push(mission.id);
    missions.push({
      mission,
      budget: s.budget,
      realise: s.realise,
      atterrissage: s.atterrissage,
      jalons: jalons.get(mission.id) ?? [],
      m,
    });
  }
  return { missions, exclues };
}

/** Indicateurs agrégés d'un groupe de missions (moteur sur les sommes). */
function vueMissions(
  liste: readonly MissionIndicateurs[],
  opts: OptionsIndicateurs,
  devise: Devise,
): Record<string, unknown> {
  const budget = sommerJours(liste.map((l) => l.budget));
  const realise = sommerJours(liste.map((l) => l.realise));
  const atterrissage = sommerJours(liste.map((l) => l.atterrissage));
  const avecMontants = liste
    .filter((l) => l.m !== null)
    .map((l) => l.m as NonNullable<MissionIndicateurs["m"]>);
  const somme = (f: (m: NonNullable<MissionIndicateurs["m"]>) => Montant) =>
    sommer(avecMontants.map(f), devise);
  const ecart = ecartTerminaison(
    { jours: budget, montant: somme((m) => m.coutsBudget) },
    { jours: atterrissage, montant: somme((m) => m.coutsAtterrissage) },
  );
  const vue: Record<string, unknown> = {
    nombre_missions: liste.length,
    jours_budget: budget,
    jours_realises: realise,
    jours_atterrissage: atterrissage,
    consommation_budgetaire: consommationBudgetaire(realise, budget),
    ecart_terminaison: {
      jours: ecart.ecartJours,
      relatif_jours: ecart.ecartRelatifJours,
      ...(opts.finance ? { couts_production: ecart.ecartMontant.valeur } : {}),
    },
    respect_jalons: respectJalons(
      liste.flatMap((l) => l.jalons),
      opts.dateReference,
    ),
  };
  if (opts.finance) {
    const composantes: ComposantesMarge = {
      honoraires: somme((m) => m.periode.honoraires),
      coutsInternes: somme((m) => m.periode.coutsInternes),
      deboursNonRefactures: somme((m) => m.periode.deboursNonRefactures),
      sousTraitance: somme((m) => m.periode.sousTraitance),
    };
    const marge = calculerMarge(composantes);
    const encours = encoursPortefeuille(
      avecMontants.map((m) => m.encours),
      devise,
    );
    vue.marge = {
      honoraires: composantes.honoraires.valeur,
      couts_internes: composantes.coutsInternes.valeur,
      debours_non_refactures: composantes.deboursNonRefactures.valeur,
      sous_traitance: composantes.sousTraitance.valeur,
      marge: marge.marge.valeur,
      taux_marge: marge.taux,
    };
    vue.taux_realisation = tauxRealisation(
      somme((m) => m.factureCumul),
      somme((m) => m.standardCumul),
    );
    vue.encours = {
      encours_production: encours.encoursProduction.valeur,
      facture_d_avance: encours.factureDAvance.valeur,
    };
  }
  if (opts.finance) {
    // Dérivé de la valeur produite (jours × taux de vente) : finance.lire seul.
    vue.carnet_commandes = carnetCommandes(
      avecMontants.flatMap((m) => (m.commande ? [m.commande] : [])),
      devise,
    ).valeur;
  }
  if (opts.finance || opts.montants) {
    // Honoraires signés − honoraires facturés : aucune donnée de taux.
    vue.carnet_commandes_facture = carnetCommandes(
      avecMontants.flatMap((m) => (m.commandeFacturee ? [m.commandeFacturee] : [])),
      devise,
    ).valeur;
  }
  return vue;
}

/* ----- Délai moyen d'encaissement ----- */

async function encaissementsSoldes(
  db: Db,
  auth: Auth,
  periode: Periode,
): Promise<{ client_id: string; client: string; facture: FactureEncaissee }[]> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT}, cl.raison_sociale AS client
     FROM factures f JOIN missions m ON m.id = f.mission_id JOIN clients cl ON cl.id = f.client_id
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_emission <= $1
       AND ${filtreVisibilite(2, 3)}`,
    [periode.fin, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  const factures = r.rows.map((l) => ({ ...versFacturePaiement(l), client: l.client as string }));
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
    periode.fin,
  );
  const dates = await db.query(
    `SELECT facture_id, max(date_imputation)::text AS derniere FROM imputations
     WHERE facture_id = ANY ($1::uuid[]) AND montant > 0 AND date_imputation <= $2
     GROUP BY facture_id`,
    [factures.map((f) => f.id), periode.fin],
  );
  const derniere = new Map(dates.rows.map((d) => [d.facture_id as string, d.derniere as string]));
  return factures.flatMap((f) => {
    const s = situationPaiement(f, imputations.get(f.id) ?? [], periode.fin);
    const date = derniere.get(f.id);
    if (s.statut_paiement !== "soldee" || !date || !f.date_emission) return [];
    if (date < periode.debut || date < f.date_emission) return [];
    return [
      {
        client_id: f.client_id,
        client: f.client,
        facture: { dateEmission: f.date_emission, dateEncaissement: date, montant: s.net_a_payer },
      },
    ];
  });
}

/* ----- Assemblage ----- */

export async function calculerIndicateurs(
  db: Db,
  auth: Auth,
  opts: OptionsIndicateurs,
): Promise<Record<string, unknown>> {
  const periode: Periode = { debut: opts.du, fin: opts.au };
  const devise = await deviseDuCabinet(db, auth.cabinetId);
  const collaborateurs = await indicateursCollaborateurs(db, auth.cabinetId, periode);
  const { missions, exclues } = await indicateursMissions(db, auth, periode, devise);
  const soldes = await encaissementsSoldes(db, auth, periode);

  const cabinet = {
    ...vueCharge(cumulerCharge(collaborateurs), opts.dateReference),
    ...vueMissions(missions, opts, devise),
    delai_moyen_encaissement: delaiMoyenEncaissement(soldes.map((s) => s.facture)),
    factures_soldees: soldes.length,
  };

  let elements: Record<string, unknown>[] = [];
  switch (opts.niveau) {
    case "collaborateur":
      elements = collaborateurs.map((c) => ({
        collaborateur_id: c.id,
        nom: c.nom,
        grade_code: c.grade_code,
        ...vueCharge(c, opts.dateReference),
      }));
      break;
    case "grade": {
      const grades = new Map<string, CollaborateurIndicateurs[]>();
      for (const c of collaborateurs) {
        const cle = c.grade_code ?? "";
        grades.set(cle, [...(grades.get(cle) ?? []), c]);
      }
      elements = [...grades.values()]
        .sort((a, b) => (a[0]?.grade_ordre ?? 0) - (b[0]?.grade_ordre ?? 0))
        .map((liste) => ({
          grade_code: liste[0]?.grade_code ?? null,
          grade_libelle: liste[0]?.grade_libelle ?? "Sans grade",
          nombre_collaborateurs: liste.length,
          ...vueCharge(cumulerCharge(liste), opts.dateReference),
        }));
      break;
    }
    case "mission":
      elements = missions.map((l) => ({
        mission_id: l.mission.id,
        intitule: l.mission.intitule,
        client_id: l.mission.client_id,
        directeur_id: l.mission.directeur_id,
        devise_mission: l.mission.devise,
        ...vueMissions([l], opts, devise),
      }));
      break;
    case "associe": {
      const groupes = new Map<string, MissionIndicateurs[]>();
      for (const l of missions) {
        const cle = l.mission.directeur_id ?? "";
        groupes.set(cle, [...(groupes.get(cle) ?? []), l]);
      }
      elements = [...groupes.values()].map((liste) => ({
        directeur_id: liste[0]?.mission.directeur_id ?? null,
        nom: liste[0]?.mission.directeur_nom ?? "Sans directeur",
        ...vueMissions(liste, opts, devise),
      }));
      break;
    }
    case "client": {
      const clients = new Map<string, { nom: string; missions: MissionIndicateurs[] }>();
      for (const l of missions) {
        const g = clients.get(l.mission.client_id) ?? {
          nom: l.mission.client_raison_sociale,
          missions: [],
        };
        g.missions.push(l);
        clients.set(l.mission.client_id, g);
      }
      for (const s of soldes) {
        if (!clients.has(s.client_id)) clients.set(s.client_id, { nom: s.client, missions: [] });
      }
      elements = [...clients.entries()].map(([clientId, g]) => {
        const siens = soldes.filter((s) => s.client_id === clientId).map((s) => s.facture);
        const vue = vueMissions(g.missions, opts, devise);
        return {
          client_id: clientId,
          raison_sociale: g.nom,
          nombre_missions: g.missions.length,
          delai_moyen_encaissement: delaiMoyenEncaissement(siens),
          factures_soldees: siens.length,
          ...(opts.finance ? { marge: vue.marge } : {}),
        };
      });
      break;
    }
    default:
      elements = [];
  }

  return {
    du: opts.du,
    au: opts.au,
    date_reference: opts.dateReference,
    niveau: opts.niveau,
    devise,
    droits: { finance: opts.finance, montants: opts.finance || opts.montants },
    cabinet,
    elements,
    ...(opts.finance || opts.montants ? { missions_exclues: exclues } : {}),
  };
}

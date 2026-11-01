import {
  ajouterJours,
  choisirFactureASolderDemo,
  dateEmissionAdmissibleDemo,
  libelleSemaineDemo,
  montant as montantMoteur,
  ordonnerSourcesFactureDemo,
  PARAMETRES_ACTIVITE_DEMO,
  type DateISO,
  type FactureOuverteDemo,
  type RoleApprobateur,
  type SourceFactureDemo,
} from "@missionpilot/engines";
import { aPermission, encaissementCreationSchema } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import { conflit, interdit } from "../errors.js";
import {
  calculerRegie,
  chargerEcheances,
  echeancesMoteur,
  exigerDansLeBudget,
  exigerEcheance,
  honorairesSignes,
  insererEcheance,
  rattacherTemps,
} from "../facturation/echeancier.js";
import {
  calculEnregistre,
  creerBrouillon,
  cumulHtAutresFactures,
  emettre,
  lireFacture,
  roleApprobationFacture,
} from "../facturation/factures.js";
import { peutGererEcheancier } from "../facturation/outils.js";
import { creerEncaissement } from "../finance/encaissements.js";
import {
  estAssocie,
  exigerMissionModifiable,
  exigerMissionVisible,
  STATUTS_SIGNES,
  type MissionAcces,
} from "../missions/acces.js";
import { satisfaitRole } from "../missions/budget.js";
import { approbateurFactureDemo, auteurJalonDemo, emetteurFactureDemo } from "./acteurs.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  dansPointDeSauvegarde,
  idsMarques,
  marqueurExiste,
  poserMarqueur,
  type ContexteActiviteDemo,
} from "./commun.js";
import {
  derniereEmissionExerciceDemo,
  dernieresFacturesParMissionDemo,
  lireFacturesOuvertesDemo,
  type MissionDemo,
} from "./lecture.js";

/*
 * ÉVÉNEMENTS DE LA SEMAINE de la tâche « activite_demo » (DECISIONS « Activité de démonstration
 * automatique », DT2, DT8, DT16) : un jalon atteint, une facture émise et un encaissement, AU PLUS
 * un de chaque par cabinet et par semaine, pour la seule semaine qui contient le jour d'exécution
 * (job.ts ne les demande que si `jourEvenementDemo` est non nul ; une semaine rattrapée n'en reçoit
 * aucun).
 *
 * - Aucune refonte de route (DT4) : la facture passe par creerBrouillon, roleApprobationFacture,
 *   cumulHtAutresFactures, calculEnregistre et emettre ; l'échéancier par
 *   facturation/echeancier.ts ; l'encaissement par creerEncaissement (verrou, trop-perçu, date
 *   d'émission), jamais par un INSERT direct. Les transitions propres aux routes (échéance prévue →
 *   à facturer, soumission et approbation d'une facture, création d'un jalon) sont recopiées en SQL
 *   MIROIR, chaque bloc commenté « miroir de <route>:<lignes> » : à relire si la route change.
 * - Acteurs (acteurs.ts) : jalon par le chef, à défaut le directeur ; facture, régie et
 *   encaissement par le gestionnaire, à défaut un associé ; approbation par le directeur de la
 *   mission, à défaut un associé, jamais par qui a créé, soumis ou modifié la facture (même un
 *   associé).
 * - Horodatages (DT3) : ceux que la base n'impose pas valent l'horloge du contexte ; émission et
 *   encaissement sont datés du jour `j` (jamais après aujourd'hui), l'émission jamais avant la
 *   dernière de l'exercice (numérotation chronologique, factures.ts).
 * - Idempotence : marqueur `activite_demo.<x>` de la semaine, lu puis écrit dans le point de
 *   sauvegarde de l'écriture ; une erreur isolable n'annule que cette écriture (commun.ts).
 * - Les montants sortent des moteurs (facture, régie, solde) : aucune arithmétique ici ; ni montant
 *   ni nom dans le journal ou les incidents.
 */

/** Factures ouvertes lues au plus pour l'encaissement (lecture.ts, `LIMIT $n`). */
const FACTURES_OUVERTES_LUES = 200;
/** Marqueurs de factures de la tâche lus au plus sur la fenêtre de repérage. */
const FACTURES_TACHE_LUES = 200;
/** Fenêtre de repérage des factures émises par la tâche (encaissement, étape 2). */
const REPERAGE_FACTURES_JOURS = 120;

/** Les marqueurs d'une semaine se lisent depuis la veille de son lundi (index sur `cree_le`). */
const depuisLaVeille = (lundi: DateISO): DateISO => ajouterJours(lundi, -1);

const comparerId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type ContexteIncident =
  "activite_demo_jalon" | "activite_demo_facture" | "activite_demo_encaissement";

/** Incident sans contenu (ni montant, ni nom) ; renvoie null pour l'appelant. */
function incident(
  c: ContexteActiviteDemo,
  contexte: ContexteIncident,
  message: string,
  lundi: DateISO,
): null {
  journaliserIncident(contexte, message, { cabinet_id: c.cabinetId, semaine: lundi });
  return null;
}

/* ----- Jalon de la semaine (point de sauvegarde ad_jalon) ----- */

/**
 * Missions candidates au jalon : le plus de centièmes validés cette semaine d'abord (égalité :
 * identifiant) ; à défaut de tout temps, les missions en cours par identifiant.
 */
function candidatesJalon(
  temps: ReadonlyMap<string, number>,
  missions: readonly MissionDemo[],
): MissionDemo[] {
  const centiemes = (m: MissionDemo) => temps.get(m.id) ?? 0;
  const chargees = missions
    .filter((m) => centiemes(m) > 0)
    .sort((a, b) => centiemes(b) - centiemes(a) || comparerId(a.id, b.id));
  if (chargees.length > 0) return chargees;
  return missions.filter((m) => m.statut === "en_cours").sort((a, b) => comparerId(a.id, b.id));
}

/** Première candidate qui a un auteur de jalon (chef, à défaut directeur). */
function missionEtAuteurJalon(
  c: ContexteActiviteDemo,
  candidates: readonly MissionDemo[],
): { mission: MissionDemo; auteur: Auth } | null {
  for (const mission of candidates) {
    const auteur = auteurJalonDemo(c.acteurs, {
      chef_id: mission.chefId,
      directeur_id: mission.directeurId,
    });
    if (auteur) return { mission, auteur };
  }
  return null;
}

/**
 * Jalon ATTEINT daté de `j`, hors phase. Miroir de routes/decoupage.ts:301-321
 * (« mission.planifier », mission modifiable et verrouillée). Un INSERT ne publie aucun événement
 * d'automatisation : le déclencheur « jalon atteint » est `AFTER UPDATE OF atteint` (0302:52-54).
 * `modifie_le` (horloge) tombe le jour `j` = date prévue ≤ date de référence : le jalon compte
 * comme tenu (finance/indicateurs.ts:266-277).
 */
async function insererJalon(
  c: ContexteActiviteDemo,
  auteur: Auth,
  missionId: string,
  lundi: DateISO,
  j: DateISO,
): Promise<string> {
  if (!aPermission(auteur.roles, "mission.planifier")) throw interdit();
  await exigerMissionModifiable(c.db, auteur, missionId);
  const dernier = await c.db.query(
    "SELECT ordre FROM mission_jalons WHERE mission_id = $1 ORDER BY ordre DESC LIMIT 1",
    [missionId],
  );
  const r = await c.db.query(
    `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, date_prevue, atteint,
       ordre, cree_le, modifie_le)
     VALUES ($1, $2, NULL, $3, $4, true, $5, $6, $6) RETURNING id`,
    [
      c.cabinetId,
      missionId,
      `Point d'étape — ${libelleSemaineDemo(lundi)}`,
      j,
      Number(dernier.rows[0]?.ordre ?? 0) + 1,
      c.maintenant,
    ],
  );
  return r.rows[0].id as string;
}

/**
 * Jalon de la semaine : sur la mission la plus chargée en temps validés cette semaine (à défaut,
 * la première mission en cours). Renvoie son identifiant, ou null (déjà posé, aucun auteur, échec
 * isolé).
 */
export async function poserJalonDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
  tempsParMission: ReadonlyMap<string, number>,
  missions: readonly MissionDemo[],
): Promise<string | null> {
  const id = await dansPointDeSauvegarde(c, "ad_jalon", "jalon", { semaine: lundi }, async () => {
    const action = ACTIONS_ACTIVITE_DEMO.jalon;
    if (await marqueurExiste(c.db, action, { semaine: lundi }, depuisLaVeille(lundi))) return null;
    const choix = missionEtAuteurJalon(c, candidatesJalon(tempsParMission, missions));
    if (!choix) {
      return incident(c, "activite_demo_jalon", "Aucune mission ni auteur pour le jalon.", lundi);
    }
    const jalonId = await insererJalon(c, choix.auteur, choix.mission.id, lundi, j);
    await poserMarqueur(c, action, "mission_jalon", jalonId, {
      semaine: lundi,
      mission_id: choix.mission.id,
    });
    return jalonId;
  });
  if (id) c.bilan.jalons += 1;
  return id;
}

/* ----- Facture de la semaine (points de sauvegarde ad_facture, ad_facture_source) ----- */

/**
 * Échéances dues non liées à une facture en cours, au plus `$3` par mission (à facturer d'abord,
 * puis par date), sur des missions signées ou en cours dont le client est actif.
 */
const SQL_ECHEANCES_DUES = `SELECT e.id, e.mission_id, e.statut, e.date_prevue
  FROM (SELECT x.id, x.mission_id, x.statut, x.date_prevue::text AS date_prevue,
          row_number() OVER (PARTITION BY x.mission_id
            ORDER BY (x.statut = 'a_facturer') DESC, x.date_prevue, x.id) AS rang
        FROM echeances_facturation x
        JOIN missions m ON m.id = x.mission_id JOIN clients cl ON cl.id = m.client_id
        WHERE x.mission_id = ANY ($1::uuid[]) AND x.statut IN ('prevue', 'a_facturer')
          AND x.date_prevue <= $2::date AND m.statut IN ('signee', 'en_cours') AND cl.actif
          AND NOT EXISTS (SELECT 1 FROM facturation_liens l
                          WHERE l.echeance_id = x.id AND l.libere_le IS NULL)) e
  WHERE e.rang <= $3
  ORDER BY e.mission_id, e.rang
  LIMIT $4`;

/**
 * Sources de la facture, dans l'ordre du moteur (mission la moins récemment facturée d'abord, puis
 * à facturer, prévue, régie, date, identifiant), `sourcesFactureMax` au plus.
 */
async function sourcesFacture(
  c: ContexteActiviteDemo,
  j: DateISO,
  missions: readonly MissionDemo[],
): Promise<SourceFactureDemo[]> {
  const facturables = missions.filter((m) => m.clientActif);
  if (facturables.length === 0) return [];
  const ids = facturables.map((m) => m.id);
  const max = PARAMETRES_ACTIVITE_DEMO.sourcesFactureMax;
  const r = await c.db.query(SQL_ECHEANCES_DUES, [ids, j, max, ids.length * max]);
  const sources: SourceFactureDemo[] = [
    ...r.rows.map((e) => ({
      type: "echeance" as const,
      missionId: e.mission_id as string,
      echeanceId: e.id as string,
      statut: e.statut as "a_facturer" | "prevue",
      datePrevue: e.date_prevue as string,
    })),
    ...facturables
      .filter((m) => m.modeFacturation === "regie")
      .map((m) => ({ type: "regie" as const, missionId: m.id })),
  ];
  const dernieres = await dernieresFacturesParMissionDemo(c.db, ids);
  return ordonnerSourcesFactureDemo(sources, dernieres, j).slice(0, max);
}

/** Miroir de routes/factures.ts:136-145 : « facture.emettre », mission visible et signée. */
async function missionFacturable(
  c: ContexteActiviteDemo,
  emetteur: Auth,
  missionId: string,
): Promise<MissionAcces> {
  if (!aPermission(emetteur.roles, "facture.emettre")) throw interdit();
  const mission = await exigerMissionVisible(c.db, emetteur, missionId, true);
  if (!STATUTS_SIGNES.includes(mission.statut)) {
    throw conflit("Une mission se facture après la signature de la lettre de mission.");
  }
  return mission;
}

/**
 * Échéance due passée « à facturer » si elle est prévue, montant inchangé. Miroir de
 * routes/echeancier.ts:336-410 (PATCH du seul statut) : gestion de l'échéancier, échéance
 * verrouillée après la mission, ni facturée ni rattachée, échéancier dans le budget signé.
 */
async function echeanceAFacturer(
  c: ContexteActiviteDemo,
  emetteur: Auth,
  mission: MissionAcces,
  echeanceId: string,
): Promise<string> {
  if (!peutGererEcheancier(emetteur, mission)) throw interdit();
  const e = await exigerEcheance(c.db, echeanceId, true);
  if (e.mission_id !== mission.id) throw conflit("Échéance d'une autre mission.");
  if (e.statut === "facturee") throw conflit("Échéance facturée : la corriger par un avoir.");
  if (e.facture_id) throw conflit("Échéance rattachée à une facture en cours.");
  if (e.statut === "prevue") {
    const budget = await honorairesSignes(c.db, mission);
    exigerDansLeBudget(echeancesMoteur(await chargerEcheances(c.db, mission.id)), budget);
    await c.db.query(
      `UPDATE echeances_facturation SET statut = 'a_facturer', modifie_le = now()
       WHERE id = $1 AND statut = 'prevue'`,
      [e.id],
    );
  }
  return e.id;
}

/**
 * Échéances de régie (une par mois) sur les temps validés jusqu'à `j`, temps rattachés ; [] s'il
 * n'y a rien à facturer. Miroir de routes/echeancier.ts:223-278 (montants : moteur, échéancier
 * borné par le budget signé).
 */
async function echeancesDeRegie(
  c: ContexteActiviteDemo,
  emetteur: Auth,
  mission: MissionAcces,
  j: DateISO,
): Promise<string[]> {
  if (!peutGererEcheancier(emetteur, mission)) throw interdit();
  const m = await c.db.query("SELECT mode_facturation FROM missions WHERE id = $1", [mission.id]);
  if (m.rows[0]?.mode_facturation !== "regie") {
    throw conflit("Seule une mission en régie se facture sur les temps validés.");
  }
  const regies = await calculerRegie(c.db, mission, j);
  if (regies.length === 0) return [];
  const budget = await honorairesSignes(c.db, mission);
  const existantes = await chargerEcheances(c.db, mission.id);
  exigerDansLeBudget(
    [
      ...echeancesMoteur(existantes),
      ...regies.map((r) => ({
        libelle: r.echeance.libelle,
        date: r.echeance.date_prevue,
        montant: montantMoteur(r.echeance.montant, budget.devise),
      })),
    ],
    budget,
  );
  const ids: string[] = [];
  for (const [i, r] of regies.entries()) {
    const id = await insererEcheance(
      c.db,
      c.cabinetId,
      mission,
      r.echeance,
      existantes.length + i + 1,
      emetteur.utilisateurId,
    );
    await rattacherTemps(c.db, c.cabinetId, mission.id, id, r.temps);
    ids.push(id);
  }
  return ids;
}

/**
 * Soumission, miroir de routes/factures.ts:292-313 : rôle exigé par les seuils du moteur sur la
 * facture ET le cumul HT de la mission (verrouillée). Un brouillon né d'au moins une échéance a
 * toujours une ligne (creerBrouillon).
 */
async function soumettreFacture(
  c: ContexteActiviteDemo,
  emetteur: Auth,
  mission: MissionAcces,
  factureId: string,
): Promise<RoleApprobateur> {
  const facture = await lireFacture(c.db, factureId, true);
  const requis = roleApprobationFacture(
    await calculEnregistre(c.db, facture),
    mission,
    await cumulHtAutresFactures(c.db, facture),
  );
  const r = await c.db.query(
    `UPDATE factures SET statut = 'a_approuver', role_approbateur = $2, soumise_par = $3,
       soumise_le = $4, motif_rejet = NULL, modifie_le = $4
     WHERE id = $1 AND statut = 'brouillon'`,
    [factureId, requis, emetteur.utilisateurId, c.maintenant],
  );
  if (r.rowCount !== 1) throw conflit("La facture n'est plus en brouillon.");
  return requis;
}

/**
 * Contrôles de la route d'approbation (routes/factures.ts:324-353), en plus strict : même un
 * associé n'approuve pas une facture qu'il a créée, soumise ou modifiée.
 */
function exigerApprobateur(
  a: Auth,
  mission: MissionAcces,
  exclus: readonly string[],
  requis: RoleApprobateur,
): void {
  const autorise =
    aPermission(a.roles, "facture.valider") &&
    (estAssocie(a) || mission.directeur_id === a.utilisateurId) &&
    !exclus.includes(a.utilisateurId) &&
    satisfaitRole(a.roles, requis);
  if (!autorise) throw interdit();
}

/** Approbation, miroir de routes/factures.ts:320-362 (approbateur choisi par acteurs.ts). */
async function approuverFacture(
  c: ContexteActiviteDemo,
  mission: MissionAcces,
  factureId: string,
  requis: RoleApprobateur,
): Promise<void> {
  const f = await lireFacture(c.db, factureId, true);
  const exclus = [f.cree_par, ...(f.soumise_par ? [f.soumise_par] : []), ...(f.modifie_par ?? [])];
  const approbateur = approbateurFactureDemo(c.acteurs, mission, exclus, requis);
  if (!approbateur) throw conflit("Aucun approbateur possible pour la facture.");
  exigerApprobateur(approbateur, mission, exclus, requis);
  const r = await c.db.query(
    `UPDATE factures SET statut = 'approuvee', approuvee_par = $2, approuvee_le = $3,
       modifie_le = $3
     WHERE id = $1 AND statut = 'a_approuver'`,
    [factureId, approbateur.utilisateurId, c.maintenant],
  );
  if (r.rowCount !== 1) throw conflit("La facture n'est pas à approuver.");
}

/**
 * Une source jusqu'à l'émission : échéance (prévue → à facturer) ou régie, brouillon, soumission,
 * approbation, émission datée. Null si la source n'a rien à facturer ; toute erreur (mentions
 * légales incomplètes : 409 MENTIONS_INCOMPLETES, budget dépassé…) est isolée par l'appelant.
 */
async function facturerSource(
  c: ContexteActiviteDemo,
  emetteur: Auth,
  s: SourceFactureDemo,
  lundi: DateISO,
  j: DateISO,
  dateEmission: DateISO,
): Promise<string | null> {
  const mission = await missionFacturable(c, emetteur, s.missionId);
  const echeanceIds =
    s.type === "echeance"
      ? [await echeanceAFacturer(c, emetteur, mission, s.echeanceId)]
      : await echeancesDeRegie(c, emetteur, mission, j);
  if (echeanceIds.length === 0) return null;
  const factureId = await creerBrouillon(c.db, emetteur, mission, {
    echeance_ids: echeanceIds,
    debours_ids: [],
    objet: `Honoraires — ${libelleSemaineDemo(lundi)}`,
  });
  const requis = await soumettreFacture(c, emetteur, mission, factureId);
  await approuverFacture(c, mission, factureId, requis);
  await emettre(c.db, emetteur, await lireFacture(c.db, factureId, true), dateEmission);
  return factureId;
}

/** Corps du point de sauvegarde ad_facture : marqueur, garde chronologique, sources essayées. */
async function facturerSiAbsente(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
  missions: readonly MissionDemo[],
): Promise<string | null> {
  const action = ACTIONS_ACTIVITE_DEMO.facture;
  if (await marqueurExiste(c.db, action, { semaine: lundi }, depuisLaVeille(lundi))) return null;
  const emetteur = emetteurFactureDemo(c.acteurs);
  if (!emetteur) return incident(c, "activite_demo_facture", "Aucun émetteur de facture.", lundi);
  const derniere = await derniereEmissionExerciceDemo(c.db, Number(j.slice(0, 4)));
  const dateEmission = dateEmissionAdmissibleDemo(j, derniere);
  if (!dateEmission) {
    const message = "Date d'émission antérieure à la dernière émission de l'exercice.";
    return incident(c, "activite_demo_facture", message, lundi);
  }
  for (const s of await sourcesFacture(c, j, missions)) {
    const reperes = { semaine: lundi, mission_id: s.missionId, source: s.type };
    const factureId = await dansPointDeSauvegarde(c, "ad_facture_source", "facture", reperes, () =>
      facturerSource(c, emetteur, s, lundi, j, dateEmission),
    );
    if (!factureId) continue;
    await poserMarqueur(c, action, "facture", factureId, reperes);
    return factureId;
  }
  return incident(c, "activite_demo_facture", "Aucune source facturable.", lundi);
}

/**
 * Facture de la semaine (une au plus par cabinet, DT16) : la première source qui aboutit, parmi
 * `sourcesFactureMax` au plus, chacune dans son propre point de sauvegarde. Émise au jour `j`, ou
 * pas du tout si une émission postérieure existe déjà dans l'exercice. Renvoie son identifiant.
 */
export async function facturerSemaineDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
  missions: readonly MissionDemo[],
): Promise<string | null> {
  const id = await dansPointDeSauvegarde(c, "ad_facture", "facture", { semaine: lundi }, () =>
    facturerSiAbsente(c, lundi, j, missions),
  );
  if (id) c.bilan.factures += 1;
  return id;
}

/* ----- Encaissement de la semaine (point de sauvegarde ad_encaissement) ----- */

type FacturesOuvertes = Awaited<ReturnType<typeof lireFacturesOuvertesDemo>>;

/** Factures ouvertes émises avant le lundi, celles de la tâche repérées par leurs marqueurs. */
async function facturesASolder(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
): Promise<{ ouvertes: FacturesOuvertes; candidates: FactureOuverteDemo[] }> {
  const ouvertes = await lireFacturesOuvertesDemo(c.db, lundi, FACTURES_OUVERTES_LUES);
  const depuis = ajouterJours(j, -REPERAGE_FACTURES_JOURS);
  const duJob = new Set(
    await idsMarques(c.db, ACTIONS_ACTIVITE_DEMO.facture, depuis, FACTURES_TACHE_LUES),
  );
  const candidates = ouvertes.flatMap(({ facture, solde }): FactureOuverteDemo[] =>
    facture.date_emission
      ? [
          {
            id: facture.id,
            dateEmission: facture.date_emission,
            soldeMineur: solde.valeur,
            emiseParJob: duJob.has(facture.id),
          },
        ]
      : [],
  );
  return { ouvertes, candidates };
}

/** Corps du point de sauvegarde ad_encaissement : marqueur, choix (DT8), creerEncaissement. */
async function encaisserSiAbsent(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
): Promise<string | null> {
  const action = ACTIONS_ACTIVITE_DEMO.encaissement;
  if (await marqueurExiste(c.db, action, { semaine: lundi }, depuisLaVeille(lundi))) return null;
  const gestionnaire = emetteurFactureDemo(c.acteurs);
  if (!gestionnaire) {
    const message = "Aucun gestionnaire des encaissements.";
    return incident(c, "activite_demo_encaissement", message, lundi);
  }
  const { ouvertes, candidates } = await facturesASolder(c, lundi, j);
  const choisie = choisirFactureASolderDemo(candidates, lundi, j);
  const o = ouvertes.find((x) => x.facture.id === choisie);
  if (!o) return null;
  // Miroir de routes/encaissements.ts:98-102 (« encaissement.gerer ») ; tous les contrôles de
  // l'encaissement (même client et devise, trop-perçu, date) sont ceux du service.
  if (!aPermission(gestionnaire.roles, "encaissement.gerer")) throw interdit();
  const id = await creerEncaissement(
    c.db,
    gestionnaire,
    encaissementCreationSchema.parse({
      client_id: o.facture.client_id,
      date: j,
      montant: o.solde.valeur,
      devise: o.facture.devise,
      mode: "virement",
      reference: `VIR-DEMO-${lundi}`,
      imputations: [{ facture_id: o.facture.id, montant: o.solde.valeur }],
    }),
  );
  await poserMarqueur(c, action, "encaissement", id, { semaine: lundi, facture_id: o.facture.id });
  return id;
}

/**
 * Encaissement de la semaine (un au plus par cabinet) : solde entier d'une facture émise avant le
 * lundi, choisie par le moteur (DT8 : facture de la tâche d'au moins 21 jours, sinon facture non
 * issue de la tâche, sinon facture de la tâche d'au moins 7 jours), daté et imputé au jour `j`.
 * Aucune relance, donc aucun e-mail. Renvoie l'identifiant de l'encaissement.
 */
export async function encaisserSemaineDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  j: DateISO,
): Promise<string | null> {
  const id = await dansPointDeSauvegarde(
    c,
    "ad_encaissement",
    "encaissement",
    { semaine: lundi },
    () => encaisserSiAbsent(c, lundi, j),
  );
  if (id) c.bilan.encaissements += 1;
  return id;
}

import { ajouterJours, lundiDeLaSemaine, type DateISO } from "@missionpilot/engines";
import { emettre, lireFacture } from "../src/facturation/factures.js";
import type { HandlerJob } from "../src/jobs/registre.js";
import {
  aFacturer,
  attendre,
  preparerFacturation,
  viderEmailsEnFile,
  type CabinetFacturation,
} from "./facturation-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  COUTS_TEST,
  creerMission,
  creerMissionSignee,
  type ApiUtilisateur,
} from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

/*
 * Fixture de l'activité de démonstration (job « activite_demo », migration 0584) : un cabinet
 * prêt à recevoir l'activité de la semaine de `dateReference`, construit par les VRAIES routes
 * (missions, découpage, signature, affectations, feuilles, échéancier, factures) ; le rôle
 * propriétaire ne sert qu'à poser `est_demo` et `actif` (réservés au propriétaire, `0570`) et à
 * compter.
 *
 * Avec L = lundi de `dateReference` :
 * - consultant (grade senior) et junior : collaborateurs internes rattachés à un utilisateur actif ;
 * - mission en RÉGIE, en cours, budget initial calculé depuis le découpage (Diagnostic : senior 20 j,
 *   junior 16 j ; Orientations : manager 8 j, senior 12 j), du lundi L − 56 sur 20 semaines,
 *   affectations nominatives sur 12 semaines, feuilles VALIDÉES des semaines L − 56 à L − 42
 *   (consultant 4 j, junior 3 j par semaine sur Diagnostic) ; les semaines suivantes sont libres ;
 * - mission au FORFAIT signée, échéancier 30 % à la signature (L − 47), 30 % à L − 14, 40 % à la
 *   fin ; l'acompte est facturé et ÉMIS le L − 45 (au moins 40 jours avant `dateReference`, qui est
 *   au plus tôt L), sans encaissement ; les deux autres échéances restent « prévues » ;
 * - coûts des collaborateurs datés AVANT les signatures (L − 400), mentions légales posées.
 *
 * Les e-mails mis en file par les routes (soumissions, alertes) sont retirés à la fin, comme dans
 * `preparerFacturation`. Les cabinets marqués démo sont démarqués par `retirerMarquesDemo`
 * (afterAll), sinon le plafond de 30 cabinets de démonstration (`0582`) et la liste « un clic »
 * des autres fichiers de test seraient faussés.
 */

type CollaborateurTest = ApiUtilisateur & { collaborateurId: string };

export interface CabinetDemoTest extends CabinetFacturation {
  consultant: CollaborateurTest;
  junior: CollaborateurTest;
  /** En cours, régie, budget depuis le découpage, affectations, feuilles validées passées. */
  missionRegie: { id: string; taches: Record<"diagnostic" | "orientations", string> };
  /** Signée, échéances prévues (non facturées). */
  missionForfait: { id: string; echeanceIds: string[] };
  /** Émise au moins 40 jours avant `dateReference`, non soldée. */
  factureAncienneId: string;
}

/** Date des coûts posés par `preparerCabinet` (missions-outils.ts). */
const DEBUT_COUTS_PREPARES = "2026-01-01";

/** Cabinets marqués démo par cette fixture, à démarquer en fin de fichier. */
const marques = new Set<string>();

export async function preparerCabinetDemo(
  ctx: Contexte,
  nom: string,
  o: { dateReference: DateISO; estDemo?: boolean; actif?: boolean },
): Promise<CabinetDemoTest> {
  const c = await preparerFacturation(ctx, nom);
  const lundi = lundiDeLaSemaine(o.dateReference);
  const consultant = await utilisateurCollaborateur(c, ["consultant"], "senior");
  const junior = await utilisateurCollaborateur(c, ["consultant"], "junior");
  await coutsAnterieurs(c, lundi, [
    ["senior", consultant.collaborateurId],
    ["junior", junior.collaborateurId],
  ]);
  const missionRegie = await semerMissionRegie(c, nom, lundi, consultant, junior);
  const forfait = await semerMissionForfait(ctx, c, nom, lundi);
  await viderEmailsEnFile(c.cabinetId);
  await antidaterArrivees(c.cabinetId, ajouterJours(lundi, -400));
  await marquerCabinet(c.cabinetId, o.estDemo ?? true, o.actif ?? true);
  return {
    ...c,
    consultant,
    junior,
    missionRegie,
    missionForfait: forfait.mission,
    factureAncienneId: forfait.factureId,
  };
}

/** Coûts journaliers datés avant les signatures (collaborateurs ajoutés, puis ceux du cabinet). */
async function coutsAnterieurs(
  c: CabinetFacturation,
  lundi: DateISO,
  ajoutes: readonly (readonly [string, string])[],
): Promise<void> {
  const depuis = ajouterJours(lundi, -400);
  const poser = async (grade: string, collaborateurId: string) => {
    const corps = {
      cout_journalier: COUTS_TEST[grade] as number,
      devise: "XOF",
      depuis_le: depuis,
    };
    const r = await c.associe.post(`/api/collaborateurs/${collaborateurId}/couts`, corps);
    attendre(201, r, `coûts antérieurs (${grade})`);
  };
  for (const [grade, id] of ajoutes) await poser(grade, id);
  // Les collaborateurs de preparerCabinet ont déjà des coûts au 2026-01-01.
  if (depuis >= DEBUT_COUTS_PREPARES) return;
  for (const [grade, id] of Object.entries(c.collaborateurs)) await poser(grade, id);
}

/** Phase et tâche de 60 jours ouvrés, budgétée en jours par grade (chef de mission). */
async function tacheBudgetee(
  c: CabinetFacturation,
  missionId: string,
  libelle: string,
  budget: Record<string, number>,
): Promise<string> {
  const phase = await c.chef.post(`/api/missions/${missionId}/phases`, { libelle });
  attendre(201, phase, "phase");
  const tache = await c.chef.post(`/api/missions/${missionId}/taches`, {
    parent_id: phase.json().id,
    libelle,
    duree_jours_ouvres: 60,
  });
  attendre(201, tache, "tâche");
  const lignes = Object.entries(budget).map(([code, jours]) => ({
    grade_id: c.grades[code],
    jours,
  }));
  const url = `/api/missions/${missionId}/taches/${tache.json().id}/budget`;
  attendre(200, await c.chef.put(url, { lignes }), "budget de tâche");
  return tache.json().id as string;
}

async function affecter(
  c: CabinetFacturation,
  missionId: string,
  a: { tacheId: string; collaborateurId: string; jours: number; debut: DateISO; fin: DateISO },
): Promise<void> {
  const r = await c.chef.post(`/api/missions/${missionId}/affectations`, {
    tache_id: a.tacheId,
    collaborateur_id: a.collaborateurId,
    jours_alloues: a.jours,
    date_debut: a.debut,
    date_fin: a.fin,
  });
  attendre(201, r, "affectation");
}

/** Feuille saisie (1 j par jour dès le lundi), soumise par son auteur, validée par le chef. */
async function feuilleValidee(
  c: CabinetFacturation,
  auteur: ApiUtilisateur,
  semaine: DateISO,
  tacheId: string,
  jours: number,
): Promise<void> {
  const f = await auteur.post("/api/feuilles-temps", { semaine, pre_remplir: false });
  attendre(201, f, `feuille du ${semaine}`);
  const id = f.json().id as string;
  const lignes = Array.from({ length: jours }, (_, i) => ({
    date: ajouterJours(semaine, i),
    tache_id: tacheId,
    jours: 1,
  }));
  attendre(200, await auteur.put(`/api/feuilles-temps/${id}/lignes`, { lignes }), "lignes");
  attendre(200, await auteur.post(`/api/feuilles-temps/${id}/soumettre`), "soumission");
  attendre(200, await c.chef.post(`/api/feuilles-temps/${id}/valider`, {}), "validation");
}

async function semerMissionRegie(
  c: CabinetFacturation,
  nom: string,
  lundi: DateISO,
  consultant: CollaborateurTest,
  junior: CollaborateurTest,
): Promise<CabinetDemoTest["missionRegie"]> {
  const debut = ajouterJours(lundi, -56);
  const m = await creerMission(c, {
    intitule: `Accompagnement en régie ${nom}`,
    type_mission_id: null,
    mode_facturation: "regie",
    date_debut: debut,
    date_fin: ajouterJours(debut, 7 * 20 - 3),
  });
  const taches = {
    diagnostic: await tacheBudgetee(c, m.id, "Diagnostic", { senior: 20, junior: 16 }),
    orientations: await tacheBudgetee(c, m.id, "Orientations", { manager: 8, senior: 12 }),
  };
  const signature = { date_signature: ajouterJours(debut, -3) };
  attendre(200, await c.directeur.post(`/api/missions/${m.id}/signer`, signature), "signature");
  const enCours = await c.directeur.post(`/api/missions/${m.id}/statut`, { statut: "en_cours" });
  attendre(200, enCours, "mission en cours");
  // Fenêtre des tâches de 60 jours ouvrés : du lundi de début au vendredi de la 12e semaine.
  const periode = { debut, fin: ajouterJours(debut, 7 * 11 + 4) };
  const affectations: [string, string, number][] = [
    [taches.diagnostic, consultant.collaborateurId, 20],
    [taches.orientations, consultant.collaborateurId, 12],
    [taches.diagnostic, junior.collaborateurId, 16],
  ];
  for (const [tacheId, collaborateurId, jours] of affectations) {
    await affecter(c, m.id, { tacheId, collaborateurId, jours, ...periode });
  }
  for (let i = 0; i < 3; i++) {
    const semaine = ajouterJours(debut, 7 * i);
    await feuilleValidee(c, consultant, semaine, taches.diagnostic, 4);
    await feuilleValidee(c, junior, semaine, taches.diagnostic, 3);
  }
  return { id: m.id, taches };
}

async function semerMissionForfait(
  ctx: Contexte,
  c: CabinetFacturation,
  nom: string,
  lundi: DateISO,
): Promise<{ mission: CabinetDemoTest["missionForfait"]; factureId: string }> {
  const debut = ajouterJours(lundi, -42);
  const fin = ajouterJours(debut, 7 * 16 - 3);
  const signature = ajouterJours(debut, -5);
  const corps = {
    intitule: `Plan stratégique ${nom}`,
    mode_facturation: "forfait",
    date_debut: debut,
    date_fin: fin,
  };
  const m = await creerMissionSignee(c, corps, { date_signature: signature });
  const jalons = [
    { libelle: "Acompte à la signature", pourcentage: 30, date: signature, type: "acompte" },
    { libelle: "Point d'étape", pourcentage: 30, date: ajouterJours(lundi, -14), type: "jalon" },
    { libelle: "Solde à la fin de la mission", pourcentage: 40, date: fin, type: "jalon" },
  ];
  const generation = await c.gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {
    jalons,
  });
  attendre(201, generation, "échéancier");
  const echeancier = await c.gestionnaire.get(`/api/missions/${m.id}/echeancier`);
  const lues = echeancier.json().echeances as { id: string; type: string }[];
  const acompte = lues.find((e) => e.type === "acompte") as { id: string };
  const factureId = await factureEmiseLe(ctx, c, m.id, acompte.id, ajouterJours(signature, 2));
  const echeanceIds = lues.filter((e) => e.id !== acompte.id).map((e) => e.id);
  return { mission: { id: m.id, echeanceIds }, factureId };
}

/** Facture d'une échéance par le circuit réel, émise à la date donnée (horloge passée). */
async function factureEmiseLe(
  ctx: Contexte,
  c: CabinetFacturation,
  missionId: string,
  echeanceId: string,
  date: DateISO,
): Promise<string> {
  await aFacturer(c.gestionnaire, echeanceId);
  const f = await c.gestionnaire.post(`/api/missions/${missionId}/factures`, {
    echeance_ids: [echeanceId],
  });
  attendre(201, f, "brouillon de facture");
  const id = f.json().id as string;
  attendre(200, await c.gestionnaire.post(`/api/factures/${id}/soumettre`), "soumission");
  attendre(200, await c.associe.post(`/api/factures/${id}/approuver`), "approbation");
  const emetteur = { cabinetId: c.cabinetId, utilisateurId: c.gestionnaire.utilisateurId };
  await ctx.db.withTenant(c.cabinetId, async (db) =>
    emettre(db, emetteur, await lireFacture(db, id, true), date),
  );
  return id;
}

/**
 * Antidate l'arrivée des collaborateurs du cabinet (`cree_le`, SQL propriétaire, comme le semis du
 * Tenant démo) à la date de leurs coûts : la discipline de saisie n'attend une feuille qu'à partir
 * de la semaine d'arrivée (finance/indicateurs.ts), et les tests rejouent des semaines passées.
 */
async function antidaterArrivees(cabinetId: string, arrivee: DateISO): Promise<void> {
  const sql = "UPDATE collaborateurs SET cree_le = $2::timestamptz WHERE cabinet_id = $1";
  await proprietaire((cl) => cl.query(sql, [cabinetId, `${arrivee}T00:00:00Z`]));
}

/** Pose `est_demo` et `actif` (colonnes réservées au propriétaire, `0570`). */
async function marquerCabinet(cabinetId: string, estDemo: boolean, actif: boolean): Promise<void> {
  const sql = "UPDATE cabinets SET est_demo = $2, actif = $3 WHERE id = $1";
  await proprietaire((cl) => cl.query(sql, [cabinetId, estDemo, actif]));
  if (estDemo) marques.add(cabinetId);
}

/** Démarque (est_demo faux) les cabinets marqués par cette fixture, ou ceux donnés. */
export async function retirerMarquesDemo(ids: readonly string[] = [...marques]): Promise<void> {
  if (ids.length === 0) return;
  const sql = "UPDATE cabinets SET est_demo = false WHERE id = ANY ($1::uuid[])";
  await proprietaire((cl) => cl.query(sql, [[...ids]]));
  for (const id of ids) marques.delete(id);
}

export type ComptesActiviteDemo = Record<
  | "feuilles"
  | "lignes"
  | "validations"
  | "restes"
  | "jalons"
  | "factures_emises"
  | "encaissements"
  | "versions"
  | "affectations"
  | "notifications"
  | "jobs_email"
  | "evenements_automatisation"
  | "jobs_activite",
  number
>;

/** Comptes d'un cabinet (rôle propriétaire, hors RLS) : écritures attendues ou interdites du job. */
export async function compterActiviteDemo(cabinetId: string): Promise<ComptesActiviteDemo> {
  const r = await proprietaire((cl) =>
    cl.query(
      `SELECT
         (SELECT count(*)::int FROM feuilles_temps WHERE cabinet_id = $1) AS feuilles,
         (SELECT count(*)::int FROM lignes_temps WHERE cabinet_id = $1) AS lignes,
         (SELECT count(*)::int FROM feuille_validations WHERE cabinet_id = $1) AS validations,
         (SELECT count(*)::int FROM reste_a_faire WHERE cabinet_id = $1) AS restes,
         (SELECT count(*)::int FROM mission_jalons WHERE cabinet_id = $1) AS jalons,
         (SELECT count(*)::int FROM factures WHERE cabinet_id = $1 AND statut = 'emise')
           AS factures_emises,
         (SELECT count(*)::int FROM encaissements WHERE cabinet_id = $1) AS encaissements,
         (SELECT count(*)::int FROM budget_versions WHERE cabinet_id = $1) AS versions,
         (SELECT count(*)::int FROM affectations WHERE cabinet_id = $1) AS affectations,
         (SELECT count(*)::int FROM notifications WHERE cabinet_id = $1) AS notifications,
         (SELECT count(*)::int FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email')
           AS jobs_email,
         (SELECT count(*)::int FROM automatisation_evenements WHERE cabinet_id = $1)
           AS evenements_automatisation,
         (SELECT count(*)::int FROM jobs WHERE cabinet_id = $1 AND type = 'activite_demo')
           AS jobs_activite`,
      [cabinetId],
    ),
  );
  return r.rows[0] as ComptesActiviteDemo;
}

/**
 * Handler limité aux cabinets donnés : une tâche d'un autre cabinet (base de test partagée,
 * worker d'un autre fichier) se termine sans rien écrire.
 */
export function seulementCabinetsDemo(ids: readonly string[], h: HandlerJob): HandlerJob {
  return async (ctx) => (ids.includes(ctx.cabinetId) ? h(ctx) : []);
}

import { aPermission, type RechercheQuery } from "@missionpilot/shared";
import {
  ajouterJours,
  composerFacturesEchues,
  composerKpiRouges,
  composerMesFeuilles,
  composerMesTaches,
  composerMissionsCandidates,
  composerRecherche,
  composerResumeMission,
  formaterMontant,
  LIMITE_ELEMENTS_COPILOTE,
  lundiDeLaSemaine,
  MESSAGE_MISSION_INTROUVABLE,
  plierTexteCopilote,
  QUESTION_MISSION,
  sommer,
  type Devise,
  type ElementCopilote,
  type Montant,
  type ParametresCopilote,
  type ReponseComposee,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import { rechercher } from "../capitalisation/recherche.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";
import { motifContient } from "../http/outils.js";
import { tableauDeBord } from "../kpi/tableau.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { calculerSuiviMission } from "../temps/suivi.js";
import { compterKpiRouges, MESSAGE_KPI_ROUGES_LIMITE } from "./limites.js";

/*
 * OUTILS DE LECTURE DU COPILOTE (AGT-08). Chacun appelle les MÊMES services et requêtes que les
 * routes correspondantes, avec l'`Auth` de l'utilisateur, dans la transaction `withTenant` reçue
 * (RLS) et avec la visibilité de mission (`filtreVisibilite`, `exigerMissionVisible`). Il ne rend
 * que des FAITS (nombres des moteurs, libellés d'entités, dates) que les gabarits du moteur
 * mettent en phrases : aucun chiffre n'est calculé ici, aucun texte n'est généré, et aucun contenu
 * issu d'un client (verbatim, réponse de questionnaire, extrait de document) n'est recopié.
 * Toutes les lectures sont BORNÉES (LIMITE_ELEMENTS_COPILOTE éléments par réponse).
 *
 * Une mission inexistante, d'un autre cabinet ou non visible répond la MÊME phrase
 * (MESSAGE_MISSION_INTROUVABLE) : jamais de fuite d'existence.
 */

export interface ContexteOutil {
  db: Db;
  auth: Auth;
  /** Date du jour `AAAA-MM-JJ` (UTC), fournie par l'appelant. */
  aujourdhui: string;
  /** Mission affichée à l'écran de l'utilisateur, le cas échéant. */
  missionId?: string | undefined;
}

export interface ResultatOutil extends ReponseComposee {
  statut: "ok" | "precision_requise" | "refuse";
}

const ok = (r: ReponseComposee): ResultatOutil => ({ statut: "ok", ...r });
const precision = (texte: string, elements: ElementCopilote[] = []): ResultatOutil => ({
  statut: "precision_requise",
  texte,
  elements,
});

/** Missions plafonnées pour l'analyse des KPI (une évaluation de tableau de bord par mission). */
export const MISSIONS_KPI_MAX = 20;
/** Factures échues lues au plus (le total est alors un minimum, signalé). */
export const FACTURES_ECHUES_MAX = 200;
/** Jalons en retard lus au plus par mission. */
const JALONS_MAX = 50;
const CANDIDATES_MAX = 5;

/* ----- Mes tâches ----- */

export async function mesTaches(c: ContexteOutil): Promise<ResultatOutil> {
  const { db, auth } = c;
  const total = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE echeance < $2::date)::int AS en_retard
     FROM taches_collaboration WHERE assignee_id = $1 AND statut <> 'fait'`,
    [auth.utilisateurId, c.aujourdhui],
  );
  const r = await db.query(
    `SELECT id, titre, echeance::text AS echeance FROM taches_collaboration
     WHERE assignee_id = $1 AND statut <> 'fait'
     ORDER BY (echeance IS NULL), echeance, cree_le, id LIMIT $2`,
    [auth.utilisateurId, LIMITE_ELEMENTS_COPILOTE],
  );
  return ok(
    composerMesTaches({
      total: total.rows[0].total as number,
      en_retard: total.rows[0].en_retard as number,
      taches: r.rows.map((t) => ({
        titre: t.titre as string,
        echeance: (t.echeance as string | null) ?? null,
        en_retard: t.echeance !== null && (t.echeance as string) < c.aujourdhui,
        lien: `/mes-taches/${t.id as string}`,
      })),
    }),
  );
}

/* ----- Mes feuilles de temps à soumettre ----- */

type EtatFeuille = "brouillon" | "rejetee" | "absente";

export async function mesFeuillesTemps(c: ContexteOutil): Promise<ResultatOutil> {
  const { db, auth } = c;
  const aSoumettre = await db.query(
    `SELECT semaine::text AS semaine, statut FROM feuilles_temps
     WHERE auteur_id = $1 AND statut IN ('brouillon', 'rejetee') AND semaine <= $2::date
     ORDER BY semaine DESC LIMIT $3`,
    [auth.utilisateurId, c.aujourdhui, LIMITE_ELEMENTS_COPILOTE],
  );
  const compte = await db.query(
    `SELECT count(*)::int AS n FROM feuilles_temps
     WHERE auteur_id = $1 AND statut IN ('brouillon', 'rejetee') AND semaine <= $2::date`,
    [auth.utilisateurId, c.aujourdhui],
  );
  const feuilles: { semaine: string; etat: EtatFeuille; lien: string }[] = aSoumettre.rows.map(
    (f) => ({
      semaine: f.semaine as string,
      etat: f.statut as EtatFeuille,
      lien: `/temps?semaine=${f.semaine as string}`,
    }),
  );
  let total = compte.rows[0].n as number;
  // Semaine écoulée jamais commencée (le rappel du vendredi la signale aussi).
  const precedente = lundiDeLaSemaine(ajouterJours(c.aujourdhui, -7));
  const absente = await db.query(
    `SELECT 1 FROM collaborateurs c WHERE c.utilisateur_id = $1 AND c.actif
       AND NOT EXISTS (SELECT 1 FROM feuilles_temps f WHERE f.collaborateur_id = c.id
                       AND f.semaine = $2::date)`,
    [auth.utilisateurId, precedente],
  );
  if (absente.rows[0]) {
    total += 1;
    feuilles.push({ semaine: precedente, etat: "absente", lien: `/temps?semaine=${precedente}` });
    feuilles.sort((a, b) => b.semaine.localeCompare(a.semaine));
  }
  return ok(composerMesFeuilles({ total, feuilles }));
}

/* ----- Résolution d'une mission par son nom ----- */

type Resolution =
  | { type: "trouvee"; id: string }
  | { type: "introuvable" }
  | { type: "precision" }
  | { type: "candidates"; missions: { id: string; intitule: string }[] };

/**
 * Missions VISIBLES dont l'intitulé contient ce nom (accents et casse ignorés), ou la mission du
 * contexte de l'écran. Inexistante et non visible se confondent : « introuvable ».
 */
export async function resoudreMission(
  c: ContexteOutil,
  nom: string | undefined,
): Promise<Resolution> {
  const { db, auth } = c;
  if (nom === undefined) {
    if (!c.missionId) return { type: "precision" };
    try {
      return { type: "trouvee", id: (await exigerMissionVisible(db, auth, c.missionId)).id };
    } catch (error) {
      if (error instanceof AppError && error.statut === 404) return { type: "introuvable" };
      throw error;
    }
  }
  const cherche = plierTexteCopilote(nom).trim();
  const r = await db.query(
    `SELECT m.id, m.intitule FROM missions m
     WHERE cap_sans_accents(m.intitule) LIKE $4 AND ${filtreVisibilite(1, 2)}
     ORDER BY (m.statut = 'cloturee'), m.cree_le DESC, m.id LIMIT $3`,
    [voitToutesLesMissions(auth), auth.utilisateurId, CANDIDATES_MAX + 1, motifContient(cherche)],
  );
  const missions = r.rows.map((m) => ({ id: m.id as string, intitule: m.intitule as string }));
  if (missions.length === 0) return { type: "introuvable" };
  const exacte = missions.filter((m) => plierTexteCopilote(m.intitule).trim() === cherche);
  const retenues = exacte.length === 1 ? exacte : missions;
  if (retenues.length === 1) return { type: "trouvee", id: (retenues[0] as { id: string }).id };
  return { type: "candidates", missions: missions.slice(0, CANDIDATES_MAX) };
}

/* ----- Résumé d'une mission ----- */

export async function resumeMission(
  c: ContexteOutil,
  p: ParametresCopilote["resume_mission"],
): Promise<ResultatOutil> {
  const { db, auth } = c;
  const resolution = await resoudreMission(c, p.mission);
  if (resolution.type === "precision") return precision(QUESTION_MISSION);
  if (resolution.type === "introuvable") return precision(MESSAGE_MISSION_INTROUVABLE);
  if (resolution.type === "candidates") {
    return {
      statut: "precision_requise",
      ...composerMissionsCandidates({
        candidates: resolution.missions.map((m) => ({
          intitule: m.intitule,
          lien: `/missions/${m.id}`,
        })),
      }),
    };
  }
  const id = resolution.id;
  const acces = await exigerMissionVisible(db, auth, id);
  const m = await db.query("SELECT intitule FROM missions WHERE id = $1", [id]);
  const jalons = await db.query(
    `SELECT libelle, date_prevue::text AS date_prevue FROM mission_jalons
     WHERE mission_id = $1 AND NOT atteint AND date_prevue < $2::date
     ORDER BY date_prevue, ordre, id LIMIT $3`,
    [id, c.aujourdhui, JALONS_MAX],
  );
  let avancement: number | null | undefined;
  let jours: { budget: number; realise: number; atterrissage: number } | undefined;
  // Les jours exigent `budget.lire_jours` (routes/suivi-temps.ts) : absents sinon.
  if (aPermission(auth.roles, "budget.lire_jours")) {
    const s = await calculerSuiviMission(db, auth.cabinetId, id);
    avancement = s.performance ? (s.performance.avancement as number) : null;
    jours = {
      budget: s.arbre.suivi.budget,
      realise: s.arbre.suivi.realise,
      atterrissage: s.arbre.suivi.atterrissage,
    };
  }
  const kpi = aPermission(auth.roles, "kpi.lire") ? await kpiRougesDe(db, id, c.aujourdhui) : null;
  return ok(
    composerResumeMission({
      intitule: (m.rows[0]?.intitule as string | undefined) ?? "",
      statut: acces.statut,
      lien: `/missions/${id}`,
      lien_kpi: `/missions/${id}/kpi`,
      ...(avancement !== undefined ? { avancement } : {}),
      ...(jours ? { jours } : {}),
      jalons_en_retard: jalons.rows.map((j) => ({
        libelle: j.libelle as string,
        date_prevue: j.date_prevue as string,
      })),
      kpi_rouges: kpi,
    }),
  );
}

/** Libellés des KPI au rouge d'une mission (tableau de bord du moteur) ; null si non évaluable. */
async function kpiRougesDe(db: Db, missionId: string, date: string): Promise<string[] | null> {
  try {
    const t = await tableauDeBord(db, missionId, date);
    return t.kpis.filter((k) => k.statut === "rouge").map((k) => k.libelle);
  } catch (error) {
    // Évaluation trop volumineuse (400) : le résumé reste servi, sans la section KPI.
    if (error instanceof AppError && error.statut === 400) return null;
    throw error;
  }
}

/* ----- KPI au rouge de mes missions ----- */

export async function kpiRouges(c: ContexteOutil): Promise<ResultatOutil> {
  const { db, auth } = c;
  // Outil coûteux (une évaluation par mission) : plafond de débit propre, dit en clair (pas d'erreur).
  if (!(await compterKpiRouges(db, auth))) {
    return { statut: "refuse", texte: MESSAGE_KPI_ROUGES_LIMITE, elements: [] };
  }
  // « Mes » missions : celles dont l'utilisateur est directeur, chef ou membre (jamais « toutes »).
  const r = await db.query(
    `SELECT m.id, m.intitule FROM missions m
     WHERE m.statut IN ('signee', 'en_cours', 'a_cloturer') AND ${filtreVisibilite(1, 2)}
     ORDER BY m.cree_le DESC, m.id LIMIT $3`,
    [false, auth.utilisateurId, MISSIONS_KPI_MAX + 1],
  );
  const missions = r.rows.slice(0, MISSIONS_KPI_MAX);
  const parMission: { intitule: string; lien: string; kpi: string[] }[] = [];
  for (const m of missions) {
    const rouges = await kpiRougesDe(db, m.id as string, c.aujourdhui);
    if (rouges && rouges.length > 0) {
      parMission.push({
        intitule: m.intitule as string,
        lien: `/missions/${m.id as string}/kpi`,
        kpi: rouges,
      });
    }
  }
  return ok(
    composerKpiRouges({
      missions_analysees: missions.length,
      total_kpi: parMission.reduce((n, m) => n + m.kpi.length, 0),
      missions: parMission,
      tronque: r.rows.length > MISSIONS_KPI_MAX,
    }),
  );
}

/* ----- Factures échues ----- */

export async function facturesEchues(c: ContexteOutil): Promise<ResultatOutil> {
  const { db, auth } = c;
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT}, cl.raison_sociale AS client
     FROM factures f JOIN missions m ON m.id = f.mission_id JOIN clients cl ON cl.id = f.client_id
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_echeance < $4::date
       AND ${filtreVisibilite(1, 2)}
     ORDER BY f.date_echeance, f.id LIMIT $3`,
    [voitToutesLesMissions(auth), auth.utilisateurId, FACTURES_ECHUES_MAX + 1, c.aujourdhui],
  );
  const lues = r.rows.slice(0, FACTURES_ECHUES_MAX);
  const factures = lues.map((l) => versFacturePaiement(l));
  const clients = new Map(lues.map((l) => [l.id as string, l.client as string]));
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
    c.aujourdhui,
  );
  const echues = factures
    .map((f) => ({ f, s: situationPaiement(f, imputations.get(f.id) ?? [], c.aujourdhui) }))
    .filter((x) => x.s.statut_paiement === "en_retard")
    .sort((a, b) => b.s.jours_retard - a.s.jours_retard || a.f.id.localeCompare(b.f.id));
  // FIN-02 : sans « finance.lire », aucun montant (champ ABSENT, jamais masqué par un zéro).
  const montants = aPermission(auth.roles, "finance.lire");
  let totaux: string[] | null = null;
  if (montants) {
    const parDevise = new Map<Devise, Montant[]>();
    for (const x of echues) {
      parDevise.set(x.s.solde.devise, [...(parDevise.get(x.s.solde.devise) ?? []), x.s.solde]);
    }
    totaux = [...parDevise.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([devise, liste]) => formaterMontant(sommer(liste, devise)));
  }
  return ok(
    composerFacturesEchues({
      total: echues.length,
      tronque: r.rows.length > FACTURES_ECHUES_MAX,
      factures: echues.slice(0, LIMITE_ELEMENTS_COPILOTE).map(({ f, s }) => ({
        libelle: `Facture ${f.numero ?? "sans numéro"}`,
        client: clients.get(f.id) ?? "",
        echeance: f.date_echeance as string,
        jours_retard: s.jours_retard,
        solde: montants ? formaterMontant(s.solde) : null,
        lien: `/facturation/${f.id}`,
      })),
      totaux,
    }),
  );
}

/* ----- Recherche unifiée (CAP-07) ----- */

const lienResultat = (r: { type: string; id: string; mission_id: string }): string => {
  if (r.type === "connaissance") return `/connaissances/retours/${r.id}`;
  if (r.type === "rapport") return `/missions/${r.mission_id}/rapports`;
  return `/missions/${r.mission_id}`;
};

export async function rechercheUnifiee(
  c: ContexteOutil,
  p: ParametresCopilote["recherche"],
): Promise<ResultatOutil> {
  const requete: RechercheQuery = { q: p.texte, limite: LIMITE_ELEMENTS_COPILOTE };
  const res = await rechercher(c.db, c.auth, requete);
  const types = Object.values(res.par_type);
  return ok(
    composerRecherche({
      texte: p.texte,
      total: res.elements.length,
      tronque: types.some((t) => t?.tronque === true),
      resultats: res.elements.map((e) => ({
        type: e.type,
        // AGT-07 : l'extrait et l'intitulé d'une preuve (source précise, verbatim) ne sont jamais
        // recopiés ; seuls les libellés d'entités du cabinet le sont.
        titre: e.type === "preuve" ? "Preuve du registre" : e.titre,
        mission_intitule: e.mission_intitule,
        lien: lienResultat(e),
      })),
    }),
  );
}

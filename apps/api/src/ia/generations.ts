import { aPermission, type StatutContenu } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionVisible,
  filtreVisibilite,
  peutModifierMission,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { ErreurLlm, type CodeErreurLlm } from "./fournisseur.js";
import { suspectsRestants } from "./garde-chiffres.js";
import { chargerPrompt, validerSortie } from "./prompts.js";

/*
 * Générations : lecture, modification humaine, validation, annulation
 * (SOC-06). Une « génération » exposée par l'API est une DEMANDE
 * (ia_demandes) et ses versions de contenu (ia_generations, ajout seul).
 *
 * VISIBILITÉ : une génération liée à une mission suit la règle de
 * visibilité des missions (missions/acces.ts) ; sans mission, elle est
 * visible de son demandeur et des détenteurs de « ia.configurer ». Une
 * génération invisible ou d'un autre cabinet répond 404.
 *
 * CIRCUIT HUMAIN : « modifier » ajoute une version « modifie » ; « valider »
 * ajoute une version « valide » au même texte et FIGE le contenu.
 * Séparation des tâches : le valideur n'est ni le demandeur ni l'auteur
 * d'AUCUNE version de la demande, sauf associé (comme les factures,
 * facturation/factures.ts) ; un contenu lié à une mission est validé par son
 * chef, son directeur ou un associé. Des chiffres non vérifiés exigent
 * `acquitte_chiffres: true`.
 *
 * `statut_contenu` figure dans TOUTES les réponses ; seul « valide » rend un
 * contenu livrable au client (`livrable_client`), et JAMAIS un essai fait
 * avec un prompt « exemple » (`prompt.exemple`). Coût, modèle et jetons
 * n'apparaissent dans la trace qu'avec « finance.lire » (données de
 * gestion), ABSENTS sinon.
 */

const MESSAGES_ECHEC: Record<string, string> = {
  PLAFOND_IA_ATTEINT: "Plafond mensuel de coût IA atteint.",
  GENERATIONS_SIMULTANEES: "Trop de générations IA en cours pour le cabinet.",
  ENTREE_ILLISIBLE: "Entrée de la génération illisible (clé de chiffrement changée ?).",
  ERREUR_INTERNE: "Erreur interne pendant la génération.",
};

function messageEchec(code: string): string {
  return (
    MESSAGES_ECHEC[code] ||
    new ErreurLlm(code as CodeErreurLlm, false).message ||
    "Échec de la génération."
  );
}

const CLE_TRI = "lpad(((extract(epoch FROM d.cree_le) * 1000000)::bigint)::text, 17, '0')";

const COLONNES = `d.id, d.tache, d.prompt_id, d.prompt_nom, d.prompt_version, pr.exemple AS prompt_exemple,
  d.mission_id,
  d.entite_type, d.entite_id, d.demandeur_id, u.nom AS demandeur_nom, d.statut, d.progression,
  d.erreur_code, d.cree_le, d.termine_le, d.entree_empreinte, d.entree_champs,
  j.statut AS job_statut, j.tentatives AS job_tentatives,
  g.version AS g_version, g.statut_contenu AS g_statut_contenu, g.texte AS g_texte,
  g.donnees AS g_donnees, g.chiffres_non_verifies AS g_chiffres_non_verifies,
  g.nombres_non_verifies AS g_nombres_non_verifies, g.chiffres_acquittes AS g_chiffres_acquittes,
  g.auteur_id AS g_auteur_id, g.cree_le AS g_cree_le,
  p.fournisseur AS p_fournisseur, p.modele AS p_modele, p.duree_ms AS p_duree_ms,
  p.tokens_entree AS p_tokens_entree, p.tokens_sortie AS p_tokens_sortie,
  p.cout_micro_usd::text AS p_cout, p.gabarit AS p_gabarit, p.sources AS p_sources`;

const DEPUIS = `ia_demandes d JOIN utilisateurs u ON u.id = d.demandeur_id
  JOIN ia_prompts pr ON pr.id = d.prompt_id
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN LATERAL (SELECT * FROM ia_generations x WHERE x.demande_id = d.id
    ORDER BY x.version DESC LIMIT 1) g ON true
  LEFT JOIN ia_generations p ON p.demande_id = d.id AND p.version = 1`;

/** Fragment de visibilité (paramètres : voit_sans_mission, voit_toutes, utilisateur). */
function visibilite(pSansMission: number, pToutes: number, pUtilisateur: number): string {
  return `((d.mission_id IS NULL AND ($${pSansMission}::boolean OR d.demandeur_id = $${pUtilisateur}))
    OR (d.mission_id IS NOT NULL AND EXISTS (SELECT 1 FROM missions m WHERE m.id = d.mission_id
        AND ${filtreVisibilite(pToutes, pUtilisateur)})))`;
}

const parametresVisibilite = (auth: Auth) => [
  aPermission(auth.roles, "ia.configurer"),
  voitToutesLesMissions(auth),
  auth.utilisateurId,
];

export interface DemandeDb extends Record<string, unknown> {
  id: string;
  mission_id: string | null;
  demandeur_id: string;
  statut: string;
  prompt_id: string;
  g_version: number | null;
  g_statut_contenu: StatutContenu | null;
  g_texte: string | null;
  g_donnees: Record<string, unknown> | null;
  g_chiffres_non_verifies: boolean | null;
  g_nombres_non_verifies: string[] | null;
  g_auteur_id: string | null;
  p_sources: unknown[] | null;
  p_gabarit: boolean | null;
}

/** Génération visible de l'utilisateur, ou 404. `verrouiller` sérialise les écritures. */
export async function lireDemandeVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<DemandeDb> {
  if (verrouiller) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`ia_demande:${id}`]);
  }
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE d.id = $1 AND ${visibilite(2, 3, 4)}`,
    [id, ...parametresVisibilite(auth)],
  );
  if (!r.rows[0]) throw introuvable("Génération");
  return r.rows[0] as DemandeDb;
}

/** Statut d'exécution exposé : un job pris par le worker rend la demande « en cours ». */
function statutExpose(d: Record<string, unknown>): { statut: string; progression: number } {
  if (d.statut === "en_file" && d.job_statut === "en_cours") {
    return { statut: "en_cours", progression: 50 };
  }
  // Job abandonné par le worker (erreur inattendue répétée) : la demande est en échec.
  if (d.statut === "en_file" && d.job_statut === "echec") {
    return { statut: "echec", progression: 100 };
  }
  return { statut: d.statut as string, progression: d.progression as number };
}

export function vueGeneration(
  d: Record<string, unknown>,
  auth: Auth,
  options: { texte: boolean },
): Record<string, unknown> {
  const { statut, progression } = statutExpose(d);
  const statutContenu = (d.g_statut_contenu as StatutContenu | null) ?? null;
  const essai = d.prompt_exemple === true;
  const trace =
    d.p_fournisseur === null || d.p_fournisseur === undefined
      ? null
      : {
          fournisseur: d.p_fournisseur,
          duree_ms: d.p_duree_ms,
          // Modèle, jetons et coût : données de gestion, ABSENTES sans « finance.lire ».
          ...(aPermission(auth.roles, "finance.lire")
            ? {
                modele: d.p_modele,
                tokens_entree: d.p_tokens_entree,
                tokens_sortie: d.p_tokens_sortie,
                cout_micro_usd: Number(d.p_cout ?? 0),
              }
            : {}),
        };
  return {
    id: d.id,
    tache: d.tache,
    prompt: { id: d.prompt_id, nom: d.prompt_nom, version: d.prompt_version, exemple: essai },
    mission_id: d.mission_id,
    entite: d.entite_type ? { type: d.entite_type, id: d.entite_id } : null,
    demandeur: { id: d.demandeur_id, nom: d.demandeur_nom },
    statut,
    progression,
    erreur: d.erreur_code
      ? { code: d.erreur_code, message: messageEchec(d.erreur_code as string) }
      : statut === "echec"
        ? { code: "ERREUR_INTERNE", message: messageEchec("ERREUR_INTERNE") }
        : null,
    statut_contenu: statutContenu,
    // Seul un contenu validé par un humain peut atteindre le client (PRD, SOC-06), jamais un essai.
    livrable_client: statutContenu === "valide" && !essai,
    version: d.g_version ?? null,
    ...(options.texte ? { texte: d.g_texte ?? null, donnees: d.g_donnees ?? null } : {}),
    gabarit: d.p_gabarit ?? null,
    chiffres_non_verifies: d.g_chiffres_non_verifies ?? null,
    nombres_non_verifies: d.g_nombres_non_verifies ?? [],
    chiffres_acquittes: d.g_chiffres_acquittes ?? null,
    sources: d.p_sources ?? [],
    trace,
    entree: { empreinte: d.entree_empreinte, champs: d.entree_champs },
    cree_le: d.cree_le,
    termine_le: d.termine_le,
  };
}

/** Historique des versions d'une génération (ajout seul). */
export async function versionsDe(db: Db, demandeId: string): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT g.version, g.statut_contenu, g.fournisseur, g.auteur_id, u.nom AS auteur_nom,
       g.chiffres_non_verifies, g.nombres_non_verifies, g.chiffres_acquittes, g.texte, g.cree_le
     FROM ia_generations g JOIN utilisateurs u ON u.id = g.auteur_id
     WHERE g.demande_id = $1 ORDER BY g.version`,
    [demandeId],
  );
  return r.rows;
}

export async function lireVue(db: Db, auth: Auth, id: string): Promise<Record<string, unknown>> {
  const d = await lireDemandeVisible(db, auth, id);
  return { ...vueGeneration(d, auth, { texte: true }), versions: await versionsDe(db, id) };
}

export interface FiltresGenerations {
  mission_id?: string | undefined;
  statut?: string | undefined;
  statut_contenu?: string | undefined;
  tache?: string | undefined;
  limite: number;
  curseur?: string | undefined;
}

/** Liste paginée par curseur (plus récentes d'abord), sans le texte. */
export async function listerGenerations(db: Db, auth: Auth, q: FiltresGenerations) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS}
     WHERE ${visibilite(1, 2, 3)}
       AND ($4::uuid IS NULL OR d.mission_id = $4)
       AND ($5::text IS NULL OR d.statut = $5)
       AND ($6::text IS NULL OR g.statut_contenu = $6)
       AND ($7::text IS NULL OR d.tache = $7)
       AND ($8::text IS NULL OR (${CLE_TRI}, d.id) < ($8, $9::uuid))
     ORDER BY cle_tri DESC, d.id DESC LIMIT $10`,
    [
      ...parametresVisibilite(auth),
      q.mission_id ?? null,
      q.statut ?? null,
      q.statut_contenu ?? null,
      q.tache ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return {
    elements: page.elements.map((d) => vueGeneration(d, auth, { texte: false })),
    curseur_suivant: page.curseur_suivant,
  };
}

/* ----- Circuit humain ----- */

async function exigerContenuOuvert(db: Db, auth: Auth, d: DemandeDb) {
  if (d.statut !== "terminee" || d.g_version === null) {
    throw conflit("La génération n'a pas produit de contenu.");
  }
  if (d.g_statut_contenu === "valide") {
    throw new AppError(409, "CONTENU_VALIDE", "Contenu validé : définitif.");
  }
  if (d.mission_id) {
    const mission = await exigerMissionVisible(db, auth, d.mission_id);
    if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
    return mission;
  }
  return null;
}

async function versionPrecedente(db: Db, demandeId: string) {
  const r = await db.query(
    `SELECT version, texte, donnees, sources, gabarit, chiffres_non_verifies, nombres_non_verifies,
       auteur_id
     FROM ia_generations WHERE demande_id = $1 ORDER BY version DESC LIMIT 1`,
    [demandeId],
  );
  return r.rows[0] as {
    version: number;
    texte: string;
    donnees: Record<string, unknown> | null;
    sources: unknown[];
    gabarit: boolean;
    chiffres_non_verifies: boolean;
    nombres_non_verifies: string[];
    auteur_id: string;
  };
}

/** Modification humaine : nouvelle version « modifie » (l'historique est conservé). */
export async function modifierGeneration(db: Db, auth: Auth, id: string, texte: string) {
  const d = await lireDemandeVisible(db, auth, id, true);
  await exigerContenuOuvert(db, auth, d);
  const prec = await versionPrecedente(db, id);
  const prompt = await chargerPrompt(db, d.prompt_id);
  const validee = validerSortie(prompt.schema_sortie, texte);
  if (!validee) {
    throw requeteInvalide(
      prompt.schema_sortie.type === "objet"
        ? "Le contenu doit rester un objet JSON conforme au schéma du prompt."
        : "Contenu trop long pour ce prompt.",
    );
  }
  // Seuls les nombres venus du modèle (signalés) restent à acquitter s'ils demeurent.
  const restants = suspectsRestants(validee.texte, prec.nombres_non_verifies);
  await db.query(
    `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur, texte,
       donnees, sources, gabarit, chiffres_non_verifies, nombres_non_verifies, auteur_id)
     VALUES ($1, $2, $3, 'modifie', 'humain', $4, $5, $6, $7, $8, $9, $10)`,
    [
      auth.cabinetId,
      id,
      prec.version + 1,
      validee.texte,
      validee.donnees === null ? null : JSON.stringify(validee.donnees),
      JSON.stringify(prec.sources),
      prec.gabarit,
      restants.length > 0,
      JSON.stringify(restants),
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification_contenu_ia",
    entite: "ia_demande",
    entiteId: id,
    details: { version: prec.version + 1, chiffres_non_verifies: restants.length > 0 },
  });
}

/** Validation humaine : version « valide » au même contenu, qui fige la génération. */
export async function validerGeneration(db: Db, auth: Auth, id: string, acquitteChiffres: boolean) {
  const d = await lireDemandeVisible(db, auth, id, true);
  const mission = await exigerContenuOuvert(db, auth, d);
  if (mission && !peutModifierMission(auth, mission)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "Un contenu lié à une mission est validé par son chef, son directeur ou un associé.",
    );
  }
  const prec = await versionPrecedente(db, id);
  if (!estAssocie(auth)) {
    // Ni le demandeur ni l'auteur d'AUCUNE version (A/B/A : B ne valide pas non plus).
    const auteurs = await db.query(
      "SELECT DISTINCT auteur_id FROM ia_generations WHERE demande_id = $1",
      [id],
    );
    const intervenants = new Set([
      d.demandeur_id,
      ...auteurs.rows.map((x) => x.auteur_id as string),
    ]);
    if (intervenants.has(auth.utilisateurId)) {
      throw new AppError(
        403,
        "APPROBATION_REQUISE",
        "Le demandeur ou l'auteur d'une version d'un contenu ne le valide pas lui-même.",
      );
    }
  }
  if (prec.chiffres_non_verifies && !acquitteChiffres) {
    throw new AppError(
      409,
      "CHIFFRES_NON_VERIFIES",
      "Des nombres du contenu ne viennent pas des moteurs de calcul : vérifiez-les puis acquittez-les explicitement.",
    );
  }
  await db.query(
    `INSERT INTO ia_generations (cabinet_id, demande_id, version, statut_contenu, fournisseur, texte,
       donnees, sources, gabarit, chiffres_non_verifies, nombres_non_verifies, chiffres_acquittes,
       auteur_id)
     VALUES ($1, $2, $3, 'valide', 'humain', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      auth.cabinetId,
      id,
      prec.version + 1,
      prec.texte,
      prec.donnees === null ? null : JSON.stringify(prec.donnees),
      JSON.stringify(prec.sources),
      prec.gabarit,
      prec.chiffres_non_verifies,
      JSON.stringify(prec.nombres_non_verifies),
      prec.chiffres_non_verifies && acquitteChiffres,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation_contenu_ia",
    entite: "ia_demande",
    entiteId: id,
    details: {
      version: prec.version + 1,
      acquitte_chiffres: prec.chiffres_non_verifies && acquitteChiffres,
    },
  });
}

/** Annulation d'une génération en file ou en cours (demandeur ou ia.configurer). */
export async function annulerGeneration(db: Db, auth: Auth, id: string) {
  const d = await lireDemandeVisible(db, auth, id, true);
  if (d.demandeur_id !== auth.utilisateurId && !aPermission(auth.roles, "ia.configurer")) {
    throw new AppError(403, "INTERDIT", "Seul le demandeur annule une génération.");
  }
  const r = await db.query(
    `UPDATE ia_demandes SET statut = 'annulee', termine_le = now(), erreur_code = NULL
     WHERE id = $1 AND statut IN ('en_file', 'en_cours') RETURNING job_id`,
    [id],
  );
  if (!r.rows[0]) throw conflit("Génération déjà terminée : rien à annuler.");
  const jobId = r.rows[0].job_id as string | null;
  if (jobId) {
    // L'entrée chiffrée est effacée (job en attente, en cours ou abandonné en échec par le
    // worker) ; un job pas encore pris ne s'exécutera pas.
    await db.query(
      `UPDATE jobs SET charge = '{}'::jsonb,
         statut = CASE WHEN statut = 'en_attente' THEN 'termine' ELSE statut END
       WHERE id = $1 AND statut IN ('en_attente', 'en_cours', 'echec')`,
      [jobId],
    );
  }
  // Un appel en vol garde sa réservation : sa clôture la solde et inscrit son coût (« annulee »).
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "annulation_generation_ia",
    entite: "ia_demande",
    entiteId: id,
    details: { statut_precedent: d.statut },
  });
}

import {
  aPermission,
  casEssaiSchema,
  type CasEssai,
  type JeuEssaiCreation,
} from "@missionpilot/shared";
import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  executerCasEvaluation,
  fournisseurLocalPourCas,
  type ResultatCas,
} from "../ia/evaluation.js";
import type { LlmProvider } from "../ia/fournisseur.js";
import { modeleAutorise } from "../ia/modeles.js";
import { lireParametres, modeleDe } from "../ia/parametres.js";
import {
  assurerPromptsExemple,
  chargerPrompt,
  chargerPromptActif,
  type PromptDb,
} from "../ia/prompts.js";
import { lireBrique } from "./autonomie.js";
import { avecErreursAgents, jeuEssaiAbsent, jeuEssaiAffaibli } from "./erreurs.js";

/*
 * Jeux d'essai et évaluations de non-régression (AGT-04, migration 0264).
 *
 * Une évaluation rejoue le DERNIER jeu d'essai d'un nom de prompt sur une
 * version CANDIDATE et un modèle candidat, et, pour comparaison, sur la version
 * ACTIVE : un cas réussi par la version active et échoué par la candidate est
 * une RÉGRESSION. « Réussie » = tous les cas réussis. La base refuse ensuite
 * d'activer une version, ou de choisir un modèle, sans évaluation réussie
 * (MPG04, déclencheurs de 0264).
 *
 * Exécution sur le fournisseur LOCAL déterministe (ia/evaluation.ts, écho des
 * messages rendus) : aucun appel à un modèle externe ni coût dans cette
 * version ; un rejeu sur un vrai modèle passera par la file `jobs`, plafonné
 * (ADR-005), non fait. Le fournisseur EFFECTIVEMENT utilisé est enregistré
 * (`openrouter` seulement si tous les cas l'ont été) ; en production, la base
 * n'admet que `openrouter` pour activer (0265).
 *
 * Jeu d'essai (ajout seul) : une nouvelle version garde TOUS les codes de cas
 * de la précédente et chaque cas porte au moins un critère non vide
 * (« contient », « ne contient pas » ou « champs ») ; sinon, réservé à
 * `autonomie.decider` (409 JEU_ESSAI_AFFAIBLI), journalisé. Les variables et
 * chiffres des cas (contenu possiblement client) ne sont lus que par l'auteur
 * du jeu ou `agent.gerer`.
 */

/** Fabrique du fournisseur d'un cas (injectable en test). */
export type FabriqueFournisseurEvaluation = (prompt: PromptDb, cas: CasEssai) => LlmProvider;

const casStockesSchema = z.array(casEssaiSchema);

/** Le cas porte-t-il au moins un critère non vide ? */
const aUnCritere = (c: CasEssai) =>
  c.attendu.contient.length > 0 ||
  c.attendu.ne_contient_pas.length > 0 ||
  Object.keys(c.attendu.champs).length > 0;

/** Ce qui affaiblit une nouvelle version : codes retirés, cas sans critère. */
export function affaiblissementsJeu(
  precedents: readonly CasEssai[] | null,
  cas: readonly CasEssai[],
): string[] {
  const codes = new Set(cas.map((c) => c.code));
  return [
    ...(precedents ?? []).filter((c) => !codes.has(c.code)).map((c) => `retire:${c.code}`),
    ...cas.filter((c) => !aUnCritere(c)).map((c) => `sans_critere:${c.code}`),
  ];
}

/** Nouvelle version du jeu d'essai d'un prompt (ajout seul). */
export async function creerJeuEssai(
  db: Db,
  auth: Auth,
  j: JeuEssaiCreation,
): Promise<Record<string, unknown>> {
  const brique = j.brique_code ? await lireBrique(db, j.brique_code) : null;
  await assurerPromptsExemple(db, auth.cabinetId);
  const existe = await db.query("SELECT 1 FROM ia_prompts WHERE nom = $1 LIMIT 1", [j.prompt_nom]);
  if (!existe.rows[0]) throw introuvable("Prompt");
  let affaiblissement: string[] = [];
  const r = await avecErreursAgents(async () => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `jeu_essai:${auth.cabinetId}:${j.prompt_nom}`,
    ]);
    const max = await db.query(
      "SELECT coalesce(max(version), 0) AS v FROM agents_jeux_essai WHERE prompt_nom = $1",
      [j.prompt_nom],
    );
    const prec = await db.query(
      "SELECT cas FROM agents_jeux_essai WHERE prompt_nom = $1 ORDER BY version DESC LIMIT 1",
      [j.prompt_nom],
    );
    affaiblissement = affaiblissementsJeu(
      prec.rows[0] ? casStockesSchema.parse(prec.rows[0].cas) : null,
      j.cas,
    );
    if (affaiblissement.length > 0 && !aPermission(auth.roles, "autonomie.decider")) {
      throw jeuEssaiAffaibli(affaiblissement);
    }
    return db.query(
      `INSERT INTO agents_jeux_essai (cabinet_id, prompt_nom, version, brique_id, description, cas, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        auth.cabinetId,
        j.prompt_nom,
        (max.rows[0].v as number) + 1,
        brique?.id ?? null,
        j.description,
        JSON.stringify(j.cas),
        auth.utilisateurId,
      ],
    );
  });
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation_jeu_essai_ia",
    entite: "agent_jeu_essai",
    entiteId: id,
    details: {
      prompt: j.prompt_nom,
      cas: j.cas.length,
      // Affaiblissement décidé par un associé (codes seulement, jamais le contenu des cas).
      ...(affaiblissement.length > 0 ? { affaiblissement } : {}),
    },
  });
  return lireJeu(db, auth, id);
}

const COLONNES_JEU = `j.id, j.prompt_nom, j.version, b.brique_code, j.description, j.cas,
  j.auteur_id, u.nom AS auteur_nom, j.cree_le`;
const DEPUIS_JEU = `agents_jeux_essai j JOIN utilisateurs u ON u.id = j.auteur_id
  LEFT JOIN agents_briques b ON b.id = j.brique_id`;

/**
 * Vue d'un jeu : variables et chiffres des cas (possiblement un contenu client) réservés à
 * l'auteur du jeu et à `agent.gerer` ; les autres lecteurs voient codes et critères.
 */
function vueJeu(l: Record<string, unknown>, auth: Auth): Record<string, unknown> {
  if (aPermission(auth.roles, "agent.gerer") || l.auteur_id === auth.utilisateurId) return l;
  const cas = Array.isArray(l.cas) ? (l.cas as Record<string, unknown>[]) : [];
  return {
    ...l,
    cas: cas.map((c) => ({ code: c.code, attendu: c.attendu })),
    donnees_cas_masquees: true,
  };
}

export async function lireJeu(db: Db, auth: Auth, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES_JEU} FROM ${DEPUIS_JEU} WHERE j.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Jeu d'essai");
  return vueJeu(r.rows[0], auth);
}

const CLE_TRI_JEU = "lpad(((extract(epoch FROM j.cree_le) * 1000000)::bigint)::text, 17, '0')";

export async function listerJeux(
  db: Db,
  auth: Auth,
  q: { limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_JEU}, ${CLE_TRI_JEU} AS cle_tri FROM ${DEPUIS_JEU}
     WHERE ($1::text IS NULL OR (${CLE_TRI_JEU}, j.id) < ($1, $2::uuid))
     ORDER BY cle_tri DESC, j.id DESC LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { ...page, elements: page.elements.map((l) => vueJeu(l, auth)) };
}

interface Rejeu {
  resultats: ResultatCas[];
  /** Noms des fournisseurs effectivement utilisés. */
  fournisseurs: Set<string>;
}

async function rejouer(
  prompt: PromptDb,
  cas: readonly CasEssai[],
  modele: string,
  fabrique: FabriqueFournisseurEvaluation,
): Promise<Rejeu> {
  const resultats: ResultatCas[] = [];
  const fournisseurs = new Set<string>();
  for (const c of cas) {
    const fournisseur = fabrique(prompt, c);
    fournisseurs.add(fournisseur.nom);
    resultats.push(
      await executerCasEvaluation({ prompt, cas: c, modele, fournisseur, cleApi: "local" }),
    );
  }
  return { resultats, fournisseurs };
}

/**
 * Évalue une version de prompt (et un modèle) sur le dernier jeu d'essai de son nom, compare
 * à la version active et enregistre le résultat (ajout seul).
 */
export async function evaluerPrompt(
  db: Db,
  auth: Auth,
  e: { prompt_id: string; modele?: string | undefined },
  fabrique: FabriqueFournisseurEvaluation = fournisseurLocalPourCas,
): Promise<Record<string, unknown>> {
  await assurerPromptsExemple(db, auth.cabinetId);
  const candidat = await chargerPrompt(db, e.prompt_id);
  const jeu = await db.query(
    "SELECT id, cas FROM agents_jeux_essai WHERE prompt_nom = $1 ORDER BY version DESC LIMIT 1",
    [candidat.nom],
  );
  if (!jeu.rows[0]) throw jeuEssaiAbsent();
  const modele = e.modele ?? modeleDe(await lireParametres(db), candidat.tache);
  if (!modeleAutorise(modele)) {
    throw requeteInvalide("Modèle non autorisé : choisissez un modèle au tarif connu.");
  }
  const cas = casStockesSchema.parse(jeu.rows[0].cas);
  const actif = await chargerPromptActif(db, candidat.nom);
  const reference = actif.id === candidat.id ? null : actif;
  const candidatRejeu = await rejouer(candidat, cas, modele, fabrique);
  const resultats = candidatRejeu.resultats;
  const resultatsRef = reference
    ? (await rejouer(reference, cas, modele, fabrique)).resultats
    : null;
  // « openrouter » seulement si TOUS les cas de la candidate y ont été rejoués ; sinon « local ».
  const fournisseur =
    candidatRejeu.fournisseurs.size === 1 && candidatRejeu.fournisseurs.has("openrouter")
      ? "openrouter"
      : "local";
  const details = resultats.map((r, i) => ({
    code: r.code,
    reussi: r.reussi,
    raisons: r.raisons,
    reference_reussi: resultatsRef ? (resultatsRef[i]?.reussi ?? null) : null,
  }));
  const regressions = details.filter((d) => d.reference_reussi === true && !d.reussi).length;
  const reussis = details.filter((d) => d.reussi).length;
  const r = await avecErreursAgents(() =>
    db.query(
      `INSERT INTO agents_evaluations (cabinet_id, jeu_id, prompt_id, prompt_reference_id, modele,
         fournisseur, cas_total, cas_reussis, regressions, reussie, resultats, lance_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        auth.cabinetId,
        jeu.rows[0].id,
        candidat.id,
        reference?.id ?? null,
        modele,
        fournisseur,
        details.length,
        reussis,
        regressions,
        reussis === details.length,
        JSON.stringify(details),
        auth.utilisateurId,
      ],
    ),
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "evaluation_non_regression_ia",
    entite: "agent_evaluation",
    entiteId: id,
    details: {
      prompt: candidat.nom,
      version: candidat.version,
      modele,
      fournisseur,
      reussie: reussis === details.length,
      regressions,
    },
  });
  return lireEvaluation(db, id);
}

const COLONNES_EVAL = `e.id, e.jeu_id, j.prompt_nom, j.version AS jeu_version, e.prompt_id,
  p.version AS prompt_version, e.prompt_reference_id, pr.version AS prompt_reference_version, e.modele,
  e.fournisseur, e.cas_total, e.cas_reussis, e.regressions, e.reussie, e.resultats, e.lance_par,
  u.nom AS lance_par_nom, e.cree_le`;
const DEPUIS_EVAL = `agents_evaluations e JOIN agents_jeux_essai j ON j.id = e.jeu_id
  JOIN ia_prompts p ON p.id = e.prompt_id
  LEFT JOIN ia_prompts pr ON pr.id = e.prompt_reference_id
  JOIN utilisateurs u ON u.id = e.lance_par`;

export async function lireEvaluation(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES_EVAL} FROM ${DEPUIS_EVAL} WHERE e.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Évaluation");
  return r.rows[0];
}

const CLE_TRI_EVAL = "lpad(((extract(epoch FROM e.cree_le) * 1000000)::bigint)::text, 17, '0')";

export async function listerEvaluations(
  db: Db,
  q: { prompt_nom?: string | undefined; limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_EVAL}, ${CLE_TRI_EVAL} AS cle_tri FROM ${DEPUIS_EVAL}
     WHERE ($1::text IS NULL OR j.prompt_nom = $1)
       AND ($2::text IS NULL OR (${CLE_TRI_EVAL}, e.id) < ($2, $3::uuid))
     ORDER BY cle_tri DESC, e.id DESC LIMIT $4`,
    [q.prompt_nom ?? null, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  return paginer(r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[], q.limite);
}

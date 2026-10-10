import {
  AUTOMATISATIONS_STANDARD,
  definitionAutomatisationSchema,
  type AutomatisationCreation,
  type AutomatisationModification,
  type DefinitionAutomatisationApi,
} from "@missionpilot/shared";
import { lireBrique } from "../agents/autonomie.js";
import { lireAgent } from "../agents/registre.js";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { coupeCircuitsActifs, lireCoupeCircuitAutomatisation } from "./coupe-circuits.js";
import { validerDefinition, type ErreurDefinition } from "./definitions.js";
import {
  automatisationStandardExiste,
  automatisationStandardInconnue,
  avecErreursAutomatisation,
  definitionInvalide,
  etatInchange,
  plafondAutomatisationsAtteint,
} from "./erreurs.js";

/*
 * Automatisations du cabinet (AUT-02, AUT-03) : création (libre ou depuis la bibliothèque
 * standard), modification par NOUVELLE VERSION immuable de la définition, activation et
 * désactivation. Permissions (routes) : `automatisation.lire` pour lire,
 * `automatisation.gerer` pour écrire. Une automatisation naît INACTIVE : on la simule sur les
 * événements passés (AUT-04) avant de l'activer. Le responsable (« compte d'automatisation »)
 * est la personne qui l'active ; ses droits ACTUELS sont relus à chaque exécution.
 */

/**
 * Nombre maximal d'automatisations ACTIVES par cabinet (à valider : valeur de départ, non
 * tranchée par le PRD ; borne le travail du worker par événement publié).
 */
export const MAX_AUTOMATISATIONS_ACTIVES = 50;

const CLE_TRI = `lpad(((extract(epoch FROM a.cree_le) * 1000000)::bigint)::text, 17, '0')`;

const COLONNES = `a.id, a.nom, a.description, a.standard_code, a.evenement_code, a.version_courante,
  a.active, a.active_depuis, a.responsable_id, ur.nom AS responsable_nom, a.cree_par, a.cree_le,
  a.modifie_le, v.definition`;
const DEPUIS = `automatisations a
  JOIN utilisateurs ur ON ur.id = a.responsable_id
  JOIN automatisation_versions v ON v.automatisation_id = a.id AND v.version = a.version_courante`;

export interface AutomatisationDb extends Record<string, unknown> {
  id: string;
  nom: string;
  evenement_code: string;
  version_courante: number;
  active: boolean;
  definition: DefinitionAutomatisationApi;
}

/** Agents et briques cités : connus du registre, brique confiée à cet agent. */
async function erreursAgents(db: Db, d: DefinitionAutomatisationApi): Promise<ErreurDefinition[]> {
  const erreurs: ErreurDefinition[] = [];
  for (const [i, a] of d.actions.entries()) {
    if (a.type !== "appeler_agent") continue;
    try {
      await lireAgent(db, a.agent_code);
      if (a.brique_code && (await lireBrique(db, a.brique_code)).agent_code !== a.agent_code) {
        erreurs.push({
          chemin: `actions.${i}.brique_code`,
          code: "BRIQUE_AUTRE_AGENT",
          message: "Cette brique est confiée à un autre agent.",
        });
      }
    } catch (error) {
      if (!(error instanceof AppError && error.statut === 404)) throw error;
      erreurs.push({
        chemin: `actions.${i}.agent_code`,
        code: "AGENT_INCONNU",
        message: "Agent ou brique inconnus du registre.",
      });
    }
  }
  return erreurs;
}

export async function exigerDefinitionValide(
  db: Db,
  d: DefinitionAutomatisationApi,
): Promise<void> {
  const erreurs = [...validerDefinition(d), ...(await erreursAgents(db, d))];
  if (erreurs.length > 0) throw definitionInvalide(erreurs);
}

export async function lireAutomatisation(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<AutomatisationDb> {
  if (verrouiller) await db.query("SELECT 1 FROM automatisations WHERE id = $1 FOR UPDATE", [id]);
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE a.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Automatisation");
  return r.rows[0] as AutomatisationDb;
}

/** Détail : en-tête, définition courante, versions, coupe-circuit. */
export async function detailAutomatisation(db: Db, id: string) {
  const a = await lireAutomatisation(db, id);
  const v = await db.query(
    `SELECT v.version, v.definition, v.cree_le, u.nom AS cree_par_nom
     FROM automatisation_versions v JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.automatisation_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return {
    ...a,
    coupe_circuit: await lireCoupeCircuitAutomatisation(db, id),
    versions: v.rows,
  };
}

export async function listerAutomatisations(
  db: Db,
  q: { limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS}
     WHERE ($1::text IS NULL OR (${CLE_TRI}, a.id) < ($1, $2::uuid))
     ORDER BY cle_tri DESC, a.id DESC LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (AutomatisationDb & { cle_tri: string })[], q.limite);
  const coupees = await coupeCircuitsActifs(db);
  return {
    ...page,
    elements: page.elements.map((a) => ({ ...a, coupee: coupees.has(a.id as string) })),
    coupe_circuit_cabinet: await lireCoupeCircuitAutomatisation(db, null),
  };
}

async function inscrireVersion(
  db: Db,
  auth: Auth,
  automatisationId: string,
  version: number,
  definition: DefinitionAutomatisationApi,
): Promise<void> {
  await db.query(
    `INSERT INTO automatisation_versions (cabinet_id, automatisation_id, version, definition,
       cree_par) VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, automatisationId, version, JSON.stringify(definition), auth.utilisateurId],
  );
}

export async function creerAutomatisation(
  db: Db,
  auth: Auth,
  c: AutomatisationCreation,
  standardCode: string | null = null,
): Promise<string> {
  await exigerDefinitionValide(db, c.definition);
  const r = await db.query(
    `INSERT INTO automatisations (cabinet_id, nom, description, standard_code, evenement_code,
       responsable_id, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [
      auth.cabinetId,
      c.nom,
      c.description,
      standardCode,
      c.definition.evenement_code,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await inscrireVersion(db, auth, id, 1, c.definition);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "automatisation",
    entiteId: id,
    details: { evenement: c.definition.evenement_code, standard: standardCode },
  });
  return id;
}

/** Ajoute une automatisation de la bibliothèque standard (inactive, à simuler puis activer). */
export async function ajouterStandard(db: Db, auth: Auth, code: string): Promise<string> {
  const s = AUTOMATISATIONS_STANDARD.find((x) => x.code === code);
  if (!s) throw automatisationStandardInconnue();
  const existe = await db.query("SELECT 1 FROM automatisations WHERE standard_code = $1", [code]);
  if (existe.rows[0]) throw automatisationStandardExiste();
  try {
    return await creerAutomatisation(
      db,
      auth,
      {
        nom: s.nom,
        description: s.description,
        definition: definitionAutomatisationSchema.parse(s.definition),
      },
      code,
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw automatisationStandardExiste();
    throw error;
  }
}

/**
 * Modifie le nom, la description et/ou la définition (nouvelle version immuable).
 *
 * SÉPARATION DES TÂCHES : une automatisation s'exécute avec l'identité et les droits de son
 * responsable (celui qui l'a ACTIVÉE). Changer la définition d'une automatisation active ferait
 * donc exécuter le texte d'un autre sous l'identité du responsable (un directeur de mission
 * sans « facture.emettre » pourrait faire créer des brouillons de facture sous celle d'un
 * associé). Une nouvelle définition DÉSACTIVE donc l'automatisation, dans la même transaction ;
 * la réactivation (`/activer`) rend son auteur responsable. Nom et description seuls ne
 * changent rien à l'exécution : l'automatisation reste active.
 */
export async function modifierAutomatisation(
  db: Db,
  auth: Auth,
  id: string,
  m: AutomatisationModification,
): Promise<void> {
  const a = await lireAutomatisation(db, id, true);
  let version = a.version_courante;
  const desactiver = m.definition !== undefined && a.active;
  if (m.definition) {
    await exigerDefinitionValide(db, m.definition);
    version += 1;
    await inscrireVersion(db, auth, id, version, m.definition);
  }
  await avecErreursAutomatisation(() =>
    db.query(
      `UPDATE automatisations SET nom = coalesce($2, nom), description = coalesce($3, description),
         evenement_code = $4, version_courante = $5, modifie_le = now(),
         active = active AND NOT $6, active_depuis = CASE WHEN $6 THEN NULL ELSE active_depuis END
       WHERE id = $1`,
      [
        id,
        m.nom ?? null,
        m.description ?? null,
        m.definition?.evenement_code ?? a.evenement_code,
        version,
        desactiver,
      ],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "automatisation",
    entiteId: id,
    details: { champs: Object.keys(m), version },
  });
  if (desactiver) {
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "desactivation",
      entite: "automatisation",
      entiteId: id,
      details: { version, cause: "modification de la définition" },
    });
  }
}

/** Active (le responsable devient la personne qui active) ou désactive. */
export async function changerActivation(
  db: Db,
  auth: Auth,
  id: string,
  active: boolean,
): Promise<void> {
  const a = await lireAutomatisation(db, id, true);
  if (a.active === active) {
    throw etatInchange(
      active ? "L'automatisation est déjà active." : "L'automatisation est déjà inactive.",
    );
  }
  if (active) {
    // Verrou propre au cabinet : deux activations simultanées ne dépassent pas le plafond.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `automatisations_actives:${auth.cabinetId}`,
    ]);
    const n = await db.query("SELECT count(*)::int AS n FROM automatisations WHERE active");
    if ((n.rows[0].n as number) >= MAX_AUTOMATISATIONS_ACTIVES) {
      throw plafondAutomatisationsAtteint(MAX_AUTOMATISATIONS_ACTIVES);
    }
  }
  await db.query(
    `UPDATE automatisations SET active = $2, active_depuis = CASE WHEN $2 THEN now() END,
       responsable_id = CASE WHEN $2 THEN $3 ELSE responsable_id END, modifie_le = now()
     WHERE id = $1`,
    [id, active, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: active ? "activation" : "desactivation",
    entite: "automatisation",
    entiteId: id,
    details: { version: a.version_courante },
  });
}

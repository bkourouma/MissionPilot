import type { CommentaireExplicationCorps } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { lireDemandeVisible, lireVue } from "../ia/generations.js";
import { genererContenu, type DependancesIa, type ResultatExecution } from "../ia/orchestrateur.js";
import { explicationVersion, versionOu404 } from "./explication.js";
import {
  assurerPromptExplication,
  chiffresExplication,
  lectureExplication,
  NOM_PROMPT_EXPLICATION,
  TYPE_ENTITE_EXPLICATION,
  VARIABLES_NON_FIABLES_EXPLICATION,
} from "./explication-prompt.js";
import { exigerNotationVisible, type Notation } from "./notations.js";

/*
 * Commentaire IA de l'explication d'une version de notation (NOT-12). Une génération par
 * l'ORCHESTRATEUR (masquage du client, quota, plafond avec repli sur gabarit, garde-chiffres,
 * trace), rattachée à la version par `ia_demandes.entite_type/entite_id` (aucune table de liaison)
 * et à la mission (visibilité, validation par le chef, le directeur ou un associé). Le contenu est
 * un BROUILLON (`brouillon_ia`) ; la modification et la validation humaines passent par
 * `/ia/generations/:id/{modifier,valider}`. Rien n'est servi au portail ni repris dans un rapport
 * client : seul `statut_contenu = valide` (et `livrable_client`) le permettrait, et aucune route
 * du portail ne le lit.
 */

async function nomClient(db: Db, notation: Notation): Promise<string | null> {
  const r = await db.query("SELECT raison_sociale FROM clients WHERE id = $1", [
    notation.client_id,
  ]);
  return (r.rows[0]?.raison_sociale as string | undefined) ?? null;
}

async function intituleMission(db: Db, missionId: string): Promise<string | null> {
  const r = await db.query("SELECT intitule FROM missions WHERE id = $1", [missionId]);
  return (r.rows[0]?.intitule as string | undefined) ?? null;
}

/** Dernière demande de commentaire de la version, vue comme `/ia/generations/:id` (FIN-02 incluse). */
async function vueDernierCommentaire(db: Db, auth: Auth, versionId: string) {
  const r = await db.query(
    `SELECT id FROM ia_demandes WHERE entite_type = $1 AND entite_id = $2 AND prompt_nom = $3
     ORDER BY cree_le DESC, id DESC LIMIT 1`,
    [TYPE_ENTITE_EXPLICATION, versionId, NOM_PROMPT_EXPLICATION],
  );
  const id = r.rows[0]?.id as string | undefined;
  return id === undefined ? null : lireVue(db, auth, id);
}

function reponse(numero: number, commentaire: Record<string, unknown> | null) {
  return {
    numero,
    statut_contenu: (commentaire?.statut_contenu as string | null | undefined) ?? null,
    commentaire,
  };
}

/** Dernier commentaire de la version (la dernière si `numero` est absent), sinon `commentaire: null`. */
export async function lireCommentaireExplication(
  db: Db,
  auth: Auth,
  notation: Notation,
  numero?: number,
) {
  const v = await versionOu404(db, notation, numero);
  return reponse(v.version.numero, await vueDernierCommentaire(db, auth, v.version.id));
}

/** Génère un brouillon de commentaire (IA, sinon gabarit déterministe) de l'explication. */
export async function genererCommentaireExplication(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  notationId: string,
  corps: CommentaireExplicationCorps,
): Promise<{ resultat: ResultatExecution; vue: ReturnType<typeof reponse> }> {
  const prep = await database.withTenant(auth.cabinetId, async (db) => {
    const notation = await exigerNotationVisible(db, auth, notationId);
    const v = await versionOu404(db, notation, corps.version);
    // Mêmes entrées que l'explication servie : un calcul non notable répond 409 (moteur).
    const explication = explicationVersion(v, corps.cible);
    await assurerPromptExplication(db, auth.cabinetId);
    return {
      notation,
      numero: v.version.numero,
      versionId: v.version.id,
      explication,
      client: await nomClient(db, notation),
      intitule: await intituleMission(db, notation.mission_id),
    };
  });
  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "redaction",
    promptNom: NOM_PROMPT_EXPLICATION,
    variables: { texte: lectureExplication(prep.explication) },
    variablesNonFiables: [...VARIABLES_NON_FIABLES_EXPLICATION],
    contexteChiffres: chiffresExplication(prep.explication),
    termesSensibles: [
      ...(prep.client
        ? [{ valeur: prep.client.slice(0, 200), categorie: "organisation" as const }]
        : []),
      ...(prep.intitule
        ? [{ valeur: prep.intitule.slice(0, 200), categorie: "autre" as const }]
        : []),
    ],
    entite: {
      type: TYPE_ENTITE_EXPLICATION,
      id: prep.versionId,
      missionId: prep.notation.mission_id,
    },
    utilisateur: auth,
    repliSiPlafond: true,
  });
  const commentaire = await database.withTenant(auth.cabinetId, async (db) => {
    const demande = await lireDemandeVisible(db, auth, demandeId);
    if (demande.statut !== "terminee" || demande.g_version === null) {
      throw new AppError(
        502,
        "GENERATION_IA_ECHEC",
        "La génération du commentaire a échoué : réessayez plus tard.",
      );
    }
    return lireVue(db, auth, demandeId);
  });
  return { resultat, vue: reponse(prep.numero, commentaire) };
}

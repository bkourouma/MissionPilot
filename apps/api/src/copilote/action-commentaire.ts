import { aPermission, commentaireCreationSchema } from "@missionpilot/shared";
import {
  COMMENTAIRE_COPILOTE_LONGUEUR_MAX,
  LIBELLE_ACTION_AJOUTER_COMMENTAIRE,
  MESSAGE_MISSION_INTROUVABLE,
  QUESTION_MISSION,
  resumerAjouterCommentaire,
  type ParametresCopilote,
} from "@missionpilot/engines";
import { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import { creerCommentaire } from "../collaboration/commentaires.js";
import type { Db } from "../db/pool.js";
import type { DefinitionAction, ExecutionAction, PreparationAction } from "./actions.js";
import { resoudreMission, type ContexteOutil } from "./lecture.js";

/*
 * ACTION « ajouter_commentaire » du copilote (AGT-08) : commenter une MISSION visible. Même
 * modèle de sécurité que `creer_tache` (copilote/actions.ts) : proposition résolue par le code
 * (nom de mission → identifiant, visibilité vérifiée), confirmation à usage unique, droits
 * revérifiés, puis exécution par le SERVICE COMMUN des commentaires (collaboration/commentaires.ts,
 * celui de `POST /api/commentaires` : permission `commentaire.ecrire`, entité visible, journal sans
 * le texte), journal `via: "copilote"`. Le texte est du CONTENU : il vit dans les paramètres de la
 * proposition (anonymisés à 30 jours) et dans le commentaire, jamais dans le journal d'audit.
 * Pas de mention : le copilote ne désigne aucune personne, donc aucune notification n'est émise.
 * Seules les missions sont commentables par le copilote (pas les factures, tâches ou débours).
 */

const parametresSchema = z
  .object({ texte: z.string().min(1).max(5000), mission_id: z.string().uuid() })
  .strict();

const precision = (texte: string): PreparationAction => ({ type: "precision", texte });

function corpsCommentaire(missionId: string, texte: string) {
  return { entite_type: "mission", entite_id: missionId, texte, mentions: [] };
}

async function intituleMission(db: Db, id: string): Promise<string> {
  const r = await db.query("SELECT intitule FROM missions WHERE id = $1", [id]);
  return (r.rows[0]?.intitule as string | undefined) ?? "";
}

async function preparerAjouterCommentaire(
  c: ContexteOutil,
  p: ParametresCopilote["ajouter_commentaire"],
): Promise<PreparationAction> {
  const texte = p.texte.trim();
  if (texte.length > COMMENTAIRE_COPILOTE_LONGUEUR_MAX) {
    return precision(
      `Ce commentaire fait ${texte.length} caractères : le copilote en accepte ${COMMENTAIRE_COPILOTE_LONGUEUR_MAX} au plus, pour que vous puissiez relire le texte entier avant de confirmer. Raccourcissez-le, ou utilisez l'écran de la mission.`,
    );
  }
  if (p.mission && !aPermission(c.auth.roles, "mission.lire")) {
    return precision("Vous ne pouvez pas désigner une mission par son nom.");
  }
  const r = await resoudreMission(c, p.mission);
  if (r.type === "precision") return precision(QUESTION_MISSION);
  if (r.type === "introuvable") return precision(MESSAGE_MISSION_INTROUVABLE);
  if (r.type === "candidates") {
    return precision(
      `Plusieurs missions correspondent à « ${p.mission ?? ""} » : précisez laquelle (${r.missions.map((m) => m.intitule).join(", ")}).`,
    );
  }
  if (!commentaireCreationSchema.safeParse(corpsCommentaire(r.id, texte)).success) {
    return precision("Je n'ai pas pu préparer ce commentaire : vérifiez son texte.");
  }
  return {
    type: "prete",
    parametres: { texte, mission_id: r.id },
    resume: resumerAjouterCommentaire({
      texte,
      mission_intitule: await intituleMission(c.db, r.id),
    }),
  };
}

async function ajouterCommentaire(
  db: Db,
  auth: Auth,
  parametres: unknown,
): Promise<ExecutionAction> {
  const p = parametresSchema.parse(parametres);
  const corps = commentaireCreationSchema.parse(corpsCommentaire(p.mission_id, p.texte));
  const { id, lien, notifications } = await creerCommentaire(db, auth, corps, "copilote");
  const intitule = await intituleMission(db, p.mission_id);
  return {
    resultatId: id,
    texte: `Le commentaire a été ajouté à la mission « ${intitule} ».`,
    elements: [{ libelle: "Commentaire ajouté", detail: `Mission « ${intitule} »`, lien }],
    notifications,
  };
}

export const ACTION_AJOUTER_COMMENTAIRE: DefinitionAction<"ajouter_commentaire"> = {
  libelle: LIBELLE_ACTION_AJOUTER_COMMENTAIRE,
  permission: (auth) => aPermission(auth.roles, "commentaire.ecrire"),
  preparer: preparerAjouterCommentaire,
  executer: ajouterCommentaire,
};

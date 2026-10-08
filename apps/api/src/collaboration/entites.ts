import { aPermission, type Role, type TypeEntiteCollaboration } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { deboursVisible } from "../facturation/debours.js";
import { missionVisibleOuNull } from "../facturation/outils.js";

/*
 * VISIBILITÉ DES ENTITÉS COMMENTABLES (SOC-08), contrôlée à CHAQUE lecture et
 * écriture d'un commentaire ou d'une tâche liée. Une entité invisible répond
 * 404, comme une entité d'un autre cabinet (RLS) : on ne révèle pas son
 * existence.
 * - mission, tâche de mission : mission visible (filtreVisibilite) — l'expert
 *   externe n'y accède donc que pour les missions dont il est membre ;
 * - facture : « facture.lire » et mission visible (même règle que GET /factures/:id) ;
 * - débours : son auteur, ou qui voit les débours de la mission (deboursVisible) ;
 * - opportunité, proposition : « pipeline.gerer ».
 * Un commentaire est du texte libre de son auteur : l'API ne le filtre pas,
 * mais il n'est lu que par qui voit l'entité (aucun coût ni marge n'est
 * ajouté par l'API).
 */

export interface EntiteResolue {
  type: TypeEntiteCollaboration;
  id: string;
  /** Colonnes de clé étrangère à recopier (commentaires, taches_collaboration). */
  colonnes: {
    mission_id: string | null;
    tache_id: string | null;
    facture_id: string | null;
    debours_id: string | null;
    opportunite_id: string | null;
    proposition_id: string | null;
  };
  /** Lien relatif interne vers l'écran de l'entité (notifications). */
  lien: string;
}

const introuvableEntite = () => introuvable("Élément");

function colonnes(partiel: Partial<EntiteResolue["colonnes"]>): EntiteResolue["colonnes"] {
  return {
    mission_id: null,
    tache_id: null,
    facture_id: null,
    debours_id: null,
    opportunite_id: null,
    proposition_id: null,
    ...partiel,
  };
}

async function missionDe(db: Db, table: "mission_taches" | "factures", id: string) {
  const r = await db.query(`SELECT mission_id FROM ${table} WHERE id = $1`, [id]);
  return (r.rows[0]?.mission_id as string | undefined) ?? null;
}

/** Entité visible par `auth`, ou 404. */
export async function exigerEntiteVisible(
  db: Db,
  auth: Auth,
  type: TypeEntiteCollaboration,
  id: string,
): Promise<EntiteResolue> {
  switch (type) {
    case "mission": {
      if (!(await missionVisibleOuNull(db, auth, id))) throw introuvableEntite();
      return { type, id, colonnes: colonnes({ mission_id: id }), lien: `/missions/${id}` };
    }
    case "mission_tache": {
      const missionId = await missionDe(db, "mission_taches", id);
      if (!missionId || !(await missionVisibleOuNull(db, auth, missionId))) {
        throw introuvableEntite();
      }
      return {
        type,
        id,
        colonnes: colonnes({ mission_id: missionId, tache_id: id }),
        lien: `/missions/${missionId}/decoupage`,
      };
    }
    case "facture": {
      if (!aPermission(auth.roles, "facture.lire")) throw introuvableEntite();
      const missionId = await missionDe(db, "factures", id);
      if (!missionId || !(await missionVisibleOuNull(db, auth, missionId))) {
        throw introuvableEntite();
      }
      return {
        type,
        id,
        colonnes: colonnes({ mission_id: missionId, facture_id: id }),
        lien: `/facturation/${id}`,
      };
    }
    case "debours": {
      let missionId: string;
      try {
        missionId = (await deboursVisible(db, auth, id)).debours.mission_id as string;
      } catch (error) {
        if (error instanceof AppError && error.statut === 404) throw introuvableEntite();
        throw error;
      }
      return {
        type,
        id,
        colonnes: colonnes({ mission_id: missionId, debours_id: id }),
        lien: `/missions/${missionId}/debours`,
      };
    }
    case "opportunite":
    case "proposition": {
      if (!aPermission(auth.roles, "pipeline.gerer")) throw introuvableEntite();
      const table = type === "opportunite" ? "opportunites" : "propositions";
      const r = await db.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
      if (!r.rows[0]) throw introuvableEntite();
      return type === "opportunite"
        ? { type, id, colonnes: colonnes({ opportunite_id: id }), lien: `/pipeline/${id}` }
        : {
            type,
            id,
            colonnes: colonnes({ proposition_id: id }),
            lien: `/pipeline/propositions/${id}`,
          };
    }
  }
}

/** Vrai si `auth` voit l'entité (même règle, sans lever). */
export async function voitEntite(
  db: Db,
  auth: Auth,
  type: TypeEntiteCollaboration,
  id: string,
): Promise<boolean> {
  try {
    await exigerEntiteVisible(db, auth, type, id);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) return false;
    throw error;
  }
}

/**
 * Contexte d'un AUTRE utilisateur actif du cabinet courant (RLS), pour
 * vérifier qu'il voit une entité (mention, assignation) ; null s'il est
 * inconnu, inactif ou d'un autre cabinet.
 */
export async function authDe(db: Db, cabinetId: string, utilisateurId: string) {
  const r = await db.query(
    "SELECT id, email, nom, roles FROM utilisateurs WHERE id = $1 AND cabinet_id = $2 AND actif",
    [utilisateurId, cabinetId],
  );
  const u = r.rows[0] as { id: string; email: string; nom: string; roles: Role[] } | undefined;
  if (!u) return null;
  return { utilisateurId: u.id, cabinetId, email: u.email, nom: u.nom, roles: u.roles } as Auth;
}

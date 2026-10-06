import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  aPermission,
  documentDepotSchema,
  documentStatutSchema,
  TYPES_DOCUMENT,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { paramsId } from "../http/outils.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import {
  estAssocie,
  exigerMissionVisible,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import { exigerFichierRattachable } from "../stockage/fichiers.js";

const COLONNES = `d.id, d.mission_id, d.type, d.nom, d.version, d.auteur_id, u.nom AS auteur_nom,
  d.chemin_stockage, d.cree_le, d.fichier_id,
  CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id', f.id, 'nom', f.nom_origine,
    'type_mime', f.type_mime, 'taille', f.taille, 'sha256', f.sha256, 'cree_le', f.cree_le) END AS fichier,
  d.statut_contenu, d.contenu_modifie_par, d.valide_par, d.valide_le,
  (SELECT max(x.version) FROM mission_documents x
   WHERE x.mission_id = d.mission_id AND x.type = d.type AND x.nom = d.nom) AS version_courante`;
const DEPUIS = `mission_documents d LEFT JOIN utilisateurs u ON u.id = d.auteur_id
  LEFT JOIN fichiers f ON f.id = d.fichier_id`;

const listeQuery = z
  .object({
    type: z.enum(TYPES_DOCUMENT).optional(),
    /** Toutes les versions (par défaut : la dernière de chaque document). */
    historique: z.enum(["true", "false"]).optional(),
  })
  .strict();

/** Document au format de l'API : taille du fichier en nombre, version courante signalée. */
function vueDocument(d: Record<string, unknown>): Record<string, unknown> {
  const f = d.fichier as Record<string, unknown> | null;
  return {
    ...d,
    fichier: f ? { ...f, taille: Number(f.taille) } : null,
    est_version_courante: d.version === d.version_courante,
  };
}

async function lireDocument(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE d.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Document");
  return r.rows[0];
}

/** Document d'une mission visible (« mission.lire »), sinon 404. */
async function documentVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ document: Record<string, unknown>; mission: MissionAcces }> {
  const document = await lireDocument(db, id);
  let mission: MissionAcces;
  try {
    mission = await exigerMissionVisible(db, auth, document.mission_id as string, verrouiller);
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) throw introuvable("Document");
    throw error;
  }
  return { document, mission };
}

/** Types réservés : proposition et lettre de mission engagent le cabinet. */
function exigerDroitsType(auth: Auth, mission: MissionAcces, type: string): void {
  if (type === "proposition" || type === "lettre_de_mission") {
    if (!peutModifierMission(auth, mission)) throw interdit();
    if (type === "lettre_de_mission" && !aPermission(auth.roles, "mission.signer")) {
      throw interdit();
    }
  }
}

/**
 * Documents de mission (SOC-05) et statut des contenus (SOC-06).
 * Lecture : mission visible ; écriture : « document.ecrire » et mission
 * visible et non clôturée (un membre de l'équipe dépose ses livrables) ;
 * proposition et lettre de mission : responsables de la mission (et
 * « mission.signer » pour la lettre).
 *
 * Une version désigne soit un fichier TÉLÉVERSÉ (`fichier_id`, rattaché à
 * une seule version, téléchargé par GET /fichiers/:id), soit l'ancien chemin
 * relatif contrôlé par le schéma (compatibilité ascendante). Même type et
 * même nom → version suivante ; un fichier identique (empreinte SHA-256) à la
 * version courante est refusé.
 *
 * Statut du contenu (livrables générés par l'IA, V2 ; aucun appel IA ici) :
 * brouillon_ia → modifie → valide, sur la seule version courante ; le
 * valideur est un responsable de la mission, ni l'auteur ni le dernier
 * modificateur, sauf associé (contrôlé aussi par déclencheur, 0071).
 */
export const routesDocuments: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/documents", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = listeQuery.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const r = await db.query(
        `SELECT ${COLONNES} FROM ${DEPUIS}
         WHERE d.mission_id = $1 AND ($2::text IS NULL OR d.type = $2)
           AND ($3::boolean OR d.version = (SELECT max(x.version) FROM mission_documents x
                 WHERE x.mission_id = d.mission_id AND x.type = d.type AND x.nom = d.nom))
         ORDER BY d.type, lower(d.nom), d.version DESC`,
        [id, q.type ?? null, q.historique === "true"],
      );
      return { elements: r.rows.map(vueDocument) };
    });
  });

  /** Dépose un document ; même type et même nom → version suivante. */
  app.post("/missions/:id/documents", async (request, reply) => {
    const auth = exiger(request, "document.ecrire");
    const { id } = paramsId.parse(request.params);
    const doc = documentDepotSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      // Verrou sur la mission : deux dépôts simultanés reçoivent deux versions distinctes.
      const mission = await exigerMissionVisible(db, auth, id, true);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      exigerDroitsType(auth, mission, doc.type);
      if (doc.fichier_id) {
        const fichier = await exigerFichierRattachable(db, auth, doc.fichier_id);
        const courante = await db.query(
          `SELECT f.sha256 FROM mission_documents d JOIN fichiers f ON f.id = d.fichier_id
           WHERE d.mission_id = $1 AND d.type = $2 AND d.nom = $3
           ORDER BY d.version DESC LIMIT 1`,
          [id, doc.type, doc.nom],
        );
        if (courante.rows[0]?.sha256 === fichier.sha256) {
          throw new AppError(
            409,
            "CONTENU_IDENTIQUE",
            "Ce fichier est identique à la version courante du document.",
          );
        }
      }
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id,
             chemin_stockage, fichier_id, statut_contenu)
           SELECT $1, $2, $3, $4, coalesce(max(version), 0) + 1, $5, $6, $7, $8
           FROM mission_documents WHERE mission_id = $2 AND type = $3 AND nom = $4
           RETURNING id`,
          [
            auth.cabinetId,
            id,
            doc.type,
            doc.nom,
            auth.utilisateurId,
            doc.chemin_stockage ?? null,
            doc.fichier_id ?? null,
            doc.statut_contenu ?? null,
          ],
        ),
        {
          mission_documents_fichier_uniq: "Ce fichier est déjà rattaché.",
          "*": "Une autre version vient d'être déposée : réessayer.",
        },
      );
      const lu = await lireDocument(db, r.rows[0].id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "depot_document",
        entite: "mission_document",
        entiteId: r.rows[0].id,
        details: {
          mission_id: id,
          type: doc.type,
          nom: doc.nom,
          version: lu.version,
          fichier_id: doc.fichier_id ?? null,
          statut_contenu: doc.statut_contenu ?? null,
        },
      });
      return vueDocument(lu);
    });
    reply.status(201);
    return cree;
  });

  /** Un document, toutes ses versions et l'historique du statut de son contenu. */
  app.get("/documents/:id", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { document } = await documentVisible(db, auth, id);
      const versions = await db.query(
        `SELECT ${COLONNES} FROM ${DEPUIS}
         WHERE d.mission_id = $1 AND d.type = $2 AND d.nom = $3 ORDER BY d.version DESC`,
        [document.mission_id, document.type, document.nom],
      );
      const statuts = await db.query(
        `SELECT s.statut, s.par, u.nom AS par_nom, s.cree_le FROM mission_document_statuts s
         LEFT JOIN utilisateurs u ON u.id = s.par
         WHERE s.document_id = $1 ORDER BY s.cree_le, s.id`,
        [id],
      );
      return {
        ...vueDocument(document),
        versions: versions.rows.map(vueDocument),
        historique_statut: statuts.rows,
      };
    });
  });

  /**
   * Fait avancer le statut du contenu de la version courante : « modifie »
   * (relu et corrigé) ou « valide » (définitif). Séparation des tâches : le
   * valideur n'est ni l'auteur ni le dernier modificateur, sauf associé.
   */
  app.post("/documents/:id/statut", async (request) => {
    const auth = exiger(request, "document.ecrire");
    const { id } = paramsId.parse(request.params);
    const { statut } = documentStatutSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { document, mission } = await documentVisible(db, auth, id, true);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      exigerDroitsType(auth, mission, document.type as string);
      if (document.statut_contenu === null) {
        throw conflit("Ce document n'est pas un contenu généré à valider.");
      }
      if (document.statut_contenu === "valide") throw conflit("Contenu déjà validé : définitif.");
      if (document.version !== document.version_courante) {
        throw conflit("Seule la version courante d'un document change de statut.");
      }
      if (statut === "valide") {
        if (!peutModifierMission(auth, mission)) {
          throw new AppError(
            403,
            "APPROBATION_REQUISE",
            "Un contenu est validé par le chef ou le directeur de la mission, ou un associé.",
          );
        }
        const auteur =
          document.auteur_id === auth.utilisateurId ||
          document.contenu_modifie_par === auth.utilisateurId;
        if (auteur && !estAssocie(auth)) {
          throw new AppError(
            403,
            "APPROBATION_REQUISE",
            "L'auteur ou le dernier modificateur d'un contenu ne le valide pas lui-même.",
          );
        }
      }
      try {
        await db.query(
          statut === "valide"
            ? `UPDATE mission_documents SET statut_contenu = 'valide', valide_par = $2,
                 valide_le = now() WHERE id = $1`
            : `UPDATE mission_documents SET statut_contenu = 'modifie', contenu_modifie_par = $2
               WHERE id = $1`,
          [id, auth.utilisateurId],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "MPD01") {
          throw new AppError(409, "STATUT_CONTENU", (error as Error).message);
        }
        throw error;
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: statut === "valide" ? "validation_contenu" : "modification_contenu",
        entite: "mission_document",
        entiteId: id,
        details: { mission_id: document.mission_id, version: document.version },
      });
      return vueDocument(await lireDocument(db, id));
    });
  });
};

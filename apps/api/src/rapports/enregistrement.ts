import type { FastifyInstance } from "fastify";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { enregistrerFichier, vueFichier } from "../stockage/fichiers.js";
import type { Rapport } from "./modele.js";
import { peutLireNiveau, type NiveauRapport } from "./niveaux.js";
import { TYPES_RAPPORT, type FormatRapport } from "./rendu.js";

/*
 * Enregistrement d'un rapport rendu dans le stockage existant
 * (stockage/fichiers.ts : type détecté par le contenu, quota du cabinet,
 * audit du téléversement), puis rattachement DANS LA MÊME TRANSACTION, sous
 * le verrou de stockage du cabinet :
 * - débit : au plus RAPPORTS_PAR_FENETRE générations par utilisateur sur
 *   FENETRE_RAPPORTS_MINUTES (429 TROP_DE_RAPPORTS), compté sous ce verrou
 *   (deux générations simultanées ne le dépassent pas) ;
 * - visibilité de la mission revérifiée sous verrou, mission non clôturée ;
 * - ligne `rapports_mission` (ajout seul) portant le NIVEAU calculé
 *   (rapports/niveaux.ts) ; le rapport n'est PAS un document de mission :
 *   sa lecture (GET /fichiers/:id) revérifie mission visible, « mission.lire »
 *   et les permissions du niveau à chaque appel ;
 * - journal d'audit.
 * Si la transaction échoue, l'objet écrit dans le stockage est effacé.
 *
 * Conservation : non traitée (ajout seul, aucune purge ; voir la migration 0130).
 */

export const MODELES_RAPPORT = ["etat_avancement"] as const;
export type ModeleRapport = (typeof MODELES_RAPPORT)[number];

/** Générations admises par utilisateur sur la fenêtre glissante. */
export const RAPPORTS_PAR_FENETRE = 10;
export const FENETRE_RAPPORTS_MINUTES = 10;

const NOMS_FICHIER: Record<ModeleRapport, string> = {
  etat_avancement: "Etat d'avancement",
};

export const COLONNES_RAPPORT = `r.id, r.mission_id, r.modele, r.format, r.statut, r.niveau,
  r.genere_par, r.genere_le`;

export interface RapportEnregistre {
  rapport: Record<string, unknown>;
  fichier: Record<string, unknown>;
}

/**
 * 429 si l'utilisateur a déjà généré RAPPORTS_PAR_FENETRE rapports sur la
 * fenêtre. Contrôle préalable (avant le rendu) puis définitif (sous le
 * verrou de stockage, à l'enregistrement).
 */
export async function verifierDebitRapports(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM rapports_mission
     WHERE genere_par = $1 AND genere_le > now() - make_interval(mins => $2)`,
    [auth.utilisateurId, FENETRE_RAPPORTS_MINUTES],
  );
  if ((r.rows[0].n as number) >= RAPPORTS_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_RAPPORTS",
      `Au plus ${RAPPORTS_PAR_FENETRE} rapports par ${FENETRE_RAPPORTS_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

export async function enregistrerRapport(
  app: FastifyInstance,
  auth: Auth,
  p: {
    missionId: string;
    modele: ModeleRapport;
    format: FormatRapport;
    rapport: Rapport;
    niveau: NiveauRapport;
    contenu: Buffer;
  },
): Promise<RapportEnregistre> {
  // Cohérence : on n'enregistre jamais un rapport que son auteur ne pourrait pas relire.
  if (!peutLireNiveau(auth.roles, p.niveau)) throw interdit();
  const { extension } = TYPES_RAPPORT[p.format];
  let rapport: Record<string, unknown> | null = null;
  const fichier = await enregistrerFichier(
    app,
    auth,
    { nom: `${NOMS_FICHIER[p.modele]} ${p.rapport.genere_le}.${extension}`, contenu: p.contenu },
    {
      details: { rapport: p.modele, mission_id: p.missionId, format: p.format, niveau: p.niveau },
      rattacher: async (db, f) => {
        await verifierDebitRapports(db, auth);
        const mission = await exigerMissionVisible(db, auth, p.missionId, true);
        if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
        const r = await db.query(
          `INSERT INTO rapports_mission AS r (cabinet_id, mission_id, fichier_id, modele, format,
             statut, niveau, genere_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${COLONNES_RAPPORT}`,
          [
            auth.cabinetId,
            p.missionId,
            f.id,
            p.modele,
            p.format,
            p.rapport.statut,
            p.niveau,
            auth.utilisateurId,
          ],
        );
        rapport = r.rows[0] as Record<string, unknown>;
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "generation_rapport",
          entite: "mission",
          entiteId: p.missionId,
          details: {
            rapport_id: rapport.id,
            modele: p.modele,
            format: p.format,
            niveau: p.niveau,
            fichier_id: f.id,
          },
        });
      },
    },
  );
  // Le rapport est neuf : l'indication de doublon du téléversement est sans objet.
  return { rapport: rapport as unknown as Record<string, unknown>, fichier: vueFichier(fichier) };
}

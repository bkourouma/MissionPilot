import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { exiger } from "../auth/contexte.js";
import { conflit } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import {
  COLONNES_RAPPORT,
  enregistrerRapport,
  verifierDebitRapports,
} from "../rapports/enregistrement.js";
import { rapportEtatAvancement } from "../rapports/etat-avancement.js";
import { niveauxLisibles, peutLireNiveau } from "../rapports/niveaux.js";
import { cheminNavigateur } from "../rapports/pdf.js";
import { FORMATS_RAPPORT, rendreRapport } from "../rapports/rendu.js";
import { vueFichier } from "../stockage/fichiers.js";

/** Format de sortie demandé (`?format=pdf|docx|pptx`). */
const rapportQuerySchema = z.object({ format: z.enum(FORMATS_RAPPORT) }).strict();

/** Liste paginée par curseur (même forme que les autres listes de l'API). */
const rapportsListeQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(30),
    curseur: z.string().max(500).optional(),
  })
  .strict();

/** Plus récent d'abord ; clé de tri : instant de génération (microsecondes, UTC). */
const CLE_TRI = `to_char(r.genere_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/*
 * Rapports de mission (SOC-07). Un rapport n'est PAS un document de mission
 * (rapports/enregistrement.ts) ; son fichier se télécharge par
 * GET /fichiers/:id, qui revérifie ses droits à chaque appel.
 *
 * POST /missions/:id/rapports?format=pdf|docx|pptx — rapport « état
 * d'avancement » : « mission.lire » et mission visible (404 sinon, y compris
 * un autre cabinet), mission non clôturée (409), au plus 10 générations par
 * utilisateur sur 10 minutes (429 TROP_DE_RAPPORTS, contrôlé avant le rendu
 * puis sous verrou à l'enregistrement). Les sections en jours exigent
 * « budget.lire_jours », la section financière « finance.lire » (absentes
 * sinon ; voir rapports/etat-avancement.ts) ; le niveau du rapport en découle
 * (rapports/niveaux.ts). Le rendu se fait hors transaction (PDF : au plus un
 * rendu simultané par cabinet, deux en tout). Réponse 201 : métadonnées du
 * rapport et du fichier.
 *
 * GET /missions/:id/rapports?limite=&curseur= — « mission.lire » et mission
 * visible (404 sinon) ; seuls les rapports dont l'appelant détient les
 * permissions du niveau, plus récent d'abord, fichiers retirés exclus ; jamais
 * la clé de stockage.
 */
export const routesRapports: FastifyPluginAsync = async (app) => {
  app.post("/missions/:id/rapports", async (request, reply) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const { format } = rapportQuerySchema.parse(request.query);
    // Le générateur n'inclut que ce qu'il pourrait relire (niveaux cumulatifs).
    const droits = {
      jours: peutLireNiveau(auth.roles, "jours"),
      finance: peutLireNiveau(auth.roles, "finance"),
    };
    const date = aujourdhui();
    const { rapport: brut, niveau } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      await verifierDebitRapports(db, auth);
      return rapportEtatAvancement(db, auth, id, droits, date);
    });
    const { rapport, contenu } = await rendreRapport(brut, format, {
      cheminNavigateur: format === "pdf" ? cheminNavigateur(app.config) : null,
      cabinetId: auth.cabinetId,
      plafondOctets: app.config.FICHIER_TAILLE_MAX_OCTETS,
    });
    const resultat = await enregistrerRapport(app, auth, {
      missionId: id,
      modele: "etat_avancement",
      format,
      rapport,
      niveau,
      contenu,
    });
    reply.status(201);
    return resultat;
  });

  app.get("/missions/:id/rapports", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = rapportsListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const r = await db.query(
        `SELECT ${COLONNES_RAPPORT}, f.id AS fichier_id, f.nom_origine AS nom, f.type_mime,
           f.taille, f.sha256, f.envoye_par, f.cree_le, ${CLE_TRI} AS cle_tri
         FROM rapports_mission r JOIN fichiers f ON f.id = r.fichier_id
         WHERE r.mission_id = $1 AND r.niveau = ANY ($2::text[])
           AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
           AND ($3::text IS NULL OR (${CLE_TRI}, r.id) < ($3, $4::uuid))
         ORDER BY cle_tri DESC, r.id DESC LIMIT $5`,
        [id, niveauxLisibles(auth.roles), apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      type Ligne = Record<string, unknown> & { cle_tri: string; id: string };
      const page = paginer(r.rows as Ligne[], q.limite);
      return {
        elements: page.elements.map((l) => ({
          id: l.id,
          mission_id: l.mission_id,
          modele: l.modele,
          format: l.format,
          statut: l.statut,
          niveau: l.niveau,
          genere_par: l.genere_par,
          genere_le: l.genere_le,
          fichier: vueFichier({ ...l, id: l.fichier_id }),
        })),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });
};

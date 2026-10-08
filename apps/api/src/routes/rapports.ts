import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  aPermission,
  rapportServiceQuerySchema,
  rapportsListeQuerySchema,
  rapportsParametresSchema,
  type Permission,
} from "@missionpilot/shared";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { exigerNotationVisible } from "../notation/notations.js";
import { exigerPlanVisible } from "../plans/acces.js";
import {
  enregistrerRapport,
  verifierDebitRapports,
  type ModeleRapport,
  type SourceRapport,
} from "../rapports/enregistrement.js";
import { rapportEtatAvancement } from "../rapports/etat-avancement.js";
import { listerRapports } from "../rapports/liste.js";
import type { Rapport } from "../rapports/modele.js";
import { peutLireNiveau, type NiveauRapport } from "../rapports/niveaux.js";
import { rapportNotation } from "../rapports/notation.js";
import {
  conservationRaccourcie,
  confirmationConservationRequise,
  lireParametresRapports,
  modifierParametresRapports,
} from "../rapports/parametres.js";
import { cheminNavigateur } from "../rapports/pdf.js";
import { rapportPlan } from "../rapports/plan.js";
import { FORMATS_RAPPORT, rendreRapport, type FormatRapport } from "../rapports/rendu.js";
import { routesFacturesPdf } from "./factures-pdf.js";

/** Format de sortie de l'état d'avancement (`?format=pdf|docx|pptx`). */
const rapportQuerySchema = z.object({ format: z.enum(FORMATS_RAPPORT) }).strict();

/*
 * Rapports générés (SOC-07). Un rapport n'est PAS un document de mission
 * (rapports/enregistrement.ts) ; son fichier se télécharge par
 * GET /fichiers/:id, qui revérifie ses droits (mission visible,
 * « mission.lire », permissions du niveau) à chaque appel.
 *
 * Génération (commune) : mission visible (404 sinon, y compris un autre
 * cabinet), mission non clôturée (409), au plus 10 générations par
 * utilisateur sur 10 minutes (429 TROP_DE_RAPPORTS, contrôlé avant le rendu
 * puis sous verrou à l'enregistrement), rendu hors transaction (PDF : au plus
 * un rendu simultané par cabinet, deux en tout), mention de pied de page du
 * cabinet (rapports/parametres.ts). Réponse 201 : métadonnées du rapport et
 * du fichier.
 *
 * - POST /missions/:id/rapports?format=pdf|docx|pptx — état d'avancement
 *   (« mission.lire ») ; sections en jours avec « budget.lire_jours »,
 *   financière avec « finance.lire » (rapports/etat-avancement.ts).
 * - POST /notations/:id/rapports?format=pdf|docx[&version=n] — rapport de la
 *   notation PUBLIÉE (« mission.lire » et « notation.lire » ; 409
 *   NOTATION_NON_PUBLIEE sinon ; rapports/notation.ts).
 * - POST /plans/:id/rapports?format=pdf|docx[&version=n] — plan stratégique,
 *   contenus validés seulement (« mission.lire » et « plan.lire » ;
 *   rapports/plan.ts) ; `version` : version du modèle financier.
 *
 * Listes paginées (plus récent d'abord ; seuls les niveaux lisibles par
 * l'appelant, fichiers supprimés ou purgés exclus, jamais la clé de stockage) :
 * GET /missions/:id/rapports (tous modèles), GET /notations/:id/rapports,
 * GET /plans/:id/rapports (mêmes permissions que la génération).
 *
 * Paramètres du cabinet (« cabinet.gerer ») : GET et PUT /rapports/parametres
 * (durée de conservation, mention de la contribution de l'IA). RACCOURCIR la
 * durée exige la reconfirmation de l'identité (bloc `confirmation` : mot de
 * passe, et code si la 2FA est active ; 403 CONFIRMATION_REQUISE sinon) : la
 * purge est sans retour sur une mission clôturée, où aucun rapport ne peut être refait.
 *
 * Monte aussi GET /factures/:id/pdf (routes/factures-pdf.ts).
 */

interface Construit {
  rapport: Rapport;
  niveau: NiveauRapport;
  missionId: string;
  source?: SourceRapport;
}

/** « mission.lire » et chacune des permissions, sinon 401/403 avant tout accès aux données. */
function exigerToutes(request: Parameters<typeof exiger>[0], permissions: Permission[]): Auth {
  const auth = exiger(request, "mission.lire");
  if (!permissions.every((p) => aPermission(auth.roles, p))) throw interdit();
  return auth;
}

/** Mission visible (404), non clôturée (409) et débit de l'utilisateur non atteint (429). */
async function exigerGenerationPermise(db: Db, auth: Auth, missionId: string): Promise<void> {
  const mission = await exigerMissionVisible(db, auth, missionId);
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  await verifierDebitRapports(db, auth);
}

/**
 * Construit le contenu (transaction du cabinet), contrôle mission visible, ouverte et débit
 * (UNE fois : avant la construction si la mission est connue d'avance, `missionConnue`, sinon
 * juste après, d'après celle du contenu construit), ajoute la mention du cabinet, rend hors
 * transaction puis enregistre.
 */
async function generer(
  app: FastifyInstance,
  auth: Auth,
  modele: ModeleRapport,
  format: FormatRapport,
  missionConnue: string | null,
  construire: (db: Db, date: string) => Promise<Construit>,
) {
  const date = aujourdhui();
  const c = await app.db.withTenant(auth.cabinetId, async (db) => {
    if (missionConnue) await exigerGenerationPermise(db, auth, missionConnue);
    const construit = await construire(db, date);
    if (!missionConnue) await exigerGenerationPermise(db, auth, construit.missionId);
    const { mention_effective: mention } = await lireParametresRapports(db);
    return mention
      ? { ...construit, rapport: { ...construit.rapport, mention_pied: mention } }
      : construit;
  });
  const { rapport, contenu } = await rendreRapport(c.rapport, format, {
    cheminNavigateur: format === "pdf" ? cheminNavigateur(app.config) : null,
    cabinetId: auth.cabinetId,
    plafondOctets: app.config.FICHIER_TAILLE_MAX_OCTETS,
  });
  return enregistrerRapport(app, auth, {
    missionId: c.missionId,
    modele,
    format,
    rapport,
    niveau: c.niveau,
    contenu,
    source: c.source,
  });
}

export const routesRapports: FastifyPluginAsync = async (app) => {
  await app.register(routesFacturesPdf);

  /* ----- État d'avancement ----- */

  app.post("/missions/:id/rapports", async (request, reply) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const { format } = rapportQuerySchema.parse(request.query);
    // Le générateur n'inclut que ce qu'il pourrait relire (niveaux cumulatifs).
    const droits = {
      jours: peutLireNiveau(auth.roles, "jours"),
      finance: peutLireNiveau(auth.roles, "finance"),
    };
    const resultat = await generer(app, auth, "etat_avancement", format, id, async (db, date) => {
      const { rapport, niveau } = await rapportEtatAvancement(db, auth, id, droits, date);
      return { rapport, niveau, missionId: id };
    });
    reply.status(201);
    return resultat;
  });

  app.get("/missions/:id/rapports", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    const q = rapportsListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return listerRapports(db, auth, { missionId: id }, q);
    });
  });

  /* ----- Notation publiée (NOT-07) ----- */

  app.post("/notations/:id/rapports", async (request, reply) => {
    const auth = exigerToutes(request, ["notation.lire"]);
    const { id } = paramsId.parse(request.params);
    const { format, version } = rapportServiceQuerySchema.parse(request.query);
    const resultat = await generer(app, auth, "notation", format, null, async (db, date) => {
      const { rapport, source } = await rapportNotation(db, auth, id, version, date);
      return {
        rapport,
        niveau: "notation",
        missionId: source.missionId,
        source: { notationId: source.notationId, version: source.version },
      };
    });
    reply.status(201);
    return resultat;
  });

  app.get("/notations/:id/rapports", async (request) => {
    const auth = exigerToutes(request, ["notation.lire"]);
    const { id } = paramsId.parse(request.params);
    const q = rapportsListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerNotationVisible(db, auth, id);
      return listerRapports(db, auth, { notationId: id }, q);
    });
  });

  /* ----- Plan stratégique (PLA-11) ----- */

  app.post("/plans/:id/rapports", async (request, reply) => {
    const auth = exigerToutes(request, ["plan.lire"]);
    const { id } = paramsId.parse(request.params);
    const { format, version } = rapportServiceQuerySchema.parse(request.query);
    const resultat = await generer(
      app,
      auth,
      "plan_strategique",
      format,
      null,
      async (db, date) => {
        const { rapport, source } = await rapportPlan(db, auth, id, version, date);
        return {
          rapport,
          niveau: "plan",
          missionId: source.missionId,
          source: { planId: source.planId, version: source.version },
        };
      },
    );
    reply.status(201);
    return resultat;
  });

  app.get("/plans/:id/rapports", async (request) => {
    const auth = exigerToutes(request, ["plan.lire"]);
    const { id } = paramsId.parse(request.params);
    const q = rapportsListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerPlanVisible(db, auth, id);
      return listerRapports(db, auth, { planId: id }, q);
    });
  });

  /* ----- Paramètres du cabinet ----- */

  app.get("/rapports/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresRapports(db));
  });

  app.put("/rapports/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { confirmation, ...corps } = rapportsParametresSchema.parse(request.body);
    // Lecture préalable (hors verrou) : la reconfirmation n'est demandée que si elle est due ;
    // modifierParametresRapports la revérifie dans la transaction d'écriture.
    const avant = await app.db.withTenant(auth.cabinetId, (db) => lireParametresRapports(db));
    if (!conservationRaccourcie(avant, corps)) {
      return app.db.withTenant(auth.cabinetId, (db) => modifierParametresRapports(db, auth, corps));
    }
    if (!confirmation?.mot_de_passe) throw confirmationConservationRequise();
    return serviceIdentite(app).confirmerIdentite(
      auth,
      confirmation,
      "conservation_rapports",
      (db, facteur) => modifierParametresRapports(db, auth, corps, facteur),
      { motDePasseSeulSiInactive: true },
    );
  });
};

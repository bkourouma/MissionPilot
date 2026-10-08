import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from "fastify";
import { periodeKpiDe } from "@missionpilot/engines";
import { kpiCorrectionSchema, kpiMesureSchema, kpiMesuresQuerySchema } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { conflit, interdit } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import {
  ciblesDe,
  COLONNES_KPI,
  parKpi,
  versDefinition,
  type CibleKpi,
  type DefinitionKpi,
} from "../kpi/donnees.js";
import {
  COLONNES_MESURE,
  insererMesure,
  lireMesure,
  versMesure,
  vueMesurePortail,
  type LigneMesure,
} from "../kpi/mesures.js";
import { evaluerApresSaisie } from "../kpi/suivi.js";
import { cibleActuelle } from "../kpi/tableau.js";
import { aujourdhui } from "../missions/outils.js";
import {
  avecPortail,
  exigerPortail,
  introuvablePortail,
  journaliserPortail,
  type AccesPortail,
} from "../portail/acces.js";
import { horsContextePortail } from "../portail/contexte.js";

/*
 * Saisie des KPI par les contributeurs du client (service #4, KPI-02), sous
 * /api/portail/kpi. Règles (en plus de portail/acces.ts) :
 * - seuls les KPI dont l'utilisateur est contributeur DÉSIGNÉ par le cabinet
 *   (kpi_contributeurs) existent pour lui ; tout autre identifiant (autre
 *   KPI du client, autre client, autre cabinet, inexistant) répond le même
 *   404 du portail ;
 * - projection minimale : définition utile à la saisie, cible en vigueur et
 *   mesures du KPI ; jamais la mission, l'équipe, le propriétaire, l'auteur
 *   d'une mesure (seulement « saisie par moi »), les alertes ni le tableau
 *   de bord interne ;
 * - un contributeur ne corrige que ses propres mesures ; la mission du KPI
 *   doit être ouverte ; tout accès est journalisé ;
 * - toute lecture se fait dans le contexte du portail (db/pool.ts) ; seule
 *   l'évaluation interne des alertes après saisie en sort, explicitement.
 */

const ROLES_SAISIE = ["client_dirigeant", "client_contributeur"];

function exigerContributeur(request: Parameters<typeof exigerPortail>[0]): AccesPortail {
  const acces = exigerPortail(request, "portail.kpi.saisir");
  if (!acces.auth.roles.some((r) => ROLES_SAISIE.includes(r))) throw interdit();
  return acces;
}

/** Fragment SQL (alias `d`) : KPI du client ($pClient) dont l'utilisateur ($pUtilisateur) est contributeur. */
function filtreContributeur(pClient: number, pUtilisateur: number): string {
  return `d.client_id = $${pClient} AND EXISTS (SELECT 1 FROM kpi_contributeurs k
    WHERE k.kpi_id = d.id AND k.utilisateur_id = $${pUtilisateur})`;
}

/** KPI dont l'utilisateur est contributeur, sinon le 404 du portail. */
async function exigerKpiPortail(
  db: Db,
  acces: AccesPortail,
  id: string,
  verrouiller = false,
): Promise<DefinitionKpi> {
  const r = await db.query(
    `SELECT ${COLONNES_KPI} FROM kpi_definitions d WHERE d.id = $1 AND ${filtreContributeur(2, 3)}
     ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id, acces.clientId, acces.auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return versDefinition(r.rows[0]);
}

function vueKpiPortail(def: DefinitionKpi, cibles: readonly CibleKpi[]) {
  const date = aujourdhui();
  return {
    id: def.id,
    libelle: def.libelle,
    description: def.description,
    unite: def.unite,
    sens: def.sens,
    nature: def.nature,
    frequence: def.frequence,
    debut_suivi: def.debut_suivi,
    fin_suivi: def.fin_suivi,
    actif: def.actif,
    cible_actuelle: cibleActuelle(def, cibles, date),
    periode_en_cours: periodeKpiDe(date, def.frequence).cle,
  };
}

/**
 * La mission du KPI n'est pas clôturée. Contrôle DANS la transaction du
 * portail : la mission y est invisible si elle n'est pas partagée, et seule
 * la fonction étroite `portail_kpi_mission_cloturee` (migration 0115) dit si
 * elle est close, pour un KPI dont l'utilisateur est contributeur ; sinon le
 * même 404.
 */
async function exigerMissionOuverte(db: Db, kpiId: string) {
  const r = await db.query("SELECT portail_kpi_mission_cloturee($1) AS cloturee", [kpiId]);
  const cloturee = r.rows[0]?.cloturee as boolean | null | undefined;
  if (cloturee === null || cloturee === undefined) throw introuvablePortail();
  if (cloturee) throw conflit("La mission de ce KPI est clôturée.");
}

/**
 * Évaluation des alertes après une saisie : traitement INTERNE (seuils,
 * paramètres, notifications des responsables), qui ne renvoie rien au client,
 * donc hors du contexte du portail (portail/contexte.ts).
 */
function evaluerHorsPortail(
  app: FastifyInstance,
  acces: AccesPortail,
  kpiId: string,
  log: FastifyBaseLogger,
) {
  return horsContextePortail(() => evaluerApresSaisie(app, acces.auth.cabinetId, kpiId, log));
}

async function mesureDuPortail(db: Db, acces: AccesPortail, id: string): Promise<LigneMesure> {
  const m = await lireMesure(db, id);
  if (!m) throw introuvablePortail();
  await exigerKpiPortail(db, acces, m.kpi_id);
  return m;
}

function routesLecture(app: FastifyInstance) {
  app.get("/portail/kpi", async (request) => {
    const acces = exigerContributeur(request);
    const q = kpiMesuresQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_KPI}, lower(d.libelle) AS cle_tri FROM kpi_definitions d
         WHERE ${filtreContributeur(1, 2)}
           AND ($3::text IS NULL OR (lower(d.libelle), d.id) > ($3, $4::uuid))
         ORDER BY lower(d.libelle), d.id LIMIT $5`,
        [
          acces.clientId,
          acces.auth.utilisateurId,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(
        r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
        q.limite,
      );
      const defs = page.elements.map(versDefinition);
      const cibles = parKpi(
        await ciblesDe(
          db,
          defs.map((d) => d.id),
        ),
      );
      const elements = defs.map((d) => vueKpiPortail(d, cibles.get(d.id) ?? []));
      await journaliserPortail(db, acces, "portail.kpi.lister", "kpi", null, {
        nombre: elements.length,
      });
      return { elements, curseur_suivant: page.curseur_suivant };
    });
  });

  app.get("/portail/kpi/:id", async (request) => {
    const acces = exigerContributeur(request);
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const def = await exigerKpiPortail(db, acces, id);
      await journaliserPortail(db, acces, "portail.kpi.lire", "kpi", id);
      return vueKpiPortail(def, await ciblesDe(db, [def.id]));
    });
  });

  app.get("/portail/kpi/:id/mesures", async (request) => {
    const acces = exigerContributeur(request);
    const { id } = paramsId.parse(request.params);
    const q = kpiMesuresQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const def = await exigerKpiPortail(db, acces, id);
      const r = await db.query(
        `SELECT ${COLONNES_MESURE}, m.numero::text AS cle_tri FROM kpi_mesures m
         WHERE m.kpi_id = $1 AND ($2::bigint IS NULL OR m.numero < $2::bigint)
         ORDER BY m.numero DESC LIMIT $3`,
        [id, apres && /^\d{1,19}$/.test(apres[0]) ? apres[0] : null, q.limite + 1],
      );
      const page = paginer(
        r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
        q.limite,
      );
      await journaliserPortail(db, acces, "portail.kpi.mesures.lire", "kpi", id);
      return {
        elements: page.elements.map((l) =>
          vueMesurePortail(versMesure(l), def.frequence, acces.auth.utilisateurId),
        ),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });
}

function routesSaisie(app: FastifyInstance) {
  app.post("/portail/kpi/:id/mesures", async (request, reply) => {
    const acces = exigerContributeur(request);
    const { id } = paramsId.parse(request.params);
    const c = kpiMesureSchema.parse(request.body);
    const vue = await avecPortail(app, acces, async (db) => {
      const def = await exigerKpiPortail(db, acces, id, true);
      await exigerMissionOuverte(db, id);
      const m = await insererMesure(db, {
        cabinetId: acces.auth.cabinetId,
        kpiId: id,
        dateMesure: c.date_mesure,
        valeur: c.valeur,
        remplaceId: null,
        motif: null,
        commentaire: c.commentaire ?? null,
        justificatif: c.justificatif ?? null,
        origine: "portail",
        saisiePar: acces.auth.utilisateurId,
      });
      await journaliserPortail(db, acces, "portail.kpi.mesure.saisir", "kpi_mesure", m.id, {
        kpi_id: id,
        date_mesure: m.date_mesure,
      });
      return vueMesurePortail(m, def.frequence, acces.auth.utilisateurId);
    });
    await evaluerHorsPortail(app, acces, id, request.log);
    reply.status(201);
    return vue;
  });

  app.post("/portail/kpi/mesures/:id/corrections", async (request, reply) => {
    const acces = exigerContributeur(request);
    const { id } = paramsId.parse(request.params);
    const c = kpiCorrectionSchema.parse(request.body);
    const { kpiId, vue } = await avecPortail(app, acces, async (db) => {
      const kpiId = (await mesureDuPortail(db, acces, id)).kpi_id;
      const def = await exigerKpiPortail(db, acces, kpiId, true);
      await exigerMissionOuverte(db, kpiId);
      // Relue après le verrou du KPI : une correction concurrente est vue.
      const cible = await mesureDuPortail(db, acces, id);
      if (cible.saisie_par !== acces.auth.utilisateurId) throw interdit();
      if (cible.annulation || cible.remplacee) {
        throw conflit("Cette mesure a déjà été corrigée ou annulée.");
      }
      const m = await insererMesure(db, {
        cabinetId: acces.auth.cabinetId,
        kpiId,
        dateMesure: c.date_mesure,
        valeur: c.valeur,
        remplaceId: cible.id,
        motif: c.motif,
        commentaire: c.commentaire ?? null,
        justificatif: c.justificatif ?? null,
        origine: "portail",
        saisiePar: acces.auth.utilisateurId,
      });
      await journaliserPortail(db, acces, "portail.kpi.mesure.corriger", "kpi_mesure", m.id, {
        kpi_id: kpiId,
        remplace_id: cible.id,
      });
      return { kpiId, vue: vueMesurePortail(m, def.frequence, acces.auth.utilisateurId) };
    });
    await evaluerHorsPortail(app, acces, kpiId, request.log);
    reply.status(201);
    return vue;
  });
}

export const routesPortailKpi: FastifyPluginAsync = async (app) => {
  routesLecture(app);
  routesSaisie(app);
};

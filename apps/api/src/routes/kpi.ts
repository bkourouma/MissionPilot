import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { periodeKpiDe } from "@missionpilot/engines";
import {
  kpiAnnulationSchema,
  kpiCibleSchema,
  kpiContributeursSchema,
  kpiCorrectionSchema,
  kpiCreationSchema,
  kpiMesureSchema,
  kpiMesuresQuerySchema,
  kpiModificationSchema,
  kpiParametresSchema,
  kpiTableauQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import {
  exigerAnnulationPermise,
  exigerKpiGerable,
  exigerKpiSaisissable,
  exigerKpiVisible,
  exigerProprietaireValide,
  type AccesKpi,
} from "../kpi/acces.js";
import { insererKpi, numerique } from "../kpi/creation.js";
import {
  ciblesDe,
  definitionsDeMission,
  lireDefinition,
  lireParametresKpi,
  parKpi,
  type DefinitionKpi,
  type ParametresKpi,
} from "../kpi/donnees.js";
import { traduireErreurKpi } from "../kpi/erreurs.js";
import {
  COLONNES_MESURE,
  insererMesure,
  lireMesure,
  versMesure,
  vueMesure,
  type LigneMesure,
} from "../kpi/mesures.js";
import { evaluerApresSaisie } from "../kpi/suivi.js";
import {
  cibleActuelle,
  exporterKpiMission,
  serieKpiMission,
  tableauDeBord,
} from "../kpi/tableau.js";
import { vueCible, vueDefinition } from "../kpi/vues.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { routesPortailKpi } from "./portail-kpi.js";

/*
 * Pilotage par KPI (service #4, KPI-01 à KPI-04), monté sous /api.
 * Droits : permissions kpi.* de packages/shared/src/roles.ts et règles de
 * kpi/acces.ts (visibilité de la mission toujours exigée en plus).
 * Historique des cibles et des mesures en ajout seul (migration 0160) ;
 * chaque écriture est journalisée dans sa transaction, sans valeur chiffrée.
 * Tous les chiffres servis sortent du moteur (kpi/evaluation.ts).
 */

function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  id: string,
  details: Record<string, unknown> = {},
) {
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details,
  });
}

async function detailKpi(db: Db, def: DefinitionKpi) {
  const cibles = await ciblesDe(db, [def.id]);
  const c = await db.query(
    `SELECT u.id, u.nom, u.email FROM kpi_contributeurs k JOIN utilisateurs u ON u.id = k.utilisateur_id
     WHERE k.kpi_id = $1 ORDER BY lower(u.nom), u.id`,
    [def.id],
  );
  return {
    ...vueDefinition(def, cibleActuelle(def, cibles, aujourdhui())),
    cibles: cibles.map(vueCible),
    contributeurs: c.rows,
  };
}

/** Mesure d'un KPI saisissable par l'utilisateur ; 404 identique sinon. */
async function exigerMesureSaisissable(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ mesure: LigneMesure; acces: AccesKpi }> {
  const mesure = await lireMesure(db, id);
  if (!mesure) throw introuvable("Mesure");
  const acces = await exigerKpiSaisissable(db, auth, mesure.kpi_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Mesure") : e;
  });
  if (mesure.annulation || mesure.remplacee) {
    throw conflit("Cette mesure a déjà été corrigée ou annulée.");
  }
  return { mesure, acces };
}

async function creerKpi(db: Db, auth: Auth, missionId: string, corps: unknown) {
  const c = kpiCreationSchema.parse(corps);
  const id = await insererKpi(db, auth, missionId, c);
  const def = await lireDefinition(db, id);
  if (!def) throw introuvable("KPI");
  return detailKpi(db, def);
}

async function definirCible(db: Db, auth: Auth, id: string, corps: unknown) {
  const c = kpiCibleSchema.parse(corps);
  const { def } = await exigerKpiGerable(db, auth, id);
  const aPartirDe = periodeKpiDe(c.a_partir_de, def.frequence).debut;
  if (aPartirDe < def.debut_suivi) {
    throw requeteInvalide("Une cible ne peut pas précéder le début du suivi du KPI.");
  }
  const r = await db.query(
    `INSERT INTO kpi_cibles (cabinet_id, kpi_id, version, valeur, a_partir_de, motif, cree_par)
     VALUES ($1, $2, 1, $3::numeric, $4, $5, $6) RETURNING version`,
    [auth.cabinetId, id, numerique(c.valeur), aPartirDe, c.motif ?? null, auth.utilisateurId],
  );
  const version = r.rows[0].version as number;
  await journal(db, auth, "kpi.cible.definir", "kpi", id, { version, a_partir_de: aPartirDe });
  return detailKpi(db, def);
}

async function remplacerContributeurs(db: Db, auth: Auth, id: string, corps: unknown) {
  const { utilisateurs } = kpiContributeursSchema.parse(corps);
  const { def } = await exigerKpiGerable(db, auth, id);
  const avant = await db.query(
    "SELECT utilisateur_id FROM kpi_contributeurs WHERE kpi_id = $1 ORDER BY utilisateur_id",
    [id],
  );
  await db.query("DELETE FROM kpi_contributeurs WHERE kpi_id = $1", [id]);
  await db.query(
    `INSERT INTO kpi_contributeurs (cabinet_id, kpi_id, utilisateur_id, ajoute_par)
     SELECT $1, $2, u, $4 FROM unnest($3::uuid[]) AS u`,
    [auth.cabinetId, id, utilisateurs, auth.utilisateurId],
  );
  await journal(db, auth, "kpi.contributeurs.remplacer", "kpi", id, {
    avant: avant.rows.map((l) => l.utilisateur_id),
    apres: utilisateurs,
  });
  return detailKpi(db, def);
}

async function modifierKpi(db: Db, auth: Auth, id: string, corps: unknown) {
  const modif = kpiModificationSchema.parse(corps);
  const { def } = await exigerKpiGerable(db, auth, id);
  await exigerProprietaireValide(db, def.mission_id, modif.proprietaire_id);
  const set = clauseSet(modif, 3);
  await db.query(`UPDATE kpi_definitions SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  const apres = await lireDefinition(db, id);
  if (!apres) throw introuvable("KPI");
  const champs = Object.keys(modif).filter((k) => modif[k as keyof typeof modif] !== undefined);
  await journal(db, auth, "kpi.modifier", "kpi", id, {
    champs,
    avant: Object.fromEntries(champs.map((k) => [k, def[k as keyof DefinitionKpi]])),
    apres: Object.fromEntries(champs.map((k) => [k, apres[k as keyof DefinitionKpi]])),
  });
  return detailKpi(db, apres);
}

async function lireMesures(db: Db, auth: Auth, id: string, query: unknown) {
  const q = kpiMesuresQuerySchema.parse(query);
  const apres = decoderCurseur(q.curseur);
  if (apres && !/^\d{1,19}$/.test(apres[0])) throw requeteInvalide("Curseur invalide.");
  const { def } = await exigerKpiVisible(db, auth, id);
  const r = await db.query(
    `SELECT ${COLONNES_MESURE}, u.nom AS saisie_par_nom, m.numero::text AS cle_tri
     FROM kpi_mesures m LEFT JOIN utilisateurs u ON u.id = m.saisie_par
     WHERE m.kpi_id = $1 AND ($2::bigint IS NULL OR m.numero < $2::bigint)
     ORDER BY m.numero DESC LIMIT $3`,
    [id, apres?.[0] ?? null, q.limite + 1],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return {
    elements: page.elements.map((l) => vueMesure(versMesure(l), def.frequence)),
    curseur_suivant: page.curseur_suivant,
  };
}

async function lireAlertes(db: Db, auth: Auth, id: string, query: unknown) {
  const q = kpiMesuresQuerySchema.parse(query);
  const apres = decoderCurseur(q.curseur);
  await exigerKpiVisible(db, auth, id);
  const r = await db.query(
    `SELECT id, code, periode_cle AS periode, details, detectee_le,
       to_char(detectee_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS cle_tri
     FROM kpi_alertes WHERE kpi_id = $1
       AND ($2::text IS NULL OR (to_char(detectee_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'), id)
            < ($2, $3::uuid))
     ORDER BY cle_tri DESC, id DESC LIMIT $4`,
    [id, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  return paginer(r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[], q.limite);
}

async function modifierParametres(db: Db, auth: Auth, corps: unknown) {
  const modif = kpiParametresSchema.parse(corps);
  const avant = await lireParametresKpi(db);
  const apres: ParametresKpi = {
    rappels_actifs: modif.rappels_actifs ?? avant.rappels_actifs,
    delai_grace_jours: modif.delai_grace_jours ?? avant.delai_grace_jours,
    periodes_degradation: modif.periodes_degradation ?? avant.periodes_degradation,
    valeurs_validees: modif.valeurs_validees ?? avant.valeurs_validees,
  };
  await db.query(
    `INSERT INTO kpi_parametres (cabinet_id, rappels_actifs, delai_grace_jours, periodes_degradation,
       valeurs_validees, modifie_par, modifie_le)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (cabinet_id) DO UPDATE SET rappels_actifs = EXCLUDED.rappels_actifs,
       delai_grace_jours = EXCLUDED.delai_grace_jours,
       periodes_degradation = EXCLUDED.periodes_degradation,
       valeurs_validees = EXCLUDED.valeurs_validees, modifie_par = EXCLUDED.modifie_par,
       modifie_le = now()`,
    [
      auth.cabinetId,
      apres.rappels_actifs,
      apres.delai_grace_jours,
      apres.periodes_degradation,
      apres.valeurs_validees,
      auth.utilisateurId,
    ],
  );
  await journal(db, auth, "kpi.parametres.modifier", "kpi_parametres", auth.cabinetId, {
    avant,
    apres,
  });
  return lireParametresKpi(db);
}

function routesDefinitions(app: FastifyInstance) {
  app.get("/missions/:id/kpi", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const defs = await definitionsDeMission(db, id);
      const cibles = parKpi(
        await ciblesDe(
          db,
          defs.map((d) => d.id),
        ),
      );
      const date = aujourdhui();
      return {
        elements: defs.map((d) => vueDefinition(d, cibleActuelle(d, cibles.get(d.id) ?? [], date))),
      };
    });
  });

  app.post("/missions/:id/kpi", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const kpi = await app.db.withTenant(auth.cabinetId, (db) =>
      creerKpi(db, auth, id, request.body),
    );
    reply.status(201);
    return kpi;
  });

  app.get("/kpi/parametres", async (request) => {
    const auth = exiger(request, "kpi.lire");
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresKpi(db));
  });

  app.patch("/kpi/parametres", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    return app.db.withTenant(auth.cabinetId, (db) => modifierParametres(db, auth, request.body));
  });

  app.get("/kpi/:id", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailKpi(db, (await exigerKpiVisible(db, auth, id)).def),
    );
  });

  app.patch("/kpi/:id", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => modifierKpi(db, auth, id, request.body));
  });

  app.post("/kpi/:id/cibles", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const kpi = await app.db.withTenant(auth.cabinetId, (db) =>
      definirCible(db, auth, id, request.body),
    );
    reply.status(201);
    return kpi;
  });

  app.put("/kpi/:id/contributeurs", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      remplacerContributeurs(db, auth, id, request.body),
    );
  });
}

function routesMesures(app: FastifyInstance) {
  app.get("/kpi/:id/mesures", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireMesures(db, auth, id, request.query));
  });

  app.post("/kpi/:id/mesures", async (request, reply) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    const c = kpiMesureSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { def } = await exigerKpiSaisissable(db, auth, id);
      const m = await insererMesure(db, {
        cabinetId: auth.cabinetId,
        kpiId: id,
        dateMesure: c.date_mesure,
        valeur: c.valeur,
        remplaceId: null,
        motif: null,
        commentaire: c.commentaire ?? null,
        justificatif: c.justificatif ?? null,
        origine: "cabinet",
        saisiePar: auth.utilisateurId,
      });
      await journal(db, auth, "kpi.mesure.saisir", "kpi_mesure", m.id, {
        kpi_id: id,
        date_mesure: m.date_mesure,
      });
      return vueMesure(m, def.frequence);
    });
    await evaluerApresSaisie(app, auth.cabinetId, id, request.log);
    reply.status(201);
    return vue;
  });

  app.post("/kpi/mesures/:id/corrections", async (request, reply) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    const c = kpiCorrectionSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { mesure, acces } = await exigerMesureSaisissable(db, auth, id);
      const m = await insererMesure(db, {
        cabinetId: auth.cabinetId,
        kpiId: mesure.kpi_id,
        dateMesure: c.date_mesure,
        valeur: c.valeur,
        remplaceId: mesure.id,
        motif: c.motif,
        commentaire: c.commentaire ?? null,
        justificatif: c.justificatif ?? null,
        origine: "cabinet",
        saisiePar: auth.utilisateurId,
      });
      await journal(db, auth, "kpi.mesure.corriger", "kpi_mesure", m.id, {
        kpi_id: mesure.kpi_id,
        remplace_id: mesure.id,
        motif: c.motif,
      });
      return vueMesure(m, acces.def.frequence);
    });
    await evaluerApresSaisie(app, auth.cabinetId, vue.kpi_id, request.log);
    reply.status(201);
    return vue;
  });

  app.post("/kpi/mesures/:id/annulation", async (request, reply) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    const c = kpiAnnulationSchema.parse(request.body);
    const vue = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { mesure, acces } = await exigerMesureSaisissable(db, auth, id);
      exigerAnnulationPermise(auth, acces, mesure.origine);
      const m = await insererMesure(db, {
        cabinetId: auth.cabinetId,
        kpiId: mesure.kpi_id,
        dateMesure: mesure.date_mesure,
        valeur: null,
        remplaceId: mesure.id,
        motif: c.motif,
        commentaire: null,
        justificatif: null,
        origine: "cabinet",
        saisiePar: auth.utilisateurId,
      });
      await journal(db, auth, "kpi.mesure.annuler", "kpi_mesure", m.id, {
        kpi_id: mesure.kpi_id,
        remplace_id: mesure.id,
        motif: c.motif,
      });
      return vueMesure(m, acces.def.frequence);
    });
    reply.status(201);
    return vue;
  });
}

function routesPilotage(app: FastifyInstance) {
  app.get("/missions/:id/kpi/tableau-de-bord", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    const q = kpiTableauQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return tableauDeBord(db, id, q.date ?? aujourdhui());
    });
  });

  app.get("/missions/:id/kpi/series", async (request) => {
    // Lecture du tableau de bord (mêmes droits) : pas une extraction, donc pas d'entrée `kpi.exporter`.
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    const q = kpiTableauQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return serieKpiMission(db, id, q.date ?? aujourdhui());
    });
  });

  app.get("/missions/:id/kpi/export", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    const q = kpiTableauQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const date = q.date ?? aujourdhui();
      const donnees = await exporterKpiMission(db, id, date);
      await journal(db, auth, "kpi.exporter", "mission", id, { date_reference: date });
      return donnees;
    });
  });

  app.get("/kpi/:id/alertes", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireAlertes(db, auth, id, request.query));
  });
}

export const routesKpi: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurKpi(error);
  });
  routesDefinitions(app);
  routesMesures(app);
  routesPilotage(app);
  await app.register(routesPortailKpi);
};

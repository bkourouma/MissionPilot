import type { FastifyPluginAsync } from "fastify";
import {
  estDateSaisieModifiable,
  lundiDeLaSemaine,
  periodeDuMois,
  sommerJours,
  versCentiemes,
} from "@missionpilot/engines";
import {
  aPermission,
  correctionDemandeSchema,
  correctionRejetSchema,
  correctionsQuerySchema,
  paramsMoisSchema,
  periodesQuerySchema,
  reouvertureSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { estAssocie, exigerMissionVisible, peutModifierMission } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { collaborateurAffectable, collaborateurDe } from "../planification/outils.js";
import { exigerTacheSaisissable } from "../temps/feuilles.js";
import {
  exigerUniteDuCabinet,
  jours,
  joursDeSaisies,
  lireParametresTemps,
  moisClotures,
  valideInterne,
} from "../temps/outils.js";
import { evaluerAlertes } from "../temps/suivi.js";

/*
 * Clôture mensuelle des temps et corrections tracées (TPS-09).
 * - Clôture (temps.cloturer : gestionnaire, associé) d'un mois terminé, sans
 *   feuille non validée portant des temps de ce mois ; les feuilles validées
 *   du mois passent « verrouillées ». Toute saisie, modification ou
 *   validation de ces dates est ensuite refusée (API et déclencheurs).
 * - Réouverture réservée à l'associé, avec motif, journalisée.
 * - Correction après validation ou clôture : demande tracée (ancienne et
 *   nouvelle valeur, motif, demandeur), décidée par un détenteur de
 *   temps.cloturer distinct du demandeur et de l'auteur des temps (sauf
 *   associé pour ce dernier). Une correction validée s'ajoute au réalisé.
 */

async function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  id: string,
  details: object,
) {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId: id,
    details: details as Record<string, unknown>,
  });
}

const COLONNES_PERIODE = `mois, statut, cloturee_par, cloturee_le, rouverte_par, rouverte_le,
  motif_reouverture`;

interface Case {
  collaborateur_id: string;
  date: string;
  tache_id: string | null;
  activite_id: string | null;
}

/** Valeur actuelle d'une case : lignes des feuilles validées + corrections validées. */
async function valeurEffective(db: Db, c: Case): Promise<number> {
  const r = await db.query(
    `SELECT l.centiemes AS v FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE f.collaborateur_id = $1 AND l.date = $2 AND f.statut IN ('validee', 'verrouillee')
       AND l.tache_id IS NOT DISTINCT FROM $3 AND l.activite_id IS NOT DISTINCT FROM $4
     UNION ALL
     SELECT nouvelle_centiemes - ancienne_centiemes FROM corrections_temps
     WHERE collaborateur_id = $1 AND date = $2 AND statut = 'validee'
       AND tache_id IS NOT DISTINCT FROM $3 AND activite_id IS NOT DISTINCT FROM $4`,
    [c.collaborateur_id, c.date, c.tache_id, c.activite_id],
  );
  return versCentiemes(sommerJours(r.rows.map((l) => jours(l.v))));
}

const COLONNES_CORRECTION = `k.id, k.collaborateur_id, c.nom AS collaborateur_nom, k.date::text AS date,
  k.mission_id, k.tache_id, t.libelle AS tache_libelle, k.activite_id, a.libelle AS activite_libelle,
  k.ancienne_centiemes, k.nouvelle_centiemes, k.motif, k.statut, k.demandee_par, k.demandee_le,
  k.decidee_par, k.decidee_le, k.motif_rejet`;
const DEPUIS_CORRECTION = `corrections_temps k JOIN collaborateurs c ON c.id = k.collaborateur_id
  LEFT JOIN mission_taches t ON t.id = k.tache_id LEFT JOIN activites_internes a ON a.id = k.activite_id`;

function vueCorrection(k: Record<string, unknown>): Record<string, unknown> {
  const { ancienne_centiemes, nouvelle_centiemes, ...reste } = k;
  delete reste.auteur_temps;
  return {
    ...reste,
    ancienne_valeur: jours(ancienne_centiemes),
    nouvelle_valeur: jours(nouvelle_centiemes),
  };
}

async function lireCorrection(db: Db, id: string, verrouiller = false) {
  const r = await db.query(
    `SELECT ${COLONNES_CORRECTION}, c.utilisateur_id AS auteur_temps
     FROM ${DEPUIS_CORRECTION} WHERE k.id = $1 ${verrouiller ? "FOR UPDATE OF k" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Correction");
  return r.rows[0] as Record<string, unknown>;
}

const decideCorrections = (auth: Auth) => aPermission(auth.roles, "temps.cloturer");

/** Décision d'une correction : en attente, ni le demandeur ni l'auteur des temps (sauf associé). */
async function exigerCorrectionDecidable(db: Db, auth: Auth, id: string) {
  const k = await lireCorrection(db, id, true);
  if (k.demandee_par === auth.utilisateurId) {
    throw new AppError(
      403,
      "AUTO_VALIDATION",
      "Vous ne pouvez pas décider de votre propre demande.",
    );
  }
  if (k.auteur_temps === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "AUTO_VALIDATION",
      "Vous ne pouvez pas décider d'une correction de vos temps.",
    );
  }
  if (k.statut !== "demandee") throw conflit("Cette correction a déjà été décidée.");
  return k;
}

export const routesPeriodesTemps: FastifyPluginAsync = async (app) => {
  app.get("/temps/periodes", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = periodesQuerySchema.parse(request.query);
    const annee = q.annee ?? Number(aujourdhui().slice(0, 4));
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_PERIODE} FROM periodes_temps WHERE mois LIKE $1 ORDER BY mois`,
        [`${annee}-%`],
      );
      const parMois = new Map(r.rows.map((p) => [p.mois as string, p]));
      return {
        annee,
        elements: Array.from({ length: 12 }, (_, i) => {
          const mois = `${annee}-${String(i + 1).padStart(2, "0")}`;
          return parMois.get(mois) ?? { mois, statut: "ouverte" };
        }),
      };
    });
  });

  app.post("/temps/periodes/:mois/cloturer", async (request) => {
    const auth = exiger(request, "temps.cloturer");
    const { mois } = paramsMoisSchema.parse(request.params);
    const periode = periodeDuMois(mois);
    if (periode.fin >= aujourdhui()) {
      throw conflit("Un mois ne se clôture qu'une fois terminé.");
    }
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Verrou applicatif du cabinet : clôtures et réouvertures concurrentes sérialisées.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('periodes_temps:' || $1))", [
        auth.cabinetId,
      ]);
      const existante = await db.query("SELECT statut FROM periodes_temps WHERE mois = $1", [mois]);
      if (existante.rows[0]?.statut === "cloturee")
        throw conflit("Cette période est déjà clôturée.");
      const enCours = await db.query(
        `SELECT count(DISTINCT f.id)::int AS n FROM feuilles_temps f
         JOIN lignes_temps l ON l.feuille_id = f.id
         WHERE l.date BETWEEN $1 AND $2 AND f.statut NOT IN ('validee', 'verrouillee')`,
        [periode.debut, periode.fin],
      );
      const n = enCours.rows[0].n as number;
      if (n > 0) {
        throw new AppError(
          409,
          "FEUILLES_EN_COURS",
          `${n} feuille(s) de temps de ce mois ne sont pas validées : les faire valider ou rejeter avant la clôture.`,
        );
      }
      await db.query(
        `INSERT INTO periodes_temps (cabinet_id, mois, statut, cloturee_par, cloturee_le)
         VALUES ($1, $2, 'cloturee', $3, now())
         ON CONFLICT (cabinet_id, mois) DO UPDATE SET statut = 'cloturee',
           cloturee_par = EXCLUDED.cloturee_par, cloturee_le = EXCLUDED.cloturee_le`,
        [auth.cabinetId, mois, auth.utilisateurId],
      );
      const verrouillees = await db.query(
        `UPDATE feuilles_temps f SET statut = 'verrouillee', verrouillee_le = now()
         WHERE f.statut = 'validee'
           AND EXISTS (SELECT 1 FROM lignes_temps l WHERE l.feuille_id = f.id
                       AND l.date BETWEEN $1 AND $2)`,
        [periode.debut, periode.fin],
      );
      await journal(db, auth, "cloture", "periode_temps", mois, {
        feuilles_verrouillees: verrouillees.rowCount ?? 0,
      });
      const r = await db.query(`SELECT ${COLONNES_PERIODE} FROM periodes_temps WHERE mois = $1`, [
        mois,
      ]);
      return { ...r.rows[0], feuilles_verrouillees: verrouillees.rowCount ?? 0 };
    });
  });

  /** Réouverture d'une période : associé uniquement, motif obligatoire, journalisée. */
  app.post("/temps/periodes/:mois/rouvrir", async (request) => {
    const auth = exiger(request, "temps.cloturer");
    if (!estAssocie(auth)) throw interdit();
    const { mois } = paramsMoisSchema.parse(request.params);
    const { motif } = reouvertureSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('periodes_temps:' || $1))", [
        auth.cabinetId,
      ]);
      const r = await db.query(
        `UPDATE periodes_temps SET statut = 'ouverte', rouverte_par = $2, rouverte_le = now(),
           motif_reouverture = $3
         WHERE mois = $1 AND statut = 'cloturee' RETURNING ${COLONNES_PERIODE}`,
        [mois, auth.utilisateurId, motif],
      );
      if (!r.rows[0]) throw conflit("Cette période n'est pas clôturée.");
      await journal(db, auth, "reouverture", "periode_temps", mois, { motif });
      return r.rows[0];
    });
  });

  app.get("/temps/corrections", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = correctionsQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    const CLE = "to_char(k.demandee_le, 'YYYY-MM-DD\"T\"HH24:MI:SS.US')";
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_CORRECTION}, ${CLE} AS cle_tri FROM ${DEPUIS_CORRECTION}
         WHERE ($1::boolean OR k.demandee_par = $2 OR c.utilisateur_id = $2)
           AND ($3::text IS NULL OR k.statut = $3)
           AND ($4::text IS NULL OR (${CLE}, k.id) > ($4, $5::uuid))
         ORDER BY cle_tri, k.id
         LIMIT $6`,
        [
          decideCorrections(auth),
          auth.utilisateurId,
          q.statut ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows, q.limite);
      return { ...page, elements: page.elements.map(vueCorrection) };
    });
  });

  app.post("/temps/corrections", async (request, reply) => {
    const auth = exiger(request, "temps.saisir");
    const d = correctionDemandeSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametresTemps(db, auth.cabinetId);
      exigerUniteDuCabinet(d, p, "Correction");
      const collaborateur = await collaborateurAffectable(db, d.collaborateur_id);
      const moi = await collaborateurDe(db, auth.utilisateurId);
      const pourSoi = collaborateur.id === moi?.id;
      let missionId: string | null = null;
      if (d.tache_id) {
        const t = await db.query(
          `SELECT t.id, t.mission_id, t.libelle, m.statut AS mission_statut,
             EXISTS (SELECT 1 FROM affectations a WHERE a.tache_id = t.id AND a.collaborateur_id = $2)
               AS affectee
           FROM mission_taches t JOIN missions m ON m.id = t.mission_id WHERE t.id = $1`,
          [d.tache_id, collaborateur.id],
        );
        const tache = exigerTacheSaisissable(t.rows[0]);
        missionId = tache.mission_id;
        if (!pourSoi) {
          const mission = await exigerMissionVisible(db, auth, missionId);
          if (!aPermission(auth.roles, "temps.valider") || !peutModifierMission(auth, mission)) {
            throw interdit();
          }
        }
      } else {
        const a = await db.query("SELECT actif FROM activites_internes WHERE id = $1", [
          d.activite_id,
        ]);
        if (!a.rows[0]?.actif) throw requeteInvalide("Activité interne inconnue ou désactivée.");
        if (!pourSoi && !valideInterne(auth)) throw interdit();
      }
      const ferme = !estDateSaisieModifiable(d.date, { moisClotures: await moisClotures(db) });
      const feuille = await db.query(
        "SELECT statut FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
        [collaborateur.id, lundiDeLaSemaine(d.date)],
      );
      const statut = feuille.rows[0]?.statut as string | undefined;
      if (!ferme && statut !== "validee" && statut !== "verrouillee") {
        throw new AppError(
          409,
          "CORRECTION_INUTILE",
          "Ces temps ne sont ni validés ni clôturés : corriger directement la feuille de temps.",
        );
      }
      const caseTemps: Case = {
        collaborateur_id: collaborateur.id,
        date: d.date,
        tache_id: d.tache_id ?? null,
        activite_id: d.activite_id ?? null,
      };
      const ancienne = await valeurEffective(db, caseTemps);
      const nouvelle = versCentiemes(joursDeSaisies([d], p));
      if (ancienne === nouvelle)
        throw requeteInvalide("La nouvelle valeur est identique à l'actuelle.");
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO corrections_temps (cabinet_id, collaborateur_id, date, mission_id, tache_id,
             activite_id, ancienne_centiemes, nouvelle_centiemes, motif, demandee_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            auth.cabinetId,
            collaborateur.id,
            d.date,
            missionId,
            caseTemps.tache_id,
            caseTemps.activite_id,
            ancienne,
            nouvelle,
            d.motif,
            auth.utilisateurId,
          ],
        ),
        { "*": "Une demande de correction est déjà en attente pour ce jour." },
      );
      const id = r.rows[0].id as string;
      await journal(db, auth, "demande", "correction_temps", id, {
        collaborateur_id: collaborateur.id,
        date: d.date,
        ancienne_valeur: jours(ancienne),
        nouvelle_valeur: jours(nouvelle),
        motif: d.motif,
      });
      return vueCorrection(await lireCorrection(db, id));
    });
    reply.status(201);
    return creee;
  });

  app.post("/temps/corrections/:id/valider", async (request) => {
    const auth = exiger(request, "temps.cloturer");
    const { id } = paramsId.parse(request.params);
    const { correction, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const k = await exigerCorrectionDecidable(db, auth, id);
      await collaborateurAffectable(db, k.collaborateur_id as string);
      const actuelle = await valeurEffective(db, k as unknown as Case);
      if (actuelle !== Number(k.ancienne_centiemes)) {
        throw conflit(
          "La valeur a changé depuis la demande : une nouvelle demande est nécessaire.",
        );
      }
      await db.query(
        `UPDATE corrections_temps SET statut = 'validee', decidee_par = $2, decidee_le = now()
         WHERE id = $1`,
        [id, auth.utilisateurId],
      );
      await journal(db, auth, "validation", "correction_temps", id, {
        collaborateur_id: k.collaborateur_id,
        date: k.date,
      });
      const creees: (NotificationCreee | null)[] = [];
      if (k.mission_id)
        creees.push(...(await evaluerAlertes(db, auth.cabinetId, k.mission_id as string)));
      creees.push(
        await notifier(db, {
          cabinetId: auth.cabinetId,
          destinataireId: k.demandee_par as string,
          type: "correction_temps_validee",
          titre: "Correction de temps validée",
          corps: `La correction du ${k.date as string} est validée.`,
          lien: "/temps/corrections",
        }),
      );
      return { correction: vueCorrection(await lireCorrection(db, id)), notifications: creees };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return correction;
  });

  app.post("/temps/corrections/:id/rejeter", async (request) => {
    const auth = exiger(request, "temps.cloturer");
    const { id } = paramsId.parse(request.params);
    const { motif } = correctionRejetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const k = await exigerCorrectionDecidable(db, auth, id);
      await db.query(
        `UPDATE corrections_temps SET statut = 'rejetee', decidee_par = $2, decidee_le = now(),
           motif_rejet = $3 WHERE id = $1`,
        [id, auth.utilisateurId, motif],
      );
      await journal(db, auth, "rejet", "correction_temps", id, { motif });
      await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: k.demandee_par as string,
        type: "correction_temps_rejetee",
        titre: "Correction de temps rejetée",
        corps: `La correction du ${k.date as string} est rejetée. Motif : ${motif}`,
        lien: "/temps/corrections",
      });
      return vueCorrection(await lireCorrection(db, id));
    });
  });
};

import type { FastifyPluginAsync } from "fastify";
import { ajouterJours, estDateSaisieModifiable } from "@missionpilot/engines";
import {
  aPermission,
  feuilleCreationSchema,
  feuilleLignesSchema,
  feuilleRejetSchema,
  feuillesListeQuerySchema,
  feuilleValidationSchema,
  semaineQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { estAssocie } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { collaborateurDe } from "../planification/outils.js";
import {
  appliquerControleCapacite,
  decisionsDuCycle,
  depassementsCapacite,
  exigerFeuilleModifiable,
  exigerFeuilleVisible,
  insererLignes,
  lignesDe,
  lignesPourControle,
  lignesPreRemplies,
  lireFeuille,
  peutDeciderPartie,
  preparerLignes,
  reverifierTaches,
  versLignesPreparees,
  vueFeuille,
  type FeuilleDb,
  type Partie,
} from "../temps/feuilles.js";
import {
  exigerDatesModifiables,
  lireParametresTemps,
  moisClotures,
  semaineDe,
  valideInterne,
  voitToutesLesFeuilles,
} from "../temps/outils.js";
import {
  cleIdempotence,
  empreinteSaisie,
  ENTETE_IDEMPOTENCE,
  reserverCleSaisie,
} from "../temps/idempotence.js";
import { evaluerAlertes } from "../temps/suivi.js";

async function journal(db: Db, auth: Auth, action: string, id: string, details: object) {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite: "feuille_temps",
    entiteId: id,
    details: details as Record<string, unknown>,
  });
}

const libelleSemaine = (f: Pick<FeuilleDb, "semaine">) => `semaine du ${f.semaine}`;

/**
 * Parties à décider : celle demandée (mission ou activités internes), sinon
 * toutes les parties en attente que l'utilisateur peut décider. 403 si
 * l'utilisateur ne peut en décider aucune (AUTO_VALIDATION pour l'auteur).
 */
async function partiesADecider(
  db: Db,
  auth: Auth,
  f: FeuilleDb,
  parties: Partie[],
  demande: { mission_id?: string | undefined; interne?: true | undefined },
): Promise<Partie[]> {
  if (f.statut !== "soumise") throw conflit("Seule une feuille soumise se valide ou se rejette.");
  if (f.auteur_id === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "AUTO_VALIDATION",
      "Vous ne pouvez pas valider ni rejeter votre propre feuille de temps.",
    );
  }
  const decisions = await decisionsDuCycle(db, f);
  const enAttente = parties.filter((p) => !decisions.some((d) => d.mission_id === p.mission_id));
  const precisee = demande.mission_id !== undefined || demande.interne === true;
  if (precisee) {
    const cible = enAttente.find((p) =>
      demande.interne ? p.mission_id === null : p.mission_id === demande.mission_id,
    );
    if (!cible) throw conflit("Cette partie de la feuille est absente ou déjà décidée.");
    if (!peutDeciderPartie(auth, f, cible)) throw interdit();
    return [cible];
  }
  const cibles = enAttente.filter((p) => peutDeciderPartie(auth, f, p));
  if (cibles.length === 0) throw interdit();
  return cibles;
}

export const routesFeuillesTemps: FastifyPluginAsync = async (app) => {
  /** Ma semaine : feuille éventuelle, pré-remplissage depuis les affectations, activités. */
  app.get("/feuilles-temps/semaine", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = semaineQuerySchema.parse(request.query);
    const semaine = semaineDe(q.semaine ?? aujourdhui());
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametresTemps(db, auth.cabinetId);
      const activites = await db.query(
        `SELECT id, code, libelle, est_absence FROM activites_internes WHERE actif
         ORDER BY libelle, id`,
      );
      const clotures = await moisClotures(db);
      const base = {
        semaine,
        unite_saisie_temps: p.granularite,
        heures_par_jour: p.heuresParJour,
        controle_capacite: p.controleCapacite,
        activites: activites.rows,
        jours_clotures: Array.from({ length: 7 }, (_, i) => ajouterJours(semaine.debut, i)).filter(
          (d) => !estDateSaisieModifiable(d, { moisClotures: clotures }),
        ),
      };
      const moi = await collaborateurDe(db, auth.utilisateurId);
      if (!moi) return { ...base, collaborateur: null, feuille: null, pre_remplissage: [] };
      const existante = await db.query(
        "SELECT id FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
        [moi.id, semaine.debut],
      );
      const id = existante.rows[0]?.id as string | undefined;
      const pre = await lignesPreRemplies(db, auth.cabinetId, moi.id, semaine, p);
      const libelles = await db.query(
        `SELECT t.id, t.libelle, m.intitule FROM mission_taches t JOIN missions m ON m.id = t.mission_id
         WHERE t.id = ANY ($1::uuid[])`,
        [[...new Set(pre.map((l) => l.tache_id))]],
      );
      const parTache = new Map(libelles.rows.map((t) => [t.id as string, t]));
      return {
        ...base,
        collaborateur: { id: moi.id, nom: moi.nom },
        feuille: id ? await vueFeuille(db, auth, await lireFeuille(db, id)) : null,
        pre_remplissage: pre.map((l) => ({
          ...l,
          tache_libelle: parTache.get(l.tache_id)?.libelle ?? null,
          mission_intitule: parTache.get(l.tache_id)?.intitule ?? null,
        })),
      };
    });
  });

  app.get("/feuilles-temps", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = feuillesListeQuerySchema.parse(request.query);
    if (q.vue !== "miennes" && !aPermission(auth.roles, "temps.valider")) throw interdit();
    const apres = decoderCurseur(q.curseur);
    const CLE = "lpad((date '9999-12-31' - f.semaine)::text, 8, '0')";
    const portee = {
      miennes: "f.auteur_id = $1",
      toutes: `(p.toutes OR EXISTS (SELECT 1 FROM lignes_temps l JOIN missions m ON m.id = l.mission_id
                 WHERE l.feuille_id = f.id AND (m.chef_id = $1 OR m.directeur_id = $1)))`,
      a_valider: `f.statut = 'soumise' AND (p.associe OR f.auteur_id IS DISTINCT FROM $1)
        AND EXISTS (SELECT 1 FROM lignes_temps l LEFT JOIN missions m ON m.id = l.mission_id
          WHERE l.feuille_id = f.id
            AND NOT EXISTS (SELECT 1 FROM feuille_validations v WHERE v.feuille_id = f.id
                            AND v.cycle = f.cycle AND v.mission_id IS NOT DISTINCT FROM l.mission_id)
            AND CASE WHEN l.mission_id IS NULL THEN p.interne
                     ELSE (p.associe OR m.chef_id = $1 OR m.directeur_id = $1) END)`,
    }[q.vue];
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT f.id, f.collaborateur_id, c.nom AS collaborateur_nom, f.auteur_id,
           f.semaine::text AS semaine, f.statut, f.origine, f.cycle, f.soumise_le, f.validee_le,
           f.rejetee_le, ${CLE} AS cle_tri
         FROM feuilles_temps f JOIN collaborateurs c ON c.id = f.collaborateur_id
         CROSS JOIN (SELECT $2::boolean AS toutes, $3::boolean AS associe, $4::boolean AS interne) p
         WHERE ${portee}
           AND ($5::text IS NULL OR f.statut = $5)
           AND ($6::uuid IS NULL OR f.collaborateur_id = $6)
           AND ($7::date IS NULL OR f.semaine = $7)
           AND ($8::text IS NULL OR (${CLE}, f.id) > ($8, $9::uuid))
         ORDER BY cle_tri, f.id
         LIMIT $10`,
        [
          auth.utilisateurId,
          voitToutesLesFeuilles(auth),
          estAssocie(auth),
          valideInterne(auth),
          q.statut ?? null,
          q.collaborateur_id ?? null,
          q.semaine ? semaineDe(q.semaine).debut : null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows, q.limite);
    });
  });

  app.post("/feuilles-temps", async (request, reply) => {
    const auth = exiger(request, "temps.saisir");
    const d = feuilleCreationSchema.parse(request.body);
    const semaine = semaineDe(d.semaine);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const moi = await collaborateurDe(db, auth.utilisateurId);
      if (!moi) throw conflit("Aucun collaborateur actif n'est rattaché à votre compte.");
      await db.query("SELECT 1 FROM collaborateurs WHERE id = $1 FOR UPDATE", [moi.id]);
      const existe = await db.query(
        "SELECT 1 FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
        [moi.id, semaine.debut],
      );
      if (existe.rowCount) throw conflit("Une feuille de temps existe déjà pour cette semaine.");
      const r = await db.query(
        `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [auth.cabinetId, moi.id, auth.utilisateurId, semaine.debut],
      );
      const id = r.rows[0].id as string;
      let preRemplies = 0;
      if (d.pre_remplir) {
        const p = await lireParametresTemps(db, auth.cabinetId);
        const clotures = await moisClotures(db);
        const lignes = versLignesPreparees(
          await lignesPreRemplies(db, auth.cabinetId, moi.id, semaine, p),
          p,
        ).filter((l) => estDateSaisieModifiable(l.date, { moisClotures: clotures }));
        await insererLignes(db, auth.cabinetId, id, lignes);
        preRemplies = lignes.length;
      }
      await journal(db, auth, "creation", id, {
        semaine: semaine.debut,
        lignes_pre_remplies: preRemplies,
      });
      return vueFeuille(db, auth, await lireFeuille(db, id));
    });
    reply.status(201);
    return creee;
  });

  app.get("/feuilles-temps/:id", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { feuille } = await exigerFeuilleVisible(db, auth, id);
      return vueFeuille(db, auth, feuille);
    });
  });

  /** Remplace les lignes d'une feuille en brouillon ou rejetée (TPS-01, TPS-02). */
  app.put("/feuilles-temps/:id/lignes", async (request, reply) => {
    const auth = exiger(request, "temps.saisir");
    const { id } = paramsId.parse(request.params);
    const { lignes: saisies } = feuilleLignesSchema.parse(request.body);
    const cle = cleIdempotence(request.headers[ENTETE_IDEMPOTENCE]);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      if (cle !== undefined) {
        // Rejeu d'une saisie déjà appliquée (file hors ligne) : rien n'est ré-appliqué.
        const { feuille } = await exigerFeuilleVisible(db, auth, id, true);
        if (!(await reserverCleSaisie(db, auth, cle, id, empreinteSaisie(saisies)))) {
          reply.header("Idempotency-Replayed", "true");
          return vueFeuille(db, auth, feuille);
        }
      }
      const f = await exigerFeuilleModifiable(db, auth, id);
      const p = await lireParametresTemps(db, auth.cabinetId);
      const lignes = await preparerLignes(db, f, saisies, p);
      const avertissements = appliquerControleCapacite(
        await depassementsCapacite(
          db,
          auth.cabinetId,
          f.collaborateur_id,
          semaineDe(f.semaine),
          lignes,
          p,
        ),
        p,
      );
      await db.query("DELETE FROM lignes_temps WHERE feuille_id = $1", [id]);
      await insererLignes(db, auth.cabinetId, id, lignes);
      await db.query("UPDATE feuilles_temps SET modifie_le = now() WHERE id = $1", [id]);
      await journal(db, auth, "saisie", id, { lignes: lignes.length });
      return vueFeuille(db, auth, await lireFeuille(db, id), avertissements);
    });
  });

  app.post("/feuilles-temps/:id/soumettre", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const { id } = paramsId.parse(request.params);
    const { feuille, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const f = await exigerFeuilleModifiable(db, auth, id);
      const p = await lireParametresTemps(db, auth.cabinetId);
      const lignes = await lignesPourControle(db, id);
      if (lignes.length === 0) throw requeteInvalide("Une feuille de temps vide ne se soumet pas.");
      await reverifierTaches(db, f, lignes);
      exigerDatesModifiables(
        lignes.map((l) => l.date),
        await moisClotures(db),
      );
      const avertissements = appliquerControleCapacite(
        await depassementsCapacite(
          db,
          auth.cabinetId,
          f.collaborateur_id,
          semaineDe(f.semaine),
          lignes,
          p,
        ),
        p,
      );
      await db.query(
        `UPDATE feuilles_temps SET statut = 'soumise', cycle = cycle + 1, soumise_le = now(),
           premiere_soumission_le = coalesce(premiere_soumission_le, now()), modifie_le = now()
         WHERE id = $1`,
        [id],
      );
      await journal(db, auth, "soumission", id, { cycle: f.cycle + 1 });
      // Les valideurs de chaque mission (chef, à défaut directeur) sont prévenus.
      const valideurs = await db.query(
        `SELECT DISTINCT coalesce(m.chef_id, m.directeur_id) AS valideur
         FROM lignes_temps l JOIN missions m ON m.id = l.mission_id
         WHERE l.feuille_id = $1 AND coalesce(m.chef_id, m.directeur_id) IS NOT NULL`,
        [id],
      );
      const creees: (NotificationCreee | null)[] = [];
      for (const v of valideurs.rows) {
        if (v.valideur === auth.utilisateurId) continue;
        creees.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: v.valideur as string,
            type: "feuille_temps_soumise",
            titre: `Feuille de temps à valider : ${f.collaborateur_nom}`,
            corps: `${f.collaborateur_nom} a soumis sa feuille de la ${libelleSemaine(f)}.`,
            lien: `/temps/validation`,
          }),
        );
      }
      return {
        feuille: await vueFeuille(db, auth, await lireFeuille(db, id), avertissements),
        notifications: creees,
      };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return feuille;
  });

  app.post("/feuilles-temps/:id/valider", async (request) => {
    const auth = exiger(request, "temps.valider");
    const { id } = paramsId.parse(request.params);
    const demande = feuilleValidationSchema.parse(request.body ?? {});
    const { feuille, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { feuille: f, parties } = await exigerFeuilleVisible(db, auth, id, true);
      const cibles = await partiesADecider(db, auth, f, parties, demande);
      const ids = new Set(cibles.map((c) => c.mission_id));
      const lignes = (await lignesDe(db, id)).filter((l) => ids.has(l.mission_id));
      exigerDatesModifiables(
        lignes.map((l) => l.date),
        await moisClotures(db),
      );
      for (const c of cibles) {
        await db.query(
          `INSERT INTO feuille_validations (cabinet_id, feuille_id, cycle, mission_id, decision, decide_par)
           VALUES ($1, $2, $3, $4, 'validee', $5)`,
          [auth.cabinetId, id, f.cycle, c.mission_id, auth.utilisateurId],
        );
      }
      const decisions = await decisionsDuCycle(db, f);
      const complete = parties.every((p) => decisions.some((d) => d.mission_id === p.mission_id));
      const creees: (NotificationCreee | null)[] = [];
      if (complete) {
        await db.query(
          "UPDATE feuilles_temps SET statut = 'validee', validee_le = now(), modifie_le = now() WHERE id = $1",
          [id],
        );
        if (f.auteur_id) {
          creees.push(
            await notifier(db, {
              cabinetId: auth.cabinetId,
              destinataireId: f.auteur_id,
              type: "feuille_temps_validee",
              titre: "Feuille de temps validée",
              corps: `Votre feuille de la ${libelleSemaine(f)} est validée.`,
              lien: `/temps?semaine=${f.semaine}`,
            }),
          );
        }
        // Seuls les temps validés comptent : les alertes sont évaluées maintenant.
        for (const p of parties) {
          if (p.mission_id)
            creees.push(...(await evaluerAlertes(db, auth.cabinetId, p.mission_id)));
        }
      }
      await journal(db, auth, "validation", id, {
        cycle: f.cycle,
        parties: cibles.map((c) => c.mission_id ?? "interne"),
        feuille_validee: complete,
      });
      return {
        feuille: await vueFeuille(db, auth, await lireFeuille(db, id)),
        notifications: creees,
      };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return feuille;
  });

  app.post("/feuilles-temps/:id/rejeter", async (request) => {
    const auth = exiger(request, "temps.valider");
    const { id } = paramsId.parse(request.params);
    const { motif, ...demande } = feuilleRejetSchema.parse(request.body);
    const { feuille, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { feuille: f, parties } = await exigerFeuilleVisible(db, auth, id, true);
      const cibles = await partiesADecider(db, auth, f, parties, demande);
      for (const c of cibles) {
        await db.query(
          `INSERT INTO feuille_validations (cabinet_id, feuille_id, cycle, mission_id, decision, motif,
             decide_par)
           VALUES ($1, $2, $3, $4, 'rejetee', $5, $6)`,
          [auth.cabinetId, id, f.cycle, c.mission_id, motif, auth.utilisateurId],
        );
      }
      await db.query(
        `UPDATE feuilles_temps SET statut = 'rejetee', motif_rejet = $2, rejetee_par = $3,
           rejetee_le = now(), modifie_le = now()
         WHERE id = $1`,
        [id, motif, auth.utilisateurId],
      );
      await journal(db, auth, "rejet", id, {
        cycle: f.cycle,
        parties: cibles.map((c) => c.mission_id ?? "interne"),
        motif,
      });
      const creees: (NotificationCreee | null)[] = [];
      if (f.auteur_id) {
        creees.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: f.auteur_id,
            type: "feuille_temps_rejetee",
            titre: "Feuille de temps rejetée",
            corps: `Votre feuille de la ${libelleSemaine(f)} est rejetée. Motif : ${motif}`,
            lien: `/temps?semaine=${f.semaine}`,
            email: true,
          }),
        );
      }
      return {
        feuille: await vueFeuille(db, auth, await lireFeuille(db, id)),
        notifications: creees,
      };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return feuille;
  });
};

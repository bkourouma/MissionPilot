/*
 * VISIBILITÉ DU PIPELINE (choix assumé) : toute personne ayant
 * « pipeline.gerer » (associé, directeur de mission, chef de mission) lit
 * toutes les opportunités du cabinet et leurs montants estimés, quel qu'en
 * soit le responsable. Le pipeline est un outil commercial partagé ; les
 * données financières internes (coûts, grilles de taux, marges) n'y figurent
 * pas. L'isolation entre cabinets reste assurée par RLS.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  appliquerPourcentage,
  montant as montantMoteur,
  sommer,
  type Devise,
} from "@missionpilot/engines";
import {
  ETAPES_OPPORTUNITE,
  listeLargeCurseurSchema,
  listeLargeLimiteSchema,
  opportuniteCreationSchema,
  opportuniteEtapeSchema,
  opportuniteIssueSchema,
  opportuniteModificationSchema,
  STATUTS_OPPORTUNITE,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, montant, traduireErreursPg } from "../db/outils.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";
import { paginer, paramsId } from "../http/outils.js";
import { cleTriCreation, decoderCurseurCreation, type CleTri } from "./missions.js";

const COLONNES = `o.id, o.client_id, cl.raison_sociale AS client_raison_sociale, o.intitule,
  o.type_mission_id, o.montant_estime, o.devise, o.probabilite, o.etape, o.statut, o.motif_perte,
  o.responsable_id, o.date_cloture_prevue::text AS date_cloture_prevue, o.cloturee_le, o.cree_par,
  o.cree_le, o.modifie_le`;
const DEPUIS = "opportunites o JOIN clients cl ON cl.id = o.client_id";
const CHAMPS = [
  "client_id",
  "intitule",
  "type_mission_id",
  "probabilite",
  "etape",
  "statut",
  "responsable_id",
  "date_cloture_prevue",
] as const;
const REFERENCE = "Client, type de mission ou responsable inconnu dans ce cabinet.";

const listeQuery = z
  .object({
    statut: z.enum(STATUTS_OPPORTUNITE).optional(),
    etape: z.enum(ETAPES_OPPORTUNITE).optional(),
    client_id: z.string().uuid().optional(),
    limite: listeLargeLimiteSchema,
    curseur: listeLargeCurseurSchema,
  })
  .strict();

const enMontant = (o: Record<string, unknown>) => ({
  ...o,
  montant_estime: montant(o.montant_estime),
});

async function exigerOpportunite(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE o.id = $1 ${verrouiller ? "FOR UPDATE OF o" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Opportunité");
  return enMontant(r.rows[0]);
}

/** Le responsable d'une opportunité est un utilisateur actif du cabinet. */
async function verifierResponsable(db: Db, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const r = await db.query("SELECT 1 FROM utilisateurs WHERE id = $1 AND actif", [id]);
  if (!r.rowCount) throw requeteInvalide("Responsable : utilisateur inconnu ou inactif.");
}

/**
 * Agrégat du pipeline (MIS-04) par étape et par devise : montant estimé et
 * montant pondéré par la probabilité, calculés par le moteur finance.
 */
export function agregerPipeline(
  opportunites: { etape: string; devise: Devise; montant_estime: number; probabilite: number }[],
) {
  const groupes = new Map<string, typeof opportunites>();
  for (const o of opportunites) {
    const cle = `${o.etape}|${o.devise}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), o]);
  }
  const lignes = [...groupes.values()].map((liste) => {
    const { etape, devise } = liste[0] as (typeof opportunites)[number];
    return {
      etape,
      devise,
      nombre: liste.length,
      montant_estime: sommer(
        liste.map((o) => montantMoteur(o.montant_estime, devise)),
        devise,
      ).valeur,
      montant_pondere: sommer(
        liste.map((o) =>
          appliquerPourcentage(montantMoteur(o.montant_estime, devise), o.probabilite),
        ),
        devise,
      ).valeur,
    };
  });
  const ordre = (e: string) => ETAPES_OPPORTUNITE.indexOf(e as (typeof ETAPES_OPPORTUNITE)[number]);
  lignes.sort((a, b) => ordre(a.etape) - ordre(b.etape) || a.devise.localeCompare(b.devise));
  const devises = [...new Set(lignes.map((l) => l.devise))].sort();
  const totaux = devises.map((devise) => {
    const d = lignes.filter((l) => l.devise === devise);
    return {
      devise,
      nombre: d.reduce((n, l) => n + l.nombre, 0),
      montant_estime: sommer(
        d.map((l) => montantMoteur(l.montant_estime, devise)),
        devise,
      ).valeur,
      montant_pondere: sommer(
        d.map((l) => montantMoteur(l.montant_pondere, devise)),
        devise,
      ).valeur,
    };
  });
  return { par_etape: lignes, totaux };
}

/** Pipeline commercial : opportunités (MIS-04). Tout passe par « pipeline.gerer ». */
export const routesOpportunites: FastifyPluginAsync = async (app) => {
  app.get("/opportunites", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const q = listeQuery.parse(request.query);
    const apres = decoderCurseurCreation(q.curseur);
    // Pagination par curseur (plus récentes d'abord) : clé (date de création, id), stable,
    // servie par l'index (cabinet_id, cree_le DESC, id DESC) ; voir routes/missions.ts.
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES}, ${cleTriCreation("o")} AS cle_tri FROM ${DEPUIS}
         WHERE ($1::text IS NULL OR o.statut = $1) AND ($2::text IS NULL OR o.etape = $2)
           AND ($3::uuid IS NULL OR o.client_id = $3)
           AND ($4::timestamptz IS NULL OR (o.cree_le, o.id) < ($4::timestamptz, $5::uuid))
         ORDER BY o.cree_le DESC, o.id DESC LIMIT $6`,
        [
          q.statut ?? null,
          q.etape ?? null,
          q.client_id ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows as (Record<string, unknown> & CleTri)[], q.limite);
      return { elements: page.elements.map(enMontant), suivant: page.curseur_suivant };
    });
  });

  app.get("/opportunites/pipeline", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const ouvertes = await db.query(
        `SELECT etape, devise, montant_estime, probabilite FROM opportunites WHERE statut = 'ouverte'`,
      );
      const issues = await db.query(
        `SELECT statut, count(*)::int AS nombre FROM opportunites
         WHERE statut <> 'ouverte' GROUP BY statut`,
      );
      return {
        ...agregerPipeline(
          ouvertes.rows.map((o) => ({ ...o, montant_estime: Number(o.montant_estime) })),
        ),
        gagnees: issues.rows.find((i) => i.statut === "gagnee")?.nombre ?? 0,
        perdues: issues.rows.find((i) => i.statut === "perdue")?.nombre ?? 0,
      };
    });
  });

  app.get("/opportunites/:id", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => exigerOpportunite(db, id));
  });

  app.post("/opportunites", async (request, reply) => {
    const auth = exiger(request, "pipeline.gerer");
    const o = opportuniteCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await verifierResponsable(db, o.responsable_id);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO opportunites (cabinet_id, client_id, intitule, type_mission_id, montant_estime,
             devise, probabilite, etape, responsable_id, date_cloture_prevue, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            auth.cabinetId,
            o.client_id,
            o.intitule,
            o.type_mission_id,
            o.montant_estime,
            o.devise,
            o.probabilite,
            o.etape,
            o.responsable_id,
            o.date_cloture_prevue,
            auth.utilisateurId,
          ],
        ),
        {},
        REFERENCE,
      );
      const lue = await exigerOpportunite(db, r.rows[0].id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "opportunite",
        entiteId: lue.id as string,
        details: { apres: choisir(lue, CHAMPS) },
      });
      return lue;
    });
    reply.status(201);
    return cree;
  });

  app.patch("/opportunites/:id", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const modif = opportuniteModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerOpportunite(db, id, true);
      if (avant.statut !== "ouverte") throw conflit("Une opportunité close ne se modifie plus.");
      await verifierResponsable(db, modif.responsable_id);
      if (modif.client_id !== undefined && modif.client_id !== avant.client_id) {
        // Une proposition validée ou envoyée engage le cabinet envers CE client.
        const engagee = await db.query(
          `SELECT 1 FROM propositions WHERE opportunite_id = $1
             AND statut IN ('validee', 'envoyee', 'acceptee', 'refusee') LIMIT 1`,
          [id],
        );
        if (engagee.rowCount) {
          throw conflit("Une proposition a été validée ou envoyée : le client ne change plus.");
        }
      }
      const set = clauseSet(modif, 2);
      await traduireErreursPg(
        db.query(`UPDATE opportunites SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
          id,
          ...set.valeurs,
        ]),
        {},
        REFERENCE,
      );
      const apres = await exigerOpportunite(db, id);
      const champs = Object.keys(modif).filter((c) => c !== "montant_estime");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "opportunite",
        entiteId: id,
        details: {
          avant: choisir(avant, champs),
          apres: choisir(apres, champs),
          ...("montant_estime" in modif ? { montant_modifie: true } : {}),
        },
      });
      return apres;
    });
  });

  app.post("/opportunites/:id/etape", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const { etape } = opportuniteEtapeSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerOpportunite(db, id, true);
      if (avant.statut !== "ouverte")
        throw conflit("Une opportunité close ne change plus d'étape.");
      await db.query("UPDATE opportunites SET etape = $2, modifie_le = now() WHERE id = $1", [
        id,
        etape,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "changement_etape",
        entite: "opportunite",
        entiteId: id,
        details: { avant: avant.etape, apres: etape },
      });
      return exigerOpportunite(db, id);
    });
  });

  app.post("/opportunites/:id/issue", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const issue = opportuniteIssueSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerOpportunite(db, id, true);
      if (avant.statut !== "ouverte") throw conflit("Cette opportunité est déjà close.");
      await db.query(
        `UPDATE opportunites SET statut = $2, motif_perte = $3, cloturee_le = now(),
           probabilite = CASE WHEN $2 = 'gagnee' THEN 100 ELSE 0 END, modifie_le = now()
         WHERE id = $1`,
        [id, issue.statut, issue.statut === "perdue" ? issue.motif_perte : null],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: issue.statut === "gagnee" ? "gain" : "perte",
        entite: "opportunite",
        entiteId: id,
        details: issue.statut === "perdue" ? { motif_perte: issue.motif_perte } : {},
      });
      return exigerOpportunite(db, id);
    });
  });

  app.delete("/opportunites/:id", async (request, reply) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerOpportunite(db, id, true);
      const liee = await db.query(
        `SELECT 1 FROM propositions WHERE opportunite_id = $1
         UNION ALL SELECT 1 FROM missions WHERE opportunite_id = $1 LIMIT 1`,
        [id],
      );
      if (liee.rowCount) {
        throw conflit("Cette opportunité a des propositions ou une mission : la clore plutôt.");
      }
      await db.query("DELETE FROM opportunites WHERE id = $1", [id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "opportunite",
        entiteId: id,
        details: { avant: choisir(avant, CHAMPS) },
      });
    });
    return reply.status(204).send();
  });
};

import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { chronologieCommerciale } from "./chronologie.js";
import type { MissionBatie } from "./construction.js";
import { transactionAntidatage } from "./declencheurs.js";
import type { DocumentDepose } from "./suivi.js";

/*
 * Antidatage d'une mission du casting. Les routes créent tout « maintenant » ; or le cabinet doit
 * montrer une histoire de deux ans. Chaque ligne est remontée à sa date fictive par du SQL du rôle
 * PROPRIÉTAIRE, avec des requêtes littérales (aucun nom de table interpolé).
 *
 * Les déclencheurs d'immuabilité qui protègent des lignes figées (proposition validée, version de
 * budget figée, document validé, notes et vérifications en ajout seul) sont levés le temps
 * strictement nécessaire par `transactionAntidatage` (declencheurs.ts), jamais pour du contenu.
 */

const midi = (date: string): string => `${date}T12:00:00Z`;

/** Fenêtre d'horloge RÉELLE (base de données) pendant laquelle une étape a écrit ses lignes. */
export interface FenetreReelle {
  debut: Date;
  fin: Date;
}

/** Instant courant de la base (horloge réelle) : borne d'une fenêtre d'étape, jamais une donnée métier. */
export async function maintenantBase(ctx: ContexteTenantDemo): Promise<Date> {
  const r = await ctx.proprietaire.query("SELECT clock_timestamp() AS t");
  return r.rows[0].t as Date;
}

/**
 * Étale les lignes du journal d'audit écrites pendant `fenetre` sur la période fictive
 * [`debut`, `fin`], dans leur ordre d'écriture (l'histoire reste chronologique). Les marqueurs
 * de reprise du seed ne sont pas touchés.
 */
export async function etalerJournal(
  ctx: ContexteTenantDemo,
  fenetre: FenetreReelle,
  debut: string,
  fin: string,
): Promise<void> {
  await ctx.proprietaire.query(
    `UPDATE journal_audit j
        SET cree_le = $2::timestamptz + ($3::timestamptz - $2::timestamptz) * (r.rang::float8 / r.total)
       FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1) AS rang, count(*) OVER () AS total
               FROM journal_audit
              WHERE cabinet_id = $1 AND cree_le >= $4 AND cree_le <= $5
                AND action NOT LIKE 'semis_tenant_demo%') r
      WHERE j.id = r.id`,
    [ctx.cabinetId, midi(debut), midi(fin), fenetre.debut, fenetre.fin],
  );
}

export async function antidaterMission(
  ctx: ContexteTenantDemo,
  m: MissionBatie,
  documents: readonly DocumentDepose[],
  versionRevisee: string | null,
  fenetre: FenetreReelle,
): Promise<void> {
  const def = m.def;
  const ch = chronologieCommerciale(def);
  const opp = midi(ch.opportunite);
  const missionCree = midi(ch.mission);
  const signature = def.signature ? midi(def.signature) : missionCree;
  const equipeLe = midi(ajouterJours(def.signature ?? ch.repondue, 1));
  const derniere = midi(
    def.etat === "terminee"
      ? def.fin
      : def.etat === "en_cours"
        ? ctx.jour(-3)
        : signature.slice(0, 10),
  );
  const rev = def.revision;
  const jourRev = (n: number): string => midi(ajouterJours(rev?.date ?? def.debut, n));

  await transactionAntidatage(ctx.proprietaire, {
    tables: [
      "budget_versions",
      "cloture_verifications",
      "mission_documents",
      "propositions",
      "qualite_satisfactions",
    ],
    avant: async (c) => {
      await c.query(
        "UPDATE opportunites SET cree_le = $2, modifie_le = $3, cloturee_le = $3 WHERE id = $1",
        [m.opportuniteId, opp, midi(ch.repondue)],
      );
      await c.query("UPDATE missions SET cree_le = $2, modifie_le = $3 WHERE id = $1", [
        m.id,
        missionCree,
        derniere,
      ]);
      await c.query(
        "UPDATE mission_phases SET cree_le = $2, modifie_le = $2 WHERE mission_id = $1",
        [m.id, missionCree],
      );
      await c.query("UPDATE mission_lots SET cree_le = $2, modifie_le = $2 WHERE mission_id = $1", [
        m.id,
        missionCree,
      ]);
      await c.query(
        "UPDATE mission_taches SET cree_le = $2, modifie_le = $2 WHERE mission_id = $1",
        [m.id, missionCree],
      );
      await c.query(
        "UPDATE mission_jalons SET cree_le = $2, modifie_le = $2 WHERE mission_id = $1",
        [m.id, missionCree],
      );
      await c.query("UPDATE mission_dependances SET cree_le = $2 WHERE mission_id = $1", [
        m.id,
        missionCree,
      ]);
      await c.query("UPDATE mission_equipe SET ajoute_le = $2 WHERE mission_id = $1", [
        m.id,
        equipeLe,
      ]);
      await c.query("UPDATE affectations SET cree_le = $2, modifie_le = $2 WHERE mission_id = $1", [
        m.id,
        equipeLe,
      ]);
      if (rev) {
        await c.query(
          "UPDATE mission_taches SET cree_le = $3 WHERE mission_id = $1 AND libelle = $2",
          [m.id, rev.tache.libelle, jourRev(-5)],
        );
        await c.query(
          `UPDATE affectations SET cree_le = $3, modifie_le = $3
           WHERE mission_id = $1 AND tache_id IN
             (SELECT id FROM mission_taches WHERE mission_id = $1 AND libelle = $2)`,
          [m.id, rev.tache.libelle, jourRev(1)],
        );
      }
      for (const d of documents) {
        // Fichier PDF du document (téléversé « maintenant ») : daté du dépôt du document.
        await c.query(
          `UPDATE fichiers SET cree_le = $2::timestamptz
            WHERE cabinet_id = $3 AND id = (SELECT fichier_id FROM mission_documents
                                             WHERE id = $1 AND cabinet_id = $3)`,
          [d.id, midi(d.date), ctx.cabinetId],
        );
        await c.query(
          `UPDATE mission_document_statuts SET cree_le = CASE statut
               WHEN 'valide' THEN $3::timestamptz WHEN 'modifie' THEN $4::timestamptz
               ELSE $2::timestamptz END
           WHERE document_id = $1`,
          [d.id, midi(d.date), midi(ajouterJours(d.date, 3)), midi(ajouterJours(d.date, 1))],
        );
      }
    },
    pendant: async (c) => {
      await c.query(
        `UPDATE propositions SET cree_le = $2, validee_le = $3, envoyee_le = $4, repondue_le = $5,
           modifie_le = $5 WHERE id = $1`,
        [
          m.propositionId,
          midi(ch.proposition),
          midi(ch.validee),
          midi(ch.envoyee),
          midi(ch.repondue),
        ],
      );
      if (def.signature) {
        await c.query(
          `UPDATE budget_versions SET cree_le = $2, validee_le = $2
           WHERE mission_id = $1 AND numero = 1`,
          [m.id, signature],
        );
        await c.query(
          `UPDATE mission_documents SET cree_le = $2
           WHERE mission_id = $1 AND type = 'lettre_de_mission'`,
          [m.id, signature],
        );
      }
      if (rev && versionRevisee) {
        await c.query(
          `UPDATE budget_versions SET cree_le = $2, validee_le = $3, date_figeage = $4::date
           WHERE id = $1`,
          [versionRevisee, jourRev(-5), midi(rev.date), rev.date],
        );
      }
      for (const d of documents) {
        await c.query(
          `UPDATE mission_documents SET cree_le = $2,
             valide_le = CASE WHEN valide_le IS NULL THEN NULL ELSE $3::timestamptz END
           WHERE id = $1`,
          [d.id, midi(d.date), midi(ajouterJours(d.date, 3))],
        );
      }
      if (def.etat === "terminee") {
        await c.query("UPDATE qualite_satisfactions SET saisi_le = $2 WHERE mission_id = $1", [
          m.id,
          midi(def.fin),
        ]);
        await c.query("UPDATE cloture_verifications SET verifie_le = $2 WHERE mission_id = $1", [
          m.id,
          midi(def.fin),
        ]);
      }
    },
  });
  await etalerJournal(ctx, fenetre, def.opp, derniere.slice(0, 10));
}

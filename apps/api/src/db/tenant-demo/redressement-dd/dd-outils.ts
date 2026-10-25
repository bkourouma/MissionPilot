import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { attendre, midi } from "./commun.js";

/*
 * Outils de la première moitié de la due diligence du Tenant démo (dossiers et analyses) :
 *
 * - `ecrire` / `lire` : appel d'une VRAIE route avec le code HTTP attendu, corps JSON typé ;
 * - `Datation` : antidatage par requêtes LITTÉRALES (noms de table écrits en dur) des lignes en
 *   ajout seul que les routes horodatent « maintenant ». Principe : un MARQUEUR (heure de la base)
 *   est relevé avant une série d'appels ; `dater` remonte à un jour donné toutes les lignes créées
 *   depuis ce marqueur dans le périmètre (dossier et/ou mission), puis relève un nouveau marqueur.
 *   Les lignes déjà antidatées sont antérieures au marqueur (toutes les dates du semis sont dans
 *   le passé de l'horloge réelle), donc jamais reprises. Les requêtes passent par la session du
 *   propriétaire avec `session_replication_role = replica` (comme `appliquerSql` de commun.ts) :
 *   RÉSERVÉ à `cree_le`, `proposee_le` et `valide_le`.
 */

export type Corps = Record<string, unknown>;

/** Écrit par une route (HTTP 201 attendu) et renvoie la réponse JSON. */
export async function ecrire<T = Record<string, unknown>>(
  session: SessionDemo,
  url: string,
  corps: unknown,
  quoi: string,
): Promise<T> {
  const r = await session.post(url, corps);
  attendre(201, r, quoi);
  return r.json() as T;
}

/** Lit par une route (HTTP 200 attendu) et renvoie la réponse JSON. */
export async function lire<T = Record<string, unknown>>(
  session: SessionDemo,
  url: string,
  quoi: string,
): Promise<T> {
  const r = await session.get(url);
  attendre(200, r, quoi);
  return r.json() as T;
}

export interface Portee {
  dossierId?: string;
  missionId?: string;
}

export class Datation {
  private marqueur = "";

  constructor(
    private readonly ctx: ContexteTenantDemo,
    /** Jour 0 des décalages `quand(j)` (ISO). */
    readonly debut: string,
  ) {}

  /** Date ISO située `j` jours après le jour 0. */
  jourIso(j: number): string {
    return ajouterJours(this.debut, j);
  }

  /** Relève le marqueur : à appeler avant une série d'appels à dater. */
  async relever(): Promise<void> {
    const r = await this.ctx.proprietaire.query("SELECT clock_timestamp()::text AS t");
    this.marqueur = (r.rows[0] as { t: string }).t;
  }

  /** Remonte au jour ISO donné les lignes `dd_*` (et assertions) créées depuis le marqueur. */
  async dater(jourIso: string, portee: Portee): Promise<void> {
    const t = midi(jourIso);
    const c = this.ctx.proprietaire;
    const d = portee.dossierId ?? null;
    const m = portee.missionId ?? null;
    const m3 = this.marqueur;
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      if (d !== null) {
        const p = [t, d, m3];
        await c.query(
          "UPDATE dd_dossiers SET cree_le = $1::timestamptz WHERE id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          "UPDATE dd_cadrage_versions SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          "UPDATE dd_elements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          `UPDATE dd_element_versions SET cree_le = $1::timestamptz
            WHERE element_id IN (SELECT id FROM dd_elements WHERE dossier_id = $2)
              AND cree_le >= $3::timestamptz`,
          p,
        );
        await c.query(
          "UPDATE dd_signal_constats SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          "UPDATE dd_hypothese_liens SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          "UPDATE dd_verdicts SET proposee_le = $1::timestamptz WHERE dossier_id = $2 AND proposee_le >= $3::timestamptz",
          p,
        );
        await c.query(
          `UPDATE dd_verdict_validations SET valide_le = $1::timestamptz
            WHERE verdict_id IN (SELECT id FROM dd_verdicts WHERE dossier_id = $2)
              AND valide_le >= $3::timestamptz`,
          p,
        );
        await c.query(
          "UPDATE dd_dimensionnements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          `UPDATE dd_dimensionnement_versions SET cree_le = $1::timestamptz
            WHERE dimensionnement_id IN (SELECT id FROM dd_dimensionnements WHERE dossier_id = $2)
              AND cree_le >= $3::timestamptz`,
          p,
        );
        await c.query(
          "UPDATE dd_filtrages SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          `UPDATE dd_filtrage_decisions SET cree_le = $1::timestamptz
            WHERE filtrage_id IN (SELECT id FROM dd_filtrages WHERE dossier_id = $2)
              AND cree_le >= $3::timestamptz`,
          p,
        );
        await c.query(
          "UPDATE dd_ajustements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
      }
      if (m !== null) {
        const p = [t, m, m3];
        await c.query(
          "UPDATE assertions SET cree_le = $1::timestamptz WHERE mission_id = $2 AND cree_le >= $3::timestamptz",
          p,
        );
        await c.query(
          `UPDATE assertion_versions SET cree_le = $1::timestamptz
            WHERE assertion_id IN (SELECT id FROM assertions WHERE mission_id = $2)
              AND cree_le >= $3::timestamptz`,
          p,
        );
        await c.query(
          `UPDATE assertion_preuve_liens SET cree_le = $1::timestamptz
            WHERE assertion_id IN (SELECT id FROM assertions WHERE mission_id = $2)
              AND cree_le >= $3::timestamptz`,
          p,
        );
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    await this.relever();
  }

  /** Remonte au jour ISO donné les lignes du référentiel du cabinet créées depuis le marqueur. */
  async daterReferentiel(jourIso: string): Promise<void> {
    const p = [midi(jourIso), this.marqueur];
    const c = this.ctx.proprietaire;
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        "UPDATE dd_signaux SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query(
        "UPDATE dd_signal_versions SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query(
        "UPDATE dd_exclusion_listes SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query(
        "UPDATE dd_exclusion_liste_versions SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query(
        "UPDATE dd_modeles_secteur SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query(
        "UPDATE dd_modele_secteur_versions SET cree_le = $1::timestamptz WHERE cree_le >= $2::timestamptz",
        p,
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    await this.relever();
  }
}

import { ajouterJours } from "@missionpilot/engines";
import type { Auth } from "../src/auth/contexte.js";
import { emettre, lireFacture } from "../src/facturation/factures.js";
import { attendre, type CabinetFacturation } from "./facturation-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";

/*
 * Outils des tests de la finance (encaissements, relances, rentabilité,
 * indicateurs). Les factures passent par le circuit réel (brouillon, soumission,
 * approbation) ; seule l'émission est appelée en direct pour la DATER dans le
 * passé (même fonction que la route, paramètre réservé au seed et aux tests).
 */

export const acteur = (
  cabinetId: string,
  utilisateurId: string,
  role: Auth["roles"][number],
): Auth => ({
  cabinetId,
  utilisateurId,
  email: "",
  nom: "",
  roles: [role],
});

/** Soumet (gestionnaire), approuve (associé) puis émet à la date donnée. */
export async function emettreLe(
  ctx: Contexte,
  c: CabinetFacturation,
  factureId: string,
  date: string,
): Promise<Record<string, unknown>> {
  attendre(200, await c.gestionnaire.post(`/api/factures/${factureId}/soumettre`), "soumission");
  attendre(200, await c.associe.post(`/api/factures/${factureId}/approuver`), "approbation");
  await ctx.db.withTenant(c.cabinetId, async (db) =>
    emettre(
      db,
      acteur(c.cabinetId, c.gestionnaire.utilisateurId, "gestionnaire"),
      await lireFacture(db, factureId, true),
      date,
    ),
  );
  return (await c.gestionnaire.get(`/api/factures/${factureId}`)).json();
}

/** Échéance « à facturer » d'un montant donné, puis facture émise à une date. */
export async function factureDatee(
  ctx: Contexte,
  c: CabinetFacturation,
  missionId: string,
  montant: number,
  date: string,
): Promise<Record<string, unknown> & { id: string; net_a_payer: number; numero: string }> {
  const e = await c.gestionnaire.post(`/api/missions/${missionId}/echeances`, {
    type: "jalon",
    libelle: `Jalon ${montant}`,
    montant,
    date_prevue: date,
  });
  attendre(201, e, "échéance");
  attendre(
    200,
    await c.gestionnaire.patch(`/api/echeances/${e.json().id}`, { statut: "a_facturer" }),
    "à facturer",
  );
  const f = await c.gestionnaire.post(`/api/missions/${missionId}/factures`, {
    echeance_ids: [e.json().id],
  });
  attendre(201, f, "brouillon");
  return (await emettreLe(ctx, c, f.json().id, date)) as Record<string, unknown> & {
    id: string;
    net_a_payer: number;
    numero: string;
  };
}

/**
 * Feuille de temps VALIDÉE posée en base (propriétaire, déclencheurs actifs) :
 * saisie (auteur) brouillon → soumise → validée, ou import brouillon → validée.
 */
export async function feuilleValidee(options: {
  cabinetId: string;
  collaborateurId: string;
  semaine: string;
  /** Utilisateur auteur (saisie) ; sans auteur : import par `importePar`. */
  auteurId?: string;
  importePar?: string;
  soumiseLe?: string;
  lignes: readonly { date: string; missionId: string; tacheId: string; jours: number }[];
}): Promise<string> {
  return proprietaire(async (cl) => {
    const saisie = options.auteurId !== undefined;
    const f = await cl.query(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine, origine, importee_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        options.cabinetId,
        options.collaborateurId,
        options.auteurId ?? null,
        options.semaine,
        saisie ? "saisie" : "import",
        saisie ? null : options.importePar,
      ],
    );
    const id = f.rows[0].id as string;
    for (const l of options.lignes) {
      await cl.query(
        `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [options.cabinetId, id, l.date, l.missionId, l.tacheId, Math.round(l.jours * 100)],
      );
    }
    if (saisie) {
      const soumise = `${options.soumiseLe ?? ajouterJours(options.semaine, 4)}T12:00:00Z`;
      await cl.query(
        `UPDATE feuilles_temps SET statut = 'soumise', cycle = 1, premiere_soumission_le = $2,
           soumise_le = $2 WHERE id = $1`,
        [id, soumise],
      );
    }
    await cl.query(
      "UPDATE feuilles_temps SET statut = 'validee', validee_le = now() WHERE id = $1",
      [id],
    );
    return id;
  });
}

/** Retire les jobs d'une clé (tâche planifiée créée par un test). */
export function retirerJobs(cle: string) {
  return proprietaire((cl) => cl.query("DELETE FROM jobs WHERE cle = $1", [cle]));
}

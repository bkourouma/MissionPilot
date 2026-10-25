import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { estWeekEnd, type Alea } from "../horloge.js";

/*
 * Chronologie fictive et antidatage du circuit qualité des rapports des missions terminées.
 *
 * Les routes horodatent tout « maintenant » : chaque action est donc notée dans un `Releve` (avec
 * l'instant fictif voulu), puis les dates sont remontées par SQL du rôle propriétaire. Les tables
 * de l'historique qualité sont en ajout seul (déclencheurs) : on les lève le temps d'une
 * transaction (`session_replication_role = replica`), pour des DATES uniquement, jamais pour un
 * contenu. Une requête littérale par table (aucun nom de table interpolé) ; seules les lignes
 * écrites pendant l'exécution courante sont touchées (`>= debutReel`), ce qui rend le
 * module rejouable.
 */

/** Nombre de jours ouvrés, au plus, sur lesquels s'étale le circuit d'un rapport. */
const JOURS_MAX = 4;

export interface Releve {
  vus: { element: string; utilisateur: string; le: string }[];
  sessions: { utilisateur: string; debut: string; fin: string; duree: number }[];
  validations: { etape: string; le: string }[];
  attestations: { item: string; le: string }[];
  verification: string | null;
  validationComplete: string | null;
  signature: string | null;
}

export const releveVide = (): Releve => ({
  vus: [],
  sessions: [],
  validations: [],
  attestations: [],
  verification: null,
  validationComplete: null,
  signature: null,
});

export interface Fenetre {
  /** Jours ouvrés disponibles (au moins un). */
  jours: string[];
  /** Plancher : le rapport n'existe pas avant (ISO). */
  plancher: string;
  /** Dernier jour autorisé (veille de la clôture fictive). */
  limite: string;
  /** Vrai si le rapport est daté APRÈS la limite : la fenêtre est alors ramenée avant la limite. */
  rapportTardif: boolean;
}

/** Fenêtre du circuit : quelques jours ouvrés après la date du rapport, avant la clôture fictive. */
export function fenetreDe(rapportLe: Date, finMission: string): Fenetre {
  const limite = ajouterJours(finMission, 5);
  const jourRapport = rapportLe.toISOString().slice(0, 10);
  const rapportTardif = jourRapport > limite;
  const debut = rapportTardif ? ajouterJours(limite, -3) : jourRapport;
  const jours: string[] = [];
  for (let d = debut; d <= limite && jours.length < JOURS_MAX; d = ajouterJours(d, 1)) {
    if (!estWeekEnd(d)) jours.push(d);
  }
  if (jours.length === 0) jours.push(debut);
  const plancher = rapportTardif ? `${jours[0]}T08:00:00.000Z` : rapportLe.toISOString();
  return { jours, plancher, limite, rapportTardif };
}

/** Curseur d'instants strictement croissants, répartis sur les jours ouvrés de la fenêtre. */
export class Fil {
  private dernier: number;
  private rang = 0;
  private jourCourant = -1;
  private minute = 0;
  constructor(
    private readonly fenetre: Fenetre,
    private readonly alea: Alea,
    private readonly total: number,
  ) {
    this.dernier = Date.parse(fenetre.plancher);
  }

  /** Instant d'ouverture : juste après la génération du rapport. */
  ouverture(): string {
    this.dernier += 2 * 60_000;
    return new Date(this.dernier).toISOString();
  }

  /** Prochain instant de la chronologie (étape logique suivante). */
  suivant(): string {
    const n = this.fenetre.jours.length;
    const idx = Math.min(n - 1, Math.floor((this.rang * n) / Math.max(1, this.total)));
    this.rang += 1;
    if (idx !== this.jourCourant) {
      this.jourCourant = idx;
      this.minute = 9 * 60 + this.alea.entier(0, 45);
    } else {
      this.minute += this.alea.entier(30, 80);
    }
    const jour = this.fenetre.jours[idx] as string;
    const candidat = Date.parse(`${jour}T00:00:00Z`) + this.minute * 60_000;
    this.dernier = Math.max(candidat, this.dernier + 5 * 60_000);
    return new Date(this.dernier).toISOString();
  }

  /** Les instants suivants viennent après `iso` (fin d'une session de revue). */
  apres(iso: string): void {
    this.dernier = Math.max(this.dernier, Date.parse(iso));
  }
}

/** Instant décalé de `minutes` (ISO). */
export const decaler = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/**
 * Remonte les dates d'un suivi à la chronologie fictive. `ouverture` : instant d'ouverture ;
 * `[debutReel ; finReel]` : fenêtre d'horloge réelle des écritures (journal d'audit étalé dans
 * l'intervalle fictif [`ouverture` ; dernier instant]).
 */
export async function antidaterSuivi(
  ctx: ContexteTenantDemo,
  suiviId: string,
  r: Releve,
  ouverture: string,
  debutReel: Date,
  finReel: Date,
): Promise<void> {
  const c = ctx.proprietaire;
  const fin = r.signature ?? r.validationComplete ?? r.verification ?? ouverture;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    // Ouverture : le suivi et ses éléments de revue datent de la génération du rapport.
    await c.query(
      "UPDATE qualite_suivis SET ouvert_le = $2 WHERE id = $1 AND ouvert_le > $2::timestamptz",
      [suiviId, ouverture],
    );
    await c.query(
      "UPDATE qualite_revue_elements SET cree_le = $2 WHERE suivi_id = $1 AND cree_le > $2::timestamptz",
      [suiviId, ouverture],
    );
    await c.query(
      "UPDATE qualite_evenements SET le = $2 WHERE suivi_id = $1 AND action = 'ouverture' AND le > $2::timestamptz",
      [suiviId, ouverture],
    );
    if (r.verification) {
      await c.query(
        "UPDATE qualite_verifications SET le = $2 WHERE suivi_id = $1 AND statut <> 'atteste' AND le >= $3",
        [suiviId, r.verification, debutReel],
      );
      await c.query(
        "UPDATE qualite_evenements SET le = $2 WHERE suivi_id = $1 AND action = 'passage_en_revue' AND le >= $3",
        [suiviId, r.verification, debutReel],
      );
    }
    for (const a of r.attestations) {
      await c.query(
        "UPDATE qualite_verifications SET le = $3 WHERE suivi_id = $1 AND item_id = $2 AND statut = 'atteste' AND le >= $4",
        [suiviId, a.item, a.le, debutReel],
      );
    }
    for (const v of r.validations) {
      await c.query(
        "UPDATE qualite_validations SET valide_le = $3 WHERE suivi_id = $1 AND etape = $2 AND valide_le >= $4",
        [suiviId, v.etape, v.le, debutReel],
      );
    }
    if (r.vus.length > 0) {
      await c.query(
        `UPDATE qualite_revue_vus v SET vu_le = x.le
           FROM unnest($2::uuid[], $3::uuid[], $4::timestamptz[]) AS x(element_id, utilisateur_id, le)
          WHERE v.suivi_id = $1 AND v.element_id = x.element_id AND v.utilisateur_id = x.utilisateur_id
            AND v.vu_le >= $5`,
        [
          suiviId,
          r.vus.map((v) => v.element),
          r.vus.map((v) => v.utilisateur),
          r.vus.map((v) => v.le),
          debutReel,
        ],
      );
    }
    for (const s of r.sessions) {
      await c.query(
        `UPDATE qualite_revue_sessions SET debut = $3, fin = $4, duree_secondes = $5
          WHERE suivi_id = $1 AND utilisateur_id = $2 AND debut >= $6`,
        [suiviId, s.utilisateur, s.debut, s.fin, s.duree, debutReel],
      );
    }
    if (r.validationComplete) {
      await c.query(
        "UPDATE qualite_evenements SET le = $2 WHERE suivi_id = $1 AND action = 'validation_complete' AND le >= $3",
        [suiviId, r.validationComplete, debutReel],
      );
    }
    if (r.signature) {
      await c.query(
        "UPDATE qualite_signatures SET signe_le = $2 WHERE suivi_id = $1 AND signe_le >= $3",
        [suiviId, r.signature, debutReel],
      );
      await c.query(
        "UPDATE qualite_evenements SET le = $2 WHERE suivi_id = $1 AND action = 'signature' AND le >= $3",
        [suiviId, r.signature, debutReel],
      );
    }
    await c.query("UPDATE qualite_suivis SET modifie_le = $2 WHERE id = $1 AND modifie_le >= $3", [
      suiviId,
      fin,
      debutReel,
    ]);
    // Journal d'audit des actions de la fenêtre : étalé dans l'intervalle fictif, ordre conservé.
    await c.query(
      `UPDATE journal_audit j
          SET cree_le = $2::timestamptz + ($3::timestamptz - $2::timestamptz) * (r.rang::float8 / r.total)
         FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1) AS rang, count(*) OVER () AS total
                 FROM journal_audit
                WHERE cabinet_id = $1 AND cree_le >= $4 AND cree_le <= $5
                  AND action NOT LIKE 'semis_tenant_demo%') r
        WHERE j.id = r.id`,
      [ctx.cabinetId, decaler(ouverture, 1), fin, debutReel, finReel],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

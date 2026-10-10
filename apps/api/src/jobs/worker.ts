import type { Database } from "../db/pool.js";
import type { Mailer } from "../notifications/mailer.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { planifierRecurrents } from "./planificateur.js";
import { ErreurJobDefinitive, REGISTRE_JOBS, type RegistreJobs } from "./registre.js";

/*
 * Worker de la file de tâches PostgreSQL (ADR-002).
 * - Réservation d'un job à la fois par `reserver_job_a(maintenant)` (FOR
 *   UPDATE SKIP LOCKED) : plusieurs workers ne prennent jamais le même job.
 * - Le handler s'exécute dans une transaction ouverte dans le contexte RLS du
 *   cabinet du job (`withTenant`) ; le job passe « termine » dans la même
 *   transaction. Les e-mails partent après validation.
 * - Échec : nouvelle tentative différée (1 min, 2 min, 4 min…) tant que le
 *   nombre maximal de tentatives n'est pas atteint, puis « echec ». Le
 *   message d'erreur est tronqué et ne reprend jamais le détail PostgreSQL.
 * - Un job resté « en_cours » au-delà du délai de blocage (worker arrêté
 *   brutalement) est remis en attente.
 * - L'horloge est injectable : aucun test ne dépend de l'heure réelle.
 */

export interface OptionsWorker {
  mailer: Mailer;
  registre?: RegistreJobs;
  horloge?: () => Date;
  /** Intervalle entre deux cycles (défaut 30 s). */
  intervalleMs?: number;
  /** Délai au-delà duquel un job « en_cours » est considéré bloqué (défaut : DELAI_BLOCAGE_JOB_DEFAUT_MS, 15 min). */
  delaiBlocageMs?: number;
  /** Délai avant la tentative suivante, selon le numéro de la tentative échouée. */
  delaiReprise?: (tentative: number) => number;
  journal?: (message: string) => void;
}

export interface ResultatJob {
  id: string;
  type: string;
  statut: "termine" | "reessai" | "echec";
  erreur?: string;
}

interface JobReserve {
  id: string;
  cabinet_id: string;
  type: string;
  charge: Record<string, unknown> | null;
  tentatives: number;
  tentatives_max: number;
}

const MAX_JOBS_PAR_CYCLE = 100;

/**
 * Délai de blocage par défaut : un job « en_cours » plus ancien est remis en attente. Un job
 * long (rejeu réel d'une évaluation, agents/evaluations-openrouter.ts) doit finir bien avant.
 */
export const DELAI_BLOCAGE_JOB_DEFAUT_MS = 15 * 60_000;

export class WorkerJobs {
  private readonly registre: RegistreJobs;
  private readonly horloge: () => Date;
  private readonly journal: (message: string) => void;
  private minuterie: NodeJS.Timeout | null = null;
  private enCours: Promise<unknown> | null = null;
  private arrete = true;

  constructor(
    private readonly database: Database,
    private readonly options: OptionsWorker,
  ) {
    this.registre = options.registre ?? REGISTRE_JOBS;
    this.horloge = options.horloge ?? (() => new Date());
    this.journal = options.journal ?? (() => undefined);
  }

  /** Réserve et exécute un job prêt ; null s'il n'y en a aucun. */
  async traiterUn(): Promise<ResultatJob | null> {
    const maintenant = this.horloge();
    const job = await this.database.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM reserver_job_a($1)", [maintenant]);
      return r.rows[0] as JobReserve | undefined;
    });
    if (!job) return null;
    try {
      const handler = this.registre.get(job.type);
      if (!handler) throw new ErreurJobDefinitive(`Type de job inconnu : ${job.type}`);
      const notifications = await this.database.withTenant(job.cabinet_id, async (db) => {
        const n = await handler({
          db,
          cabinetId: job.cabinet_id,
          jobId: job.id,
          charge: job.charge ?? {},
          maintenant,
          database: this.database,
        });
        await db.query(
          "UPDATE jobs SET statut = 'termine', progression = 100, erreur = NULL WHERE id = $1",
          [job.id],
        );
        return (n ?? []) as readonly (NotificationCreee | null)[];
      });
      await envoyerEmails(this.options.mailer, notifications, this.journal);
      return { id: job.id, type: job.type, statut: "termine" };
    } catch (error) {
      const definitive =
        error instanceof ErreurJobDefinitive || job.tentatives >= job.tentatives_max;
      const message = (error instanceof Error ? error.message : "Erreur inconnue").slice(0, 500);
      const delai = (this.options.delaiReprise ?? ((t) => 60_000 * 2 ** (t - 1)))(job.tentatives);
      await this.database.withTenant(job.cabinet_id, async (db) => {
        await db.query(
          `UPDATE jobs SET statut = $2, erreur = $3, verrouille_le = NULL,
             execute_a = CASE WHEN $2 = 'en_attente' THEN $4::timestamptz ELSE execute_a END
           WHERE id = $1`,
          [
            job.id,
            definitive ? "echec" : "en_attente",
            message,
            new Date(maintenant.getTime() + delai),
          ],
        );
      });
      this.journal(`Job ${job.type} (${job.id}) : ${definitive ? "échec" : "nouvelle tentative"}.`);
      return {
        id: job.id,
        type: job.type,
        statut: definitive ? "echec" : "reessai",
        erreur: message,
      };
    }
  }

  /** Libère les jobs bloqués, planifie les tâches récurrentes, traite les jobs prêts. */
  async cycle(): Promise<ResultatJob[]> {
    const maintenant = this.horloge();
    await this.database.withoutTenant((db) =>
      db.query("SELECT liberer_jobs_bloques($1, $2::interval)", [
        maintenant,
        `${Math.round((this.options.delaiBlocageMs ?? DELAI_BLOCAGE_JOB_DEFAUT_MS) / 1000)} seconds`,
      ]),
    );
    await planifierRecurrents(this.database, maintenant);
    const resultats: ResultatJob[] = [];
    for (let i = 0; i < MAX_JOBS_PAR_CYCLE; i++) {
      const r = await this.traiterUn();
      if (!r) break;
      resultats.push(r);
    }
    return resultats;
  }

  /** Démarre la boucle (cycles successifs, jamais deux en parallèle). */
  demarrer(): void {
    if (!this.arrete) return;
    this.arrete = false;
    const boucle = async () => {
      if (this.arrete) return;
      this.enCours = this.cycle().catch((e: unknown) =>
        this.journal(`Cycle de jobs interrompu : ${e instanceof Error ? e.message : "erreur"}`),
      );
      await this.enCours;
      this.enCours = null;
      if (!this.arrete) this.minuterie = setTimeout(boucle, this.options.intervalleMs ?? 30_000);
    };
    void boucle();
  }

  /** Arrête la boucle et attend la fin du cycle en cours. */
  async arreter(): Promise<void> {
    this.arrete = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    await this.enCours;
  }
}

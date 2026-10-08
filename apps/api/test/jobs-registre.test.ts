import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { TYPE_JOB_DETECTION_AUTOMATISATION } from "../src/automatisation/detection.js";
import { TYPE_JOB_EVENEMENT_AUTOMATISATION } from "../src/automatisation/evenements.js";
import { TYPE_JOB_AGENT_AUTOMATISATION } from "../src/automatisation/execution.js";
import { TYPE_JOB_RELANCES } from "../src/finance/relances.js";
import { TYPE_JOB_CONSERVATION_IA } from "../src/ia/conservation.js";
import { TYPE_JOB_IA } from "../src/ia/orchestrateur.js";
import { REGISTRE_JOBS } from "../src/jobs/registre.js";
import { TYPE_JOB_SUIVI_KPI } from "../src/kpi/suivi.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { TYPE_JOB_EMAIL } from "../src/notifications/charge-email.js";
import { registreAvecEmails } from "../src/notifications/file-email.js";
import { TYPE_JOB_RELANCE_QUESTIONNAIRE } from "../src/questionnaires/relances.js";
import { TYPE_JOB_PURGE_RAPPORTS } from "../src/rapports/purge.js";
import { TYPE_JOB_RELANCE_SALLE } from "../src/salle-mission/relances.js";
import { TYPE_JOB_PURGE_FICHIERS } from "../src/stockage/purge.js";
import { configTest } from "./helpers.js";

/*
 * Chaque type de job déclaré par le code (constante `TYPE_JOB_*` exportée) a un handler : sinon le
 * worker ne l'exécute jamais (« aucun handler ») et la file se remplit en silence. Deux garde-fous :
 * - chaque constante importée ci-dessous figure dans `REGISTRE_JOBS` (jobs/registre.ts), sauf
 *   `TYPE_JOB_EMAIL`, exclue EXPRESSÉMENT : son handler dépend du transport et du trousseau, que
 *   `server.ts` fournit par `registreAvecEmails` (notifications/file-email.ts) ; il est vérifié
 *   dans ce registre complété, et son absence de `REGISTRE_JOBS` est elle-même assertée ;
 * - un inventaire AUTOMATIQUE lit les sources : toute constante `TYPE_JOB_*` exportée qui n'est
 *   pas importée ici fait échouer le test (une nouvelle constante force à y penser).
 */

const DECLARES: Record<string, string> = {
  TYPE_JOB_RELANCES,
  TYPE_JOB_PURGE_FICHIERS,
  TYPE_JOB_PURGE_RAPPORTS,
  TYPE_JOB_CONSERVATION_IA,
  TYPE_JOB_RELANCE_QUESTIONNAIRE,
  TYPE_JOB_SUIVI_KPI,
  TYPE_JOB_EVENEMENT_AUTOMATISATION,
  TYPE_JOB_AGENT_AUTOMATISATION,
  TYPE_JOB_DETECTION_AUTOMATISATION,
  TYPE_JOB_RELANCE_SALLE,
  TYPE_JOB_IA,
  TYPE_JOB_EMAIL,
};

/** Constantes exclues de REGISTRE_JOBS, avec la raison (handler fourni par le serveur). */
const EXCLUS_DE_REGISTRE_JOBS: Record<string, string> = {
  TYPE_JOB_EMAIL: "handler fourni par registreAvecEmails (transport et trousseau du serveur)",
};

function fichiersTs(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTs(chemin);
    return nom.endsWith(".ts") ? [chemin] : [];
  });
}

describe("registre des jobs", () => {
  it("chaque type de job déclaré a un handler (ou une exclusion motivée)", () => {
    for (const [nom, type] of Object.entries(DECLARES)) {
      if (nom in EXCLUS_DE_REGISTRE_JOBS) {
        expect(REGISTRE_JOBS.has(type), `${nom} ne doit pas être dans REGISTRE_JOBS`).toBe(false);
        continue;
      }
      expect(REGISTRE_JOBS.has(type), `${nom} (${type}) n'a pas de handler`).toBe(true);
    }
  });

  it("l'envoi d'e-mail est géré par le registre complété du serveur", () => {
    const registre = registreAvecEmails(new MailerJournal(), trousseauDepuisConfig(configTest()));
    expect(registre.has(TYPE_JOB_EMAIL)).toBe(true);
    // Le registre complété garde tous les handlers de base.
    for (const type of REGISTRE_JOBS.keys()) expect(registre.has(type)).toBe(true);
  });

  it("inventaire automatique : aucune constante TYPE_JOB_* exportée ne manque à ce test", () => {
    const trouvees: Record<string, string> = {};
    for (const f of fichiersTs(join(__dirname, "..", "src"))) {
      const t = readFileSync(f, "utf8");
      for (const m of t.matchAll(/export const (TYPE_JOB_[A-Z_]+)\s*=\s*"([a-z_]+)"/g)) {
        trouvees[m[1] as string] = m[2] as string;
      }
    }
    expect(Object.keys(trouvees).length).toBeGreaterThan(0);
    expect(trouvees).toEqual(DECLARES);
  });

  it("les types du registre sont uniques et conformes (minuscules et tiret bas)", () => {
    const types = [...REGISTRE_JOBS.keys()];
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t).toMatch(/^[a-z_]{1,60}$/);
  });
});

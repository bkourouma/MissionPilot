import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { construireMission, signerEtDemarrer, type Session } from "../../seed-demo.js";
import { CASTING, type MissionCasting } from "./casting.js";

/*
 * MISSIONS DE SECOURS, pour les TESTS et le développement de ce lot seulement : tant que la
 * phase « missions » (lot 2a) ne crée pas le casting, ce module crée celles de ses missions que
 * la phase « notation-plans » utilise (1, 2, 5, 6, 9, 10) avec les routes de seed-demo.ts, aux
 * mêmes intitulés et clients, OUVERTES (en cours) comme le fait le lot 2a, sauf la 10 (signée). Une mission
 * déjà présente n'est jamais touchée. Jamais appelé par la phase elle-même.
 */

interface Modele {
  cible: MissionCasting;
  debut: string;
  fin: string;
  etat: "en_cours" | "signee";
}

const MODELES: readonly Modele[] = [
  { cible: CASTING.sicafe, debut: "2024-11-04", fin: "2025-04-30", etat: "en_cours" },
  { cible: CASTING.sahelCoton, debut: "2025-02-03", fin: "2025-06-20", etat: "en_cours" },
  { cible: CASTING.atlantique, debut: "2026-01-12", fin: "2026-05-29", etat: "en_cours" },
  { cible: CASTING.baobab, debut: "2026-06-08", fin: "2026-12-18", etat: "en_cours" },
  { cible: CASTING.banqueSahel, debut: "2026-08-24", fin: "2026-12-18", etat: "en_cours" },
  { cible: CASTING.sicafeExport, debut: "2026-11-09", fin: "2027-02-26", etat: "signee" },
];

export async function creerMissionsDeSecours(ctx: ContexteTenantDemo): Promise<void> {
  const equipe = {
    sessions: ctx.sessions as Record<string, Session>,
    clients: ctx.clients as Record<string, string>,
    grades: ctx.grades,
  };
  for (const m of MODELES) {
    const existe = await ctx.proprietaire.query(
      "SELECT 1 FROM missions WHERE cabinet_id = $1 AND intitule = $2",
      [ctx.cabinetId, m.cible.intitule],
    );
    if ((existe.rowCount ?? 0) > 0) continue;
    const construite = await construireMission(equipe, {
      intitule: m.cible.intitule,
      client: m.cible.client,
      debut: m.debut,
      fin: m.fin,
      mode: "forfait",
      phases: { Cadrage: { manager: 4, senior: 6 }, Réalisation: { manager: 8, senior: 14 } },
    });
    await signerEtDemarrer(equipe, construite, ajouterJours(m.debut, -3));
    if (m.etat === "signee") continue;
    await ctx.proprietaire.query("UPDATE missions SET statut = 'en_cours' WHERE id = $1", [
      construite.id,
    ]);
  }
}

import type { ContexteTenantDemo } from "../contexte.js";
import type { Alea } from "../horloge.js";
import type { Casting } from "./casting.js";
import type { FeuillePlan } from "./temps-plan.js";

/*
 * Import de l'historique des temps (TPS-10) : une semaine d'un collaborateur, en CSV, par la
 * vraie route `/api/temps/import` (simulation puis exécution), avec la session du gestionnaire
 * (droit `temps.importer`). La feuille importée naît validée, d'origine « import », sans auteur :
 * ses dates ne sont pas antidatables (feuille validée immuable).
 */

interface RapportImport {
  executee: boolean;
  lignes_valides: number;
  feuilles: number;
  jours_total: number;
  erreurs: { ligne: number; message: string }[];
}

/**
 * Semaine à importer : une feuille de mission du premier semestre 2025, retirée du circuit
 * normal (l'import exige qu'aucune feuille n'existe pour la semaine). Null si aucune.
 */
export function choisirImport(plans: readonly FeuillePlan[], rng: Alea): FeuillePlan | null {
  const candidats = plans.filter(
    (p) =>
      p.semaine >= "2025-03-03" &&
      p.semaine <= "2025-05-26" &&
      !p.cle.startsWith("associe") &&
      p.lignes.filter((l) => l.tacheId).length >= 2,
  );
  return candidats.length > 0 ? rng.choisir(candidats) : null;
}

const champ = (v: string): string => `"${v.replace(/"/g, '""')}"`;

/** Importe les lignes de mission de `plan`. Renvoie un message de compte rendu. */
export async function importerSemaine(
  ctx: ContexteTenantDemo,
  casting: Casting,
  plan: FeuillePlan,
): Promise<string> {
  const existe = await ctx.proprietaire.query(
    "SELECT 1 FROM feuilles_temps WHERE cabinet_id = $1 AND collaborateur_id = $2 AND semaine = $3",
    [ctx.cabinetId, plan.collaborateurId, plan.semaine],
  );
  if ((existe.rowCount ?? 0) > 0) return "import déjà présent";
  const nom = (
    await ctx.proprietaire.query("SELECT nom FROM collaborateurs WHERE id = $1", [
      plan.collaborateurId,
    ])
  ).rows[0]?.nom as string | undefined;
  if (!nom) return "import ignoré (collaborateur introuvable)";
  const missions = Object.values(casting.missions);
  const lignes = plan.lignes.flatMap((l) => {
    const m = missions.find((x) => x.id === l.missionId);
    const t = m?.taches.find((x) => x.id === l.tacheId);
    return m && t
      ? [[nom, m.nom, t.libelle, l.date, String(l.unites / 2)].map(champ).join(";")]
      : [];
  });
  const csv = ["collaborateur;mission;tache;date;jours", ...lignes].join("\n");
  const gestion = ctx.session("gestionnaire");
  const simulation = await gestion.post("/api/temps/import?simulation=true", { csv });
  if (simulation.statusCode !== 200) {
    return `import ignoré (simulation HTTP ${simulation.statusCode} ${simulation.body})`;
  }
  const rapportSimule = simulation.json() as RapportImport;
  if (rapportSimule.erreurs.length > 0) {
    return `import ignoré (simulation : ${JSON.stringify(rapportSimule.erreurs.slice(0, 3))})`;
  }
  const execution = await gestion.post("/api/temps/import?simulation=false", { csv });
  if (execution.statusCode !== 200) {
    return `import ignoré (exécution HTTP ${execution.statusCode} ${execution.body})`;
  }
  const r = execution.json() as RapportImport;
  return `import de ${r.lignes_valides} ligne(s), ${r.jours_total} j, ${nom}, semaine du ${plan.semaine}`;
}

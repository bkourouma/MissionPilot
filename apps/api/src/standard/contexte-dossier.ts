import { validerContexteModulation } from "@missionpilot/engines";
import type { ValeurFacteurContexte } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { aujourdhui } from "../dossier/acces.js";
import { facteursCourants, listerFacteurs } from "../dossier/facteurs.js";
import { lireContexteClient } from "../dossier/lecture.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { definitionFacteur, lireFacteurs } from "./modulation.js";

/*
 * Dossier client → méthode (STD-04, DOS-01) : à la liaison d'une mission à une méthode, le
 * contexte de modulation est PROPOSÉ depuis le dossier du client de la mission (valeurs
 * courantes des facteurs : `fiabilite_comptes`, `part_informel`, `effectif`, `actionnariat`…,
 * `lireContexteClient`). Rien n'est écrit : l'utilisateur relit, complète (facteurs portés par la
 * mission) et CONFIRME en liant la méthode (`PUT /missions/:id/methode`), qui revalide le
 * contexte. Chaque valeur proposée cite sa source, sa date d'effet et sa fiabilité ; une valeur
 * que le référentiel ne connaît pas ou qu'il refuse est écartée, avec la raison.
 *
 * Droits (routes/standard.ts) : `standard.lire` ET `dossier.lire`, mission visible (404 sinon,
 * qui couvre aussi le dossier : un client dont on voit une mission a son dossier visible).
 */

export interface ContexteDossierPropose {
  date: string;
  contexte: Record<string, ValeurFacteurContexte>;
  sources: {
    facteur: string;
    libelle: string;
    valeur: ValeurFacteurContexte;
    date_effet: string;
    source: { type: unknown; libelle: unknown };
    fiabilite: string;
  }[];
  ecartes: { facteur: string; valeur: ValeurFacteurContexte; raison: string }[];
}

export async function proposerContexteMission(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<ContexteDossierPropose> {
  const mission = await exigerMissionVisible(db, auth, missionId);
  const date = aujourdhui();
  const definitions = await lireFacteurs(db);
  const parCode = new Map(definitions.map((f) => [f.code, f]));
  const brut = await lireContexteClient(db, mission.client_id, date);
  const courants = new Map(
    facteursCourants(await listerFacteurs(db, mission.client_id), date).map((f) => [f.code, f]),
  );
  const contexte: Record<string, ValeurFacteurContexte> = {};
  const sources: ContexteDossierPropose["sources"] = [];
  const ecartes: ContexteDossierPropose["ecartes"] = [];
  for (const code of Object.keys(brut).sort()) {
    const valeur = brut[code] as ValeurFacteurContexte;
    const definition = parCode.get(code);
    if (!definition) {
      ecartes.push({
        facteur: code,
        valeur,
        raison: "Facteur inconnu du référentiel de méthodes.",
      });
      continue;
    }
    // Le moteur de modulation juge la valeur, facteur par facteur.
    const anomalie = validerContexteModulation([definitionFacteur(definition)], {
      [code]: valeur,
    }).anomalies.find((a) => a.gravite === "erreur");
    if (anomalie) {
      ecartes.push({ facteur: code, valeur, raison: anomalie.message });
      continue;
    }
    contexte[code] = valeur;
    const f = courants.get(code);
    sources.push({
      facteur: code,
      libelle: definition.libelle,
      valeur,
      date_effet: f?.date_effet ?? date,
      source: { type: f?.source.type ?? null, libelle: f?.source.libelle ?? null },
      fiabilite: f?.fiabilite ?? "",
    });
  }
  return { date, contexte, sources, ecartes };
}

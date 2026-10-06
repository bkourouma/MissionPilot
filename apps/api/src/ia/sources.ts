import type { SourceIa } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";

/*
 * Sources citées par une génération (PRD : « chaque sortie IA garde […] ses
 * sources ») : références VÉRIFIABLES, contrôlées avant la génération.
 * - « mission » : mission visible de l'utilisateur ;
 * - « mission_document » : document du cabinet dont la mission est visible ;
 * - « moteur » : calcul d'un moteur, identifié par un code (« finance.budget »).
 * Une source inconnue, d'un autre cabinet ou invisible répond 400 sans
 * distinguer les cas (on ne révèle pas l'existence d'une ressource).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_MOTEUR = /^[a-z][a-z_]{0,39}(\.[a-z][a-z_]{0,39}){0,4}$/;

const sourceInvalide = (s: SourceIa) =>
  requeteInvalide(`Source inconnue ou inaccessible : ${s.type} ${s.id.slice(0, 100)}.`);

async function missionVisible(db: Db, auth: Auth, id: string, s: SourceIa): Promise<void> {
  try {
    await exigerMissionVisible(db, auth, id);
  } catch (error) {
    if (error instanceof AppError && error.statut === 404) throw sourceInvalide(s);
    throw error;
  }
}

export async function verifierSources(
  db: Db,
  auth: Auth,
  sources: readonly SourceIa[],
): Promise<SourceIa[]> {
  const vues = new Set<string>();
  const resultat: SourceIa[] = [];
  for (const s of sources) {
    const cle = `${s.type}:${s.id}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    if (s.type === "moteur") {
      if (!CODE_MOTEUR.test(s.id)) throw sourceInvalide(s);
    } else if (!UUID.test(s.id)) {
      throw sourceInvalide(s);
    } else if (s.type === "mission") {
      await missionVisible(db, auth, s.id, s);
    } else {
      const r = await db.query("SELECT mission_id FROM mission_documents WHERE id = $1", [s.id]);
      if (!r.rows[0]) throw sourceInvalide(s);
      await missionVisible(db, auth, r.rows[0].mission_id as string, s);
    }
    resultat.push({ type: s.type, id: s.id, libelle: s.libelle });
  }
  return resultat;
}

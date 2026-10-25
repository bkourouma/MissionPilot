import type { ContexteTenantDemo } from "../contexte.js";
import { compterRegistreNotation } from "../notation-plans/preuves-notation-compte.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Garde de reprise du registre des preuves d'UNE mission. La phase « notation-plans » (lot 3,
 * étape « preuves-notation ») sème déjà, AVANT cette phase, des preuves et affirmations sur les
 * missions 1, 2, 3, 5, 6 et 9 : on les retranche des comptes (`compterRegistreNotation`) avant de
 * comparer au contenu attendu de CE registre. Les arbitrages ne viennent que d'ici.
 *
 *  - rien de nous : le registre est à semer ;
 *  - tout de nous : déjà semé ;
 *  - entre les deux : semis interrompu, erreur claire (repartir d'une base neuve).
 */
export async function etatRegistre(
  ctx: ContexteTenantDemo,
  missionId: string,
  def: DefMissionPreuves,
): Promise<"vide" | "complet"> {
  const total = async (sql: string): Promise<number> =>
    ((await ctx.proprietaire.query(sql, [missionId])).rows[0]?.n as number) ?? 0;
  const lot3 = await compterRegistreNotation(ctx, missionId);
  const preuves =
    (await total("SELECT count(*)::int n FROM preuves WHERE mission_id = $1")) - lot3.preuves;
  const assertions =
    (await total("SELECT count(*)::int n FROM assertions WHERE mission_id = $1")) - lot3.assertions;
  const arbitrages = await total(
    "SELECT count(*)::int n FROM preuve_arbitrages WHERE mission_id = $1",
  );
  if (preuves + assertions + arbitrages <= 0) return "vide";
  const attenduArbitrages = def.assertions.filter((x) => x.arbitrage).length;
  if (
    preuves === def.preuves.length &&
    assertions >= def.assertions.length &&
    arbitrages >= attenduArbitrages
  ) {
    return "complet";
  }
  throw new Error(
    `Registre « ${def.mission} » PARTIELLEMENT semé (preuves ${preuves}/${def.preuves.length}, ` +
      `assertions ${assertions}/${def.assertions.length}, arbitrages ${arbitrages}/` +
      `${attenduArbitrages}) : repartir d'une base neuve.`,
  );
}

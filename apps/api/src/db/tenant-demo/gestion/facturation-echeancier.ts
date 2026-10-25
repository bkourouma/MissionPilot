import type { CleMission, MissionLue } from "./casting.js";
import type { EcheanceSpec, MissionFacturation } from "./donnees-facturation.js";
import {
  appel,
  cleGestionnaire,
  etape,
  lire,
  moins,
  ouvre,
  repartir,
  session,
  type Env,
  type Evenement,
} from "./facturation-outils.js";

/*
 * ÉCHÉANCIERS des missions signées : génération par la route `echeancier/generer` quand le budget
 * n'a pas été révisé (forfait), saisie échéance par échéance sinon (budget révisé, mission en
 * régie facturée par étapes), plus l'échéance COMPLÉMENTAIRE d'un avenant (budget courant moins
 * budget initial, deux soustractions du moteur). Les montants viennent de
 * `casting.missions[...].budgetHonoraires` ; aucun calcul n'est refait ici (`repartir` s'appuie sur
 * le moteur de pourcentage). La régie sur temps validés est dans facturation-factures.ts.
 */

const jalonsDe = async (env: Env, m: MissionLue): Promise<Map<string, string>> =>
  new Map(
    (await lire(env, "SELECT id, libelle FROM mission_jalons WHERE mission_id = $1", [m.id])).map(
      (j) => [j.libelle as string, j.id as string],
    ),
  );

async function creerBase(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  spec: MissionFacturation,
  date: string,
): Promise<void> {
  const base = spec.echeances.filter((e) => e.pct !== undefined);
  if (base.length === 0) return;
  const g = session(env, cleGestionnaire(cle));
  const existantes = await lire(
    env,
    "SELECT libelle FROM echeances_facturation WHERE mission_id = $1",
    [m.id],
  );
  const jalons = await jalonsDe(env, m);
  const jalonId = (e: EcheanceSpec): string | null =>
    e.jalon ? (jalons.get(e.jalon) ?? null) : null;

  if (!spec.manuel) {
    if (existantes.length > 0) return;
    await etape(env, date, () =>
      appel(
        201,
        `échéancier de ${m.nom}`,
        g.post(`/api/missions/${m.id}/echeancier/generer`, {
          jalons: base.map((e) => ({
            libelle: e.libelle,
            pourcentage: e.pct,
            date: e.date,
            type: e.type,
            jalon_id: jalonId(e),
          })),
        }),
      ),
    );
    env.compteurs.echeances += base.length;
    return;
  }

  const deja = new Set(existantes.map((r) => r.libelle as string));
  const montants = repartir(
    m.budgetHonoraires,
    base.map((e) => e.pct as number),
  );
  for (const [i, e] of base.entries()) {
    if (deja.has(e.libelle)) continue;
    await etape(env, date, () =>
      appel(
        201,
        `échéance « ${e.libelle} »`,
        g.post(`/api/missions/${m.id}/echeances`, {
          type: e.type,
          libelle: e.libelle,
          montant: montants[i],
          date_prevue: e.date,
          jalon_id: jalonId(e),
        }),
      ),
    );
    env.compteurs.echeances += 1;
  }
}

/** Échéance complémentaire d'un avenant : budget courant moins budget initial. */
async function creerAvenant(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  av: EcheanceSpec,
): Promise<void> {
  const deja = await lire(
    env,
    "SELECT 1 FROM echeances_facturation WHERE mission_id = $1 AND libelle = $2",
    [m.id, av.libelle],
  );
  if (deja.length > 0) return;
  const complement = moins(m.budgetCourantHonoraires, m.budgetHonoraires);
  if (complement <= 0) {
    env.ctx.journal(
      `facturation : aucun avenant de budget pour ${m.nom}, échéance complémentaire ignorée.`,
    );
    return;
  }
  await etape(env, av.date, () =>
    appel(
      201,
      `échéance « ${av.libelle} »`,
      session(env, cleGestionnaire(cle)).post(`/api/missions/${m.id}/echeances`, {
        type: av.type,
        libelle: av.libelle,
        montant: complement,
        date_prevue: av.date,
        jalon_id: null,
      }),
    ),
  );
  env.compteurs.echeances += 1;
}

/** Événements d'échéancier d'une mission : à la signature, puis à la date de chaque avenant. */
export function evenementsEcheancier(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  spec: MissionFacturation,
): Evenement[] {
  const evenements: Evenement[] = [];
  const signature = ouvre(env, m.dateSignature as string);
  if (spec.echeances.some((e) => e.pct !== undefined)) {
    evenements.push({
      date: signature,
      rang: 5,
      cle: `${cle}|echeancier`,
      jouer: () => creerBase(env, cle, m, spec, signature),
    });
  }
  const av = spec.echeances.find((e) => e.pct === undefined);
  if (av) {
    evenements.push({
      date: ouvre(env, av.date),
      rang: 5,
      cle: `${cle}|avenant`,
      jouer: () => creerAvenant(env, cle, m, av),
    });
  }
  return evenements;
}

import { CLES_CLIENTS } from "../cles.js";
import { deviseDuClient } from "../missions/devises.js";
import { MISSIONS_TERMINEES } from "./casting.js";
import { appel, lire, session, type Env } from "./facturation-outils.js";
import { montantMineur } from "./outils.js";

/*
 * Vérifications de fin de module (lecture seule, hors taux manquants) : taux négociés des clients
 * posés par le socle, prévisions de trésorerie lues par la route, bilan chiffré de la facturation
 * par mission. Le bilan ne fait que des sommes SQL de contrôle pour le journal ; les montants
 * affichés sortent de la base, jamais d'un calcul métier refait ici.
 */

/** Taux de vente négociés : le socle en pose pour chaque client ; complète ceux qui en manquent. */
export async function verifierTauxClients(env: Env): Promise<void> {
  const g = session(env, "gestionnaire");
  const grades: [string, number][] = [
    ["senior", 83_000],
    ["manager", 135_000],
    ["associe", 299_750],
  ];
  for (const cle of CLES_CLIENTS) {
    const id = env.ctx.client(cle);
    const n = (
      await lire(env, "SELECT count(*)::int AS n FROM taux_clients WHERE client_id = $1", [id])
    )[0]?.n as number;
    if (n >= 3) continue;
    for (const [code, taux] of grades) {
      const gradeId = env.ctx.grades[code];
      if (!gradeId) continue;
      const existe = await lire(
        env,
        "SELECT 1 FROM taux_clients WHERE client_id = $1 AND grade_id = $2",
        [id, gradeId],
      );
      if (existe.length > 0) continue;
      await appel(
        201,
        `taux ${code} de ${cle}`,
        g.post(`/api/clients/${id}/taux`, {
          grade_id: gradeId,
          taux: montantMineur(taux, deviseDuClient(cle)),
        }),
      );
    }
    env.ctx.journal(`facturation : taux négociés complétés pour ${cle}.`);
  }
}

/** Prévisions de trésorerie par la route (session gestionnaire) : journal des éléments lus. */
export async function verifierPrevisions(env: Env): Promise<void> {
  const r = await appel(200, "prévisions", session(env, "gestionnaire").get("/api/previsions"));
  const resume = Object.entries(r)
    .map(([k, v]) => `${k}${Array.isArray(v) ? `[${v.length}]` : ""}`)
    .join(", ");
  env.ctx.journal(`facturation : prévisions lues (${resume}).`);
}

/** Bilan chiffré par mission, pour le journal et l'avertissement des écarts. */
export async function bilan(env: Env): Promise<void> {
  const lignes = await lire(
    env,
    `SELECT m.intitule,
            coalesce(sum(f.total_ht) FILTER (WHERE f.nature = 'facture' AND f.statut = 'emise'), 0)::float8 AS net_ht,
            coalesce(sum(f.net_a_payer) FILTER (WHERE f.nature = 'facture' AND f.statut = 'emise'), 0)::float8 AS net_a_payer,
            (SELECT coalesce(sum(i.montant), 0) FROM imputations i JOIN factures x ON x.id = i.facture_id
              WHERE x.mission_id = m.id)::float8 AS encaisse
       FROM missions m LEFT JOIN factures f ON f.mission_id = m.id
      WHERE m.cabinet_id = $1 GROUP BY m.id, m.intitule, m.date_signature ORDER BY m.date_signature NULLS LAST`,
    [env.ctx.cabinetId],
  );
  for (const l of lignes) {
    env.ctx.journal(
      `facturation : ${l.intitule as string} : HT émis ${l.net_ht}, net à payer ${l.net_a_payer}, encaissé ${l.encaisse}.`,
    );
  }
  for (const cle of MISSIONS_TERMINEES) {
    const m = env.casting.missions[cle];
    const l = lignes.find((x) => x.intitule === m?.nom);
    if (l && l.net_a_payer !== l.encaisse) {
      env.ctx.journal(
        `ATTENTION facturation : ${cle} non soldée (${l.net_a_payer} dû, ${l.encaisse} encaissé).`,
      );
    }
  }
}

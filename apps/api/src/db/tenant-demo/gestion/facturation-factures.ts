import { ajouterJours } from "@missionpilot/engines";
import { journaliser } from "../../../audit.js";
import { emettre, lireFacture } from "../../../facturation/factures.js";
import type { CleMission, MissionLue } from "./casting.js";
import type { EcheanceSpec, EtatFacture, FactureSpec } from "./donnees-facturation.js";
import { encaisser } from "./facturation-paiements.js";
import {
  acteur,
  appel,
  cleApprobateur,
  cleGestionnaire,
  corps,
  etape,
  lire,
  ouvre,
  plus,
  session,
  trouverFacture,
  type Env,
  type Evenement,
} from "./facturation-outils.js";
import { ok } from "./outils.js";

/*
 * FACTURES et AVOIRS par le circuit réel : brouillon (gestionnaire) -> soumission (gestionnaire)
 * -> approbation (associé, jamais le gestionnaire) -> émission à une DATE FICTIVE (`emettre` du
 * domaine, comme seed-demo.ts, la route ne prenant pas de date). Les étapes du circuit sont
 * datées dans le journal d'audit. Un débours refacturable validé et libre rejoint une facture qui
 * le demande (`avecDebours`). Idempotent : une facture se retrouve par (mission, objet) et le
 * circuit reprend à l'étape où il s'était arrêté.
 */

const ORDRE: readonly string[] = ["brouillon", "a_approuver", "approuvee", "emise"];

export interface DemandeFacture {
  cle: CleMission;
  m: MissionLue;
  /** Sert à choisir l'associé qui approuve (stable). */
  cleFacture: string;
  objet: string;
  /** Date d'émission, ou de la dernière étape pour une facture non émise. */
  date: string;
  etat: EtatFacture;
  echeanceIds: string[];
  avecDebours: boolean;
  /** Remise globale (en points) à poser sur le brouillon. */
  remise?: number;
}

/** Émet à la date fictive `date` et journalise l'émission comme la route. */
async function emettreAu(
  env: Env,
  cle: CleMission,
  id: string,
  nature: "facture" | "avoir",
  date: string,
): Promise<void> {
  const auth = acteur(env, cleGestionnaire(cle), "gestionnaire");
  await etape(
    env,
    date,
    () =>
      env.ctx.database.withTenant(env.ctx.cabinetId, async (db) => {
        const f = await lireFacture(db, id, true);
        await emettre(db, auth, f, date);
        const emise = await lireFacture(db, id);
        await journaliser(db, {
          cabinetId: env.ctx.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "emission",
          entite: nature,
          entiteId: id,
          details: { mission_id: f.mission_id, numero: emise.numero },
        });
      }),
    11,
  );
}

/** Soumission puis approbation puis émission, à partir de l'état `statut`, jusqu'à `cible`. */
async function conduire(
  env: Env,
  cle: CleMission,
  id: string,
  statut: string,
  cible: EtatFacture,
  nature: "facture" | "avoir",
  cleApp: string,
  dates: { soumission: string; approbation: string; emission: string },
): Promise<void> {
  const g = session(env, cleGestionnaire(cle));
  const associe = session(env, cleApprobateur(cleApp));
  const depart = ORDRE.indexOf(statut);
  const but = ORDRE.indexOf(cible);
  if (depart < 1 && but >= 1) {
    await etape(env, dates.soumission, () =>
      appel(200, "soumission de la facture", g.post(`/api/factures/${id}/soumettre`)),
    );
  }
  if (depart < 2 && but >= 2) {
    await etape(env, dates.approbation, () =>
      appel(200, "approbation de la facture", associe.post(`/api/factures/${id}/approuver`)),
    );
  }
  if (depart < 3 && but >= 3) await emettreAu(env, cle, id, nature, dates.emission);
}

/** Crée (ou reprend) une facture et la conduit jusqu'à l'état demandé. Renvoie son identifiant. */
export async function produireFacture(env: Env, a: DemandeFacture): Promise<string | undefined> {
  const g = session(env, cleGestionnaire(a.cle));
  const decal: Record<EtatFacture, [number, number, number]> = {
    emise: [-3, -2, -1],
    approuvee: [-3, -2, 0],
    a_approuver: [-2, 0, 0],
    brouillon: [0, 0, 0],
  };
  const [dc, ds, da] = decal[a.etat];
  const d = (n: number) => plus(env, a.date, n);
  let f = await trouverFacture(env, a.m, a.objet);

  if (!f) {
    await etape(env, d(dc), async () => {
      for (const id of a.echeanceIds) {
        const e = (
          await lire(env, "SELECT statut FROM echeances_facturation WHERE id = $1", [id])
        )[0];
        if (e?.statut === "prevue") {
          await appel(
            200,
            "échéance à facturer",
            g.patch(`/api/echeances/${id}`, { statut: "a_facturer" }),
          );
        }
      }
      const debours = a.avecDebours
        ? (
            await lire(
              env,
              `SELECT d.id FROM debours d
                WHERE d.mission_id = $1 AND d.statut = 'valide' AND d.refacturable
                  AND NOT EXISTS (SELECT 1 FROM facturation_liens l
                                   WHERE l.debours_id = d.id AND l.libere_le IS NULL)
                ORDER BY d.date, d.id`,
              [a.m.id],
            )
          ).map((r) => r.id as string)
        : [];
      if (a.echeanceIds.length + debours.length === 0) {
        env.ctx.journal(`facturation : rien à facturer pour « ${a.objet} » (${a.m.nom}), ignorée.`);
        return;
      }
      const cree = await appel(
        201,
        `facture « ${a.objet} »`,
        g.post(`/api/missions/${a.m.id}/factures`, {
          echeance_ids: a.echeanceIds,
          debours_ids: debours,
          objet: a.objet,
        }),
      );
      f = { id: cree.id as string, statut: "brouillon" };
      env.compteurs.factures += 1;
      if (a.remise !== undefined) {
        await appel(
          200,
          "remise globale",
          g.patch(`/api/factures/${f.id}`, {
            remise_globale: { type: "pourcentage", valeur: a.remise },
          }),
        );
      }
    });
  }
  if (!f || f.statut === "annulee") return f?.id;
  await conduire(env, a.cle, f.id, f.statut, a.etat, "facture", `${a.cle}|${a.cleFacture}`, {
    soumission: d(ds),
    approbation: d(da),
    emission: a.date,
  });
  return f.id;
}

/** Avoir total d'une facture émise : brouillon, soumission, approbation, émission à `date`. */
export async function produireAvoir(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  objetFacture: string,
  motif: string,
  date: string,
): Promise<void> {
  const origine = await trouverFacture(env, m, objetFacture);
  if (!origine) throw new Error(`Facture « ${objetFacture} » introuvable pour l'avoir.`);
  const g = session(env, cleGestionnaire(cle));
  const avoir = (
    await lire(env, "SELECT id, statut FROM factures WHERE facture_origine_id = $1", [origine.id])
  )[0];
  let statut = (avoir?.statut as string | undefined) ?? "";
  let id = avoir?.id as string | undefined;
  if (!id) {
    const cree = await etape(env, date, () =>
      appel(
        201,
        `avoir sur « ${objetFacture} »`,
        g.post(`/api/factures/${origine.id}/avoir`, { motif }),
      ),
    );
    id = cree.id as string;
    statut = "brouillon";
    env.compteurs.avoirs += 1;
  }
  await conduire(env, cle, id, statut, "emise", "avoir", `${cle}|avoir|${objetFacture}`, {
    soumission: date,
    approbation: date,
    emission: date,
  });
}

/** Identifiants des échéances d'une facture du plan (par libellé), ou undefined s'il en manque. */
export async function echeancesDe(
  env: Env,
  m: MissionLue,
  specs: readonly EcheanceSpec[],
  cles: readonly string[],
): Promise<string[] | undefined> {
  const ids: string[] = [];
  for (const k of cles) {
    const e = specs.find((x) => x.cle === k);
    const r = e
      ? await lire(
          env,
          "SELECT id FROM echeances_facturation WHERE mission_id = $1 AND libelle = $2",
          [m.id, e.libelle],
        )
      : [];
    if (!r[0]) return undefined;
    ids.push(r[0].id as string);
  }
  return ids;
}

/** Événements d'émission des factures prévues pour une mission (rang 26 : réémission après avoir). */
export function evenementsFactures(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  specs: readonly FactureSpec[],
  echeances: readonly EcheanceSpec[],
  reemissions: readonly string[],
): Evenement[] {
  return specs.map((s) => {
    const date = ouvre(env, s.date);
    return {
      date,
      rang: reemissions.includes(s.cle) ? 26 : 20,
      cle: `${cle}|facture|${s.cle}`,
      jouer: async () => {
        const ids = await echeancesDe(env, m, echeances, s.echeances);
        if (!ids) {
          env.ctx.journal(
            `facturation : échéance manquante pour « ${s.objet} » (${m.nom}), ignorée.`,
          );
          return;
        }
        await produireFacture(env, {
          cle,
          m,
          cleFacture: s.cle,
          objet: s.objet,
          date,
          etat: s.etat,
          echeanceIds: ids,
          avecDebours: s.debours === true,
        });
      },
    };
  });
}

/* ----- Régie : facturation sur temps validé ----- */

const dernierJour = (mois: string): string => {
  const [a, mo] = mois.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, mo, 0)).toISOString().slice(0, 10);
};

/**
 * Mission en régie : à chaque fin de mois révolu, les temps VALIDÉS non encore rattachés donnent
 * une échéance (route `echeancier/regie`, moteur) facturée et payée. Sans temps validé (le temps
 * est semé par un autre module), la route ne crée rien et l'événement est sans effet.
 */
export function evenementsRegie(env: Env, cle: CleMission, m: MissionLue): Evenement[] {
  if (!m.debut) return [];
  const evenements: Evenement[] = [];
  let mois = m.debut.slice(0, 7);
  for (;;) {
    const fin = dernierJour(mois);
    const date = ouvre(env, ajouterJours(fin, 4));
    if (date > env.ctx.aujourdhui || fin >= env.ctx.aujourdhui) break;
    evenements.push({
      date,
      rang: 20,
      cle: `${cle}|regie|${mois}`,
      jouer: async () => {
        const g = session(env, cleGestionnaire(cle));
        const r = await etape(env, date, () =>
          g.post(`/api/missions/${m.id}/echeancier/regie`, { jusqu_au: fin }),
        );
        ok(201, r, `échéances de régie ${mois}`);
        const elements = (corps(r).elements ?? []) as { id: string; libelle: string }[];
        for (const el of elements) {
          env.compteurs.echeances += 1;
          const id = await produireFacture(env, {
            cle,
            m,
            cleFacture: `regie-${mois}`,
            objet: `Prestations en régie : ${el.libelle}`,
            date,
            etat: "emise",
            echeanceIds: [el.id],
            avecDebours: false,
          });
          const delai = env.rng.deriver(`facturation|regie|${cle}|${mois}`).entier(12, 28);
          const paiement = plus(env, date, delai);
          if (id && paiement <= env.ctx.aujourdhui) {
            await encaisser(env, cle, m, id, `regie-${mois}`, 0, paiement, {
              jours: delai,
              part: "reste",
              mode: "virement",
            });
          }
        }
      },
    });
    mois = ajouterJours(`${mois}-01`, 32).slice(0, 7);
  }
  return evenements;
}

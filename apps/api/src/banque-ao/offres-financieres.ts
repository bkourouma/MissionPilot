import { calculerOffreFinanciere, type ResultatOffreFinanciere } from "@missionpilot/engines";
import type { OffreFinanciereEntree, offresQuerySchema } from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { lireFiche } from "../appels-offres/fiches.js";
import { curseurNumero, journal, pageParNumero, verrouEntite } from "./commun.js";
import { exigerCvUtilisable } from "./cv.js";

/*
 * Offre financière (AO-07) : calcul par le moteur pur `offre-financiere` (jours par expert,
 * taux, per diem, débours, taxes, conversion), versions en ajout seul (0383). Les taux
 * journaliers sont des données FIN-02 : les routes exigent `finance.lire` pour lire ET écrire
 * (plus `taux.gerer` pour écrire). Le calcul est figé à l'enregistrement : une version garde sa
 * saisie et son résultat ; une correction est une nouvelle version.
 */

/** Résultat du moteur au format de l'API (clés snake_case, montants en unités mineures). */
export function vueResultat(r: ResultatOffreFinanciere) {
  const ligne = (l: {
    libelle: string;
    quantite: number;
    prixUnitaire: number;
    montant: number;
  }) => ({
    libelle: l.libelle,
    quantite: l.quantite,
    prix_unitaire: l.prixUnitaire,
    montant: l.montant,
  });
  return {
    devise: r.devise,
    honoraires: r.honoraires.map((l) => ({ cle: l.cle, ...ligne(l) })),
    per_diem: r.perDiem.map(ligne),
    debours: r.debours.map(ligne),
    jours_par_expert: r.joursParExpert.map((j) => ({
      cle: j.cle,
      libelle: j.libelle,
      jours_centiemes: j.joursCentiemes,
      montant: j.montant,
    })),
    total_jours_centiemes: r.totalJoursCentiemes,
    sous_total_honoraires: r.sousTotalHonoraires,
    sous_total_per_diem: r.sousTotalPerDiem,
    sous_total_debours: r.sousTotalDebours,
    total_ht: r.totalHt,
    taxes: r.taxes.map((t) => ({
      libelle: t.libelle,
      taux: t.taux,
      assiette: t.assiette,
      base: t.base,
      montant: t.montant,
    })),
    total_taxes: r.totalTaxes,
    total_ttc: r.totalTtc,
    conversion: r.conversion
      ? {
          devise_cible: r.conversion.deviseCible,
          taux: r.conversion.taux,
          date_fixation: r.conversion.dateFixation,
          total_ht: r.conversion.totalHt,
          total_ttc: r.conversion.totalTtc,
        }
      : null,
  };
}
export type VueResultatOffre = ReturnType<typeof vueResultat>;

/** Saisie validée (schéma partagé) → calcul du moteur au format de l'API. */
export function calculerOffre(e: OffreFinanciereEntree): VueResultatOffre {
  return vueResultat(
    calculerOffreFinanciere({
      devise: e.devise,
      honoraires: e.honoraires.map((h) => ({
        cle: h.cle,
        libelle: h.libelle,
        jours: h.jours,
        tauxJournalier: h.taux_journalier,
      })),
      perDiem: e.per_diem.map((l) => ({
        libelle: l.libelle,
        quantite: l.quantite,
        prixUnitaire: l.prix_unitaire,
      })),
      debours: e.debours.map((l) => ({
        libelle: l.libelle,
        quantite: l.quantite,
        prixUnitaire: l.prix_unitaire,
      })),
      taxes: e.taxes,
      conversion: e.conversion
        ? {
            deviseCible: e.conversion.devise_cible,
            taux: e.conversion.taux,
            dateFixation: e.conversion.date_fixation,
          }
        : null,
    }),
  );
}

/** Chaque expert cité d'une saisie est un CV visible du cabinet, non anonymisé (404, 409). */
async function exigerCvDesHonoraires(db: Db, entree: OffreFinanciereEntree): Promise<void> {
  const ids = new Set(entree.honoraires.flatMap((h) => (h.cv_id ? [h.cv_id] : [])));
  for (const id of ids) await exigerCvUtilisable(db, id);
}

async function insererVersion(
  db: Db,
  auth: Auth,
  offreId: string,
  version: number,
  entree: OffreFinanciereEntree,
  motif: string | null,
): Promise<void> {
  const resultat = calculerOffre(entree);
  await db.query(
    `INSERT INTO ao_offre_financiere_versions (cabinet_id, offre_id, version, devise, entree,
       resultat, total_ht, total_ttc, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      auth.cabinetId,
      offreId,
      version,
      entree.devise,
      JSON.stringify(entree),
      JSON.stringify(resultat),
      resultat.total_ht,
      resultat.total_ttc,
      motif,
      auth.utilisateurId,
    ],
  );
}

export async function creerOffreFinanciere(
  db: Db,
  auth: Auth,
  corps: { titre: string; appel_offres_id?: string | null; entree: OffreFinanciereEntree },
): Promise<string> {
  if (corps.appel_offres_id) await lireFiche(db, corps.appel_offres_id);
  await exigerCvDesHonoraires(db, corps.entree);
  const r = await db.query(
    `INSERT INTO ao_offres_financieres (cabinet_id, appel_offres_id, titre, cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, corps.appel_offres_id ?? null, corps.titre, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, corps.entree, null);
  // Jamais les taux ni les montants dans le journal (FIN-02).
  await journal(db, auth, "creation_offre_financiere", "ao_offre_financiere", id, {
    appel_offres_id: corps.appel_offres_id ?? null,
  });
  return id;
}

export async function exigerOffreFinanciere(db: Db, id: string) {
  const r = await db.query(
    `SELECT o.id, o.numero, o.appel_offres_id, o.titre, o.cree_par, o.cree_le
     FROM ao_offres_financieres o WHERE o.id = $1`,
    [id],
  );
  const l = r.rows[0];
  if (!l) throw introuvable("Offre financière");
  return { ...l, numero: Number(l.numero) } as Record<string, unknown> & { id: string };
}

async function versionsDe(db: Db, offreId: string) {
  const r = await db.query(
    `SELECT v.id, v.version, v.devise, v.entree, v.resultat, v.motif, v.cree_par, v.cree_le
     FROM ao_offre_financiere_versions v WHERE v.offre_id = $1 ORDER BY v.version DESC`,
    [offreId],
  );
  return r.rows as {
    id: string;
    version: number;
    devise: string;
    entree: OffreFinanciereEntree;
    resultat: VueResultatOffre;
    motif: string | null;
    cree_par: string;
    cree_le: Date;
  }[];
}

export async function detailOffreFinanciere(db: Db, id: string) {
  const offre = await exigerOffreFinanciere(db, id);
  const versions = await versionsDe(db, id);
  return { ...offre, courante: versions[0] ?? null, versions };
}

export async function nouvelleVersionOffreFinanciere(
  db: Db,
  auth: Auth,
  id: string,
  entree: OffreFinanciereEntree,
  motif: string,
): Promise<void> {
  await verrouEntite(db, "offre_financiere", id);
  await exigerOffreFinanciere(db, id);
  await exigerCvDesHonoraires(db, entree);
  const suivante = ((await versionsDe(db, id))[0]?.version ?? 0) + 1;
  await insererVersion(db, auth, id, suivante, entree, motif);
  await journal(db, auth, "version_offre_financiere", "ao_offre_financiere", id, {
    version: suivante,
  });
}

export async function listerOffresFinancieres(db: Db, q: z.infer<typeof offresQuerySchema>) {
  const apres = curseurNumero(q.curseur);
  const r = await db.query(
    `SELECT o.id, o.numero, o.appel_offres_id, o.titre, o.cree_le, v.version, v.devise,
       v.total_ht, v.total_ttc
     FROM ao_offres_financieres o
     JOIN LATERAL (SELECT x.version, x.devise, x.total_ht, x.total_ttc
                   FROM ao_offre_financiere_versions x
                   WHERE x.offre_id = o.id ORDER BY x.version DESC LIMIT 1) v ON true
     WHERE ($1::uuid IS NULL OR o.appel_offres_id = $1)
       AND ($2::bigint IS NULL OR o.numero < $2)
     ORDER BY o.numero DESC
     LIMIT $3`,
    [q.appel_offres_id ?? null, apres, q.limite + 1],
  );
  const lignes = r.rows.map((l) => ({
    id: l.id as string,
    numero: Number(l.numero),
    appel_offres_id: (l.appel_offres_id as string | null) ?? null,
    titre: l.titre as string,
    version: l.version as number,
    devise: l.devise as string,
    total_ht: Number(l.total_ht),
    total_ttc: Number(l.total_ttc),
    cree_le: l.cree_le as Date,
  }));
  return pageParNumero(lignes, q.limite);
}

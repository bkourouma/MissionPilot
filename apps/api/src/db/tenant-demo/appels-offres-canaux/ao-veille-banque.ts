import {
  rapprocherVeille,
  veilleCleDedoublonnage,
  type VeilleAvisBrut,
} from "@missionpilot/engines";
import { lireProfilVeille } from "../../../appels-offres/veille.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { decisions, heure, transaction, uid } from "./ao-veille-outils.js";
import { APPELS_OFFRES_DEMO } from "./donnees-ao-liste.js";
import { SCENARIOS_AO } from "./donnees-ao-scenarios.js";
import { AO_ISSUS_DE_VEILLE } from "./donnees-ao-veille.js";
import { existe, sql } from "./outils.js";

/*
 * Appels d'offres de la banque repérés par la veille simulée : le résultat est retenu, puis
 * transformé en fiche (la fiche existe déjà, écrite par `ao-fiches`). Écrit en SQL propriétaire
 * à la date fictive (décisions en ajout seul) ; les déclencheurs MQA02 et MQA05 restent actifs.
 */
export async function resultatsDeLaBanque(ctx: ContexteTenantDemo): Promise<void> {
  for (const [cle, v] of Object.entries(AO_ISSUS_DE_VEILLE)) {
    const ao = APPELS_OFFRES_DEMO.find((x) => x.cle === cle);
    const sc = SCENARIOS_AO.find((x) => x.cle === cle);
    if (!ao || !sc) throw new Error(`Appel d'offres « ${cle} » inconnu de la liste.`);
    const fiche = (
      await sql<{ id: string }>(
        ctx,
        "SELECT id FROM appels_offres WHERE cabinet_id = $1 AND reference = $2",
        [ctx.cabinetId, ao.reference],
      )
    )[0];
    if (!fiche) {
      throw new Error(`Fiche ${ao.reference} absente : le module ao-fiches doit passer d'abord.`);
    }
    const avis: VeilleAvisBrut = {
      reference: ao.reference,
      titre: ao.titre,
      objet: ao.objet,
      bailleur: ao.bailleur,
      pays: ao.pays,
      secteur: ao.secteur,
      montant_estime: ao.montant_estime,
      devise: ao.devise,
      date_publication: ao.date_publication,
      date_limite: ao.date_limite,
      url: `https://avis.exemple.invalid/${ao.reference}`,
      mots_cles: [...ao.mots_cles],
    };
    const cleAvis = veilleCleDedoublonnage(avis);
    const present = await existe(
      ctx,
      "SELECT 1 FROM ao_veille_resultats WHERE cabinet_id = $1 AND cle = $2",
      [ctx.cabinetId, cleAvis],
    );
    if (present) continue;
    const profil = await ctx.database.withTenant(ctx.cabinetId, (db) => lireProfilVeille(db));
    const rap = rapprocherVeille(avis, profil);
    const explique: Record<string, unknown> = { ...rap };
    delete explique.rapprochement;
    await transaction(ctx, async () => {
      const r = await ctx.proprietaire.query(
        `INSERT INTO ao_veille_resultats (cabinet_id, cle, reference, titre, objet, bailleur, pays,
           secteur, montant_estime, devise, date_publication, date_limite, url, mots_cles,
           score_rapprochement, rapprochement, cree_le, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
           $17::timestamptz, $17::timestamptz) RETURNING id`,
        [
          ctx.cabinetId,
          cleAvis,
          avis.reference,
          avis.titre,
          avis.objet,
          avis.bailleur,
          avis.pays,
          avis.secteur,
          avis.montant_estime,
          avis.devise,
          avis.date_publication,
          avis.date_limite,
          avis.url,
          avis.mots_cles,
          rap.score,
          JSON.stringify(explique),
          heure(v.jourVu, "08:00"),
        ],
      );
      const id = r.rows[0].id as string;
      await ctx.proprietaire.query(
        `INSERT INTO ao_veille_occurrences (cabinet_id, resultat_id, source_code, source_libelle,
           jour, vu_le, cree_par) VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7)`,
        [
          ctx.cabinetId,
          id,
          v.source.code,
          v.source.libelle,
          v.jourVu,
          heure(v.jourVu, "08:00"),
          uid(ctx, "chef.mission"),
        ],
      );
      await decisions(ctx, id, [
        {
          decision: "retenir",
          jour: v.retenuLe,
          auteur: sc.createur === "chef.mission" ? "directeur.mission" : "chef.mission",
          motif: null,
        },
      ]);
      // Création de la fiche : décision `creer_fiche` citant la fiche de la banque d'AO.
      const quand = heure(v.ficheLe, "09:30");
      await ctx.proprietaire.query(
        `INSERT INTO ao_veille_decisions (cabinet_id, resultat_id, decision, fiche_id, auteur_id,
           cree_le) VALUES ($1, $2, 'creer_fiche', $3, $4, $5::timestamptz)`,
        [ctx.cabinetId, id, fiche.id, uid(ctx, sc.createur), quand],
      );
      await ctx.proprietaire.query(
        `UPDATE ao_veille_resultats SET statut = 'fiche_creee', fiche_id = $2,
           modifie_le = $3::timestamptz WHERE id = $1`,
        [id, fiche.id, quand],
      );
    });
  }
}

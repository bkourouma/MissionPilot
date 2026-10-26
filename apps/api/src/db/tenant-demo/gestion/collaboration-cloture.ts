import { ajouterJours } from "@missionpilot/engines";
import { CONTROLE_CLOTURE_DEFAUTS, type ControleCloture } from "@missionpilot/shared";
import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS_EN_COURS, MISSIONS_TERMINEES, type Casting } from "./casting.js";
import { ancrer, encadrer, heureISO, sansDeclencheurs } from "./collaboration-outils.js";
import { ok } from "./outils.js";

/*
 * CHECK-LIST DE CLÔTURE du cabinet (AUT-08, migrations 0320 et 0322) : modèle paramétré par
 * l'associé (`PUT /api/cloture/modele`) et dérogations accordées par un directeur de mission
 * (`POST /api/missions/:id/cloture/derogations`).
 *
 * GARDE-FOU : la phase clôt ensuite les 5 missions terminées (`cloturerMissionsTerminees`) ; ce
 * modèle ne rend donc bloquant AUCUN contrôle qui ne le soit déjà par défaut (`CONTROLE_CLOTURE_
 * DEFAUTS`) : il active seulement, en avertissement, la satisfaction et la capitalisation, et garde
 * les encaissements soldés non bloquants. La dérogation ne vise qu'une mission EN COURS ; elle est
 * accordée par son directeur (séparation des tâches MPX03 : il ne clôturera pas lui-même).
 */

const MODELE: readonly { controle: ControleCloture; actif: boolean; bloquant: boolean }[] = [
  { controle: "temps_valides", actif: true, bloquant: true },
  { controle: "debours_traites", actif: true, bloquant: true },
  { controle: "factures_emises", actif: true, bloquant: true },
  { controle: "livrables_signes", actif: true, bloquant: true },
  { controle: "encaissements_soldes", actif: true, bloquant: false },
  { controle: "satisfaction_demandee", actif: true, bloquant: false },
  { controle: "capitalisation_faite", actif: true, bloquant: false },
];

const MOTIFS: Partial<Record<ControleCloture, string>> = {
  livrables_signes:
    "Livrable intermédiaire en attente de la signature du client ; dérogation accordée pour la revue de mi-parcours, la clôture reste conditionnée à la signature.",
  temps_valides:
    "Feuilles du mois en cours en attente de validation par les chefs de mission ; dérogation limitée à la revue de mi-parcours.",
  debours_traites:
    "Débours de déplacement en attente des justificatifs ; dérogation temporaire pour la revue de mi-parcours.",
  factures_emises:
    "Échéance de facturation suspendue à la validation du livrable par le client ; dérogation limitée à la revue de mi-parcours.",
};

const JOUR_MODELE = "2025-01-27";

/** Modèle du cabinet, une fois (idempotent : un modèle déjà enregistré n'est pas rejoué). */
async function parametrerModele(ctx: ContexteTenantDemo): Promise<void> {
  const n = await ctx.proprietaire.query(
    "SELECT count(*)::int AS n FROM cloture_modele_items WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  if ((n.rows[0].n as number) > 0) {
    ctx.journal("  clôture : modèle déjà paramétré.");
    return;
  }
  const { fenetre } = await encadrer(ctx, async () => {
    ok(
      200,
      await ctx.session("associe").put("/api/cloture/modele", { items: MODELE }),
      "modèle de clôture",
    );
  });
  const instant = heureISO(JOUR_MODELE, 10, 20);
  await ancrer(ctx, fenetre, instant, true);
  await sansDeclencheurs(ctx, async (c) => {
    await c.query(
      "UPDATE cloture_modele_items SET modifie_le = $2::timestamptz WHERE cabinet_id = $1",
      [ctx.cabinetId, instant],
    );
  });
  ctx.journal("  clôture : modèle de check-list enregistré (7 contrôles).");
}

interface ItemLu {
  controle: ControleCloture;
  etat: string;
  bloquant: boolean;
}

async function lireEtat(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<{ autorisee: boolean; items: ItemLu[] }> {
  const r = await ctx.session("associe").get(`/api/missions/${missionId}/cloture`);
  ok(200, r, "état de clôture");
  return r.json() as { autorisee: boolean; items: ItemLu[] };
}

/** Une dérogation accordée par le directeur sur un contrôle bloquant d'une mission en cours. */
async function deroger(ctx: ContexteTenantDemo, casting: Casting): Promise<number> {
  const jour = ajouterJours(ctx.aujourdhui, -9);
  for (const cle of [...MISSIONS_EN_COURS]) {
    const m = casting.missions[cle];
    if (!m || !m.directeurId) continue;
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM cloture_derogations WHERE cabinet_id = $1 AND mission_id = $2",
      [ctx.cabinetId, m.id],
    );
    if ((deja.rowCount ?? 0) > 0) return 0; // déjà fait lors d'une exécution précédente
    const etat = await lireEtat(ctx, m.id);
    const cible = etat.items.find((i) => i.bloquant && i.etat === "bloque");
    if (!cible) continue;
    const directeur = Object.entries(ctx.utilisateurs).find(([, id]) => id === m.directeurId)?.[0];
    if (!directeur) continue;
    const s = ctx.session(directeur as never);
    const { fenetre } = await encadrer(ctx, async () => {
      ok(
        201,
        await s.post(`/api/missions/${m.id}/cloture/derogations`, {
          controle: cible.controle,
          motif:
            MOTIFS[cible.controle] ??
            "Contrôle en attente de pièces du client ; dérogation limitée à la revue de mi-parcours.",
        }),
        `dérogation de clôture (${cle})`,
      );
    });
    const instant = heureISO(jour, 16, 5);
    await ancrer(ctx, fenetre, instant, true);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        "UPDATE cloture_derogations SET le = $3::timestamptz WHERE cabinet_id = $1 AND mission_id = $2",
        [ctx.cabinetId, m.id, instant],
      );
    });
    ctx.journal(`  clôture : dérogation « ${cible.controle} » accordée sur ${cle}.`);
    return 1;
  }
  ctx.journal(
    "  clôture : aucune mission en cours n'a de contrôle bloquant non conforme (aucune dérogation).",
  );
  return 0;
}

/** Les missions terminées doivent rester clôturables : le modèle n'ajoute aucun contrôle bloquant. */
async function verifierTerminees(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  for (const cle of MISSIONS_TERMINEES) {
    const m = casting.missions[cle];
    if (!m || m.statut === "cloturee") continue;
    const etat = await lireEtat(ctx, m.id);
    const nouveaux = etat.items.filter(
      (i) => i.bloquant && !CONTROLE_CLOTURE_DEFAUTS[i.controle].bloquant,
    );
    if (nouveaux.length > 0) {
      throw new Error(
        `Le modèle de clôture rend bloquant ${nouveaux.map((i) => i.controle).join(", ")} sur ${cle} : refusé.`,
      );
    }
    const bloques = etat.items.filter((i) => i.etat === "bloque").map((i) => i.controle);
    ctx.journal(
      `  clôture ${cle} : ${etat.autorisee ? "autorisée" : `bloquée par ${bloques.join(", ")} (autres modules)`}.`,
    );
  }
}

/** Attestation de capitalisation par le chef de mission, une fois la mission terminée. */
async function attesterCapitalisation(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  for (const cle of MISSIONS_TERMINEES) {
    const m = casting.missions[cle];
    if (!m || m.statut === "cloturee" || !m.chefId || !m.fin) continue;
    const deja = await ctx.proprietaire.query(
      `SELECT 1 FROM cloture_verifications WHERE cabinet_id = $1 AND mission_id = $2
          AND origine = 'attestation'`,
      [ctx.cabinetId, m.id],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const chef = Object.entries(ctx.utilisateurs).find(([, id]) => id === m.chefId)?.[0];
    if (!chef) continue;
    const { fenetre } = await encadrer(ctx, async () => {
      const r = await ctx
        .session(chef as never)
        .post(`/api/missions/${m.id}/cloture/attestations`, {
          controle: "capitalisation_faite",
          attestee: true,
          note: "Enseignements capitalisés dans la base de connaissances du cabinet.",
        });
      ok(201, r, `attestation de capitalisation (${cle})`);
    });
    const instant = heureISO(ajouterJours(m.fin, 4), 11, 10);
    await ancrer(ctx, fenetre, instant, true);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        `UPDATE cloture_verifications SET verifie_le = $3::timestamptz
          WHERE cabinet_id = $1 AND mission_id = $2 AND origine = 'attestation'`,
        [ctx.cabinetId, m.id, instant],
      );
    });
  }
}

export async function semerCloture(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  await parametrerModele(ctx);
  await deroger(ctx, casting);
  await attesterCapitalisation(ctx, casting);
  await verifierTerminees(ctx, casting);
}

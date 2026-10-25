import type { EtapeGarde } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import type { Alea } from "../horloge.js";
import type { SuiviSpec } from "./qualite-donnees.js";
import type { Chrono, Acteur } from "./qualite-outils.js";

/*
 * Écritures élémentaires de l'historique d'un suivi qualité (SQL paramétré du rôle propriétaire, tables
 * en dur, chaque ligne datée) : événements, statut, éléments de revue, vérifications, sessions et
 * parcours. Utilisées par `qualite-historique.ts`.
 */

export const COMMENTAIRES: Partial<Record<EtapeGarde, string[]>> = {
  validation_auteur: ["Contenu relu par son auteur avant diffusion."],
  validation_consultant: [
    "Contenu relu, conforme aux travaux réalisés pendant la mission.",
    "Je prends la responsabilité du livrable après relecture des pièces.",
  ],
  relecture_chef_mission: [
    "Relecture du chef de mission : points de détail corrigés avant validation.",
    "Cohérence d'ensemble vérifiée avec le calendrier et le périmètre de la mission.",
  ],
  revue_second_expert: [
    "Revue indépendante : cohérence des chiffres vérifiée à partir des documents sources.",
    "Second regard sur les hypothèses : aucune réserve bloquante.",
  ],
  signature_directeur_mission: ["Livrable validé, signé avant remise au client."],
};

export const ATTESTATIONS: Record<string, string> = {
  chiffres_rapproches:
    "Chiffres rapprochés des balances et des relevés bancaires remis par le client.",
  hypotheses_documentees:
    "Hypothèses consignées dans la note méthodologique du dossier de mission.",
  retraitements_documentes: "Retraitements justifiés pièce par pièce dans le classeur de travail.",
};

export interface ElementEcrit {
  id: string;
  cle: string;
  kind: string;
  libelle: string;
  source: string | null;
}

export interface Contexte {
  ctx: ContexteTenantDemo;
  suiviId: string;
  chrono: Chrono;
  alea: Alea;
}

export async function evenement(
  { ctx, suiviId }: Contexte,
  action: string,
  details: Record<string, unknown>,
  par: Acteur,
  le: string,
): Promise<void> {
  await ctx.proprietaire.query(
    `INSERT INTO qualite_evenements (cabinet_id, suivi_id, rang, action, details, par, le)
     SELECT $1, $2, COALESCE(MAX(rang), 0) + 1, $3, $4::jsonb, $5, $6
       FROM qualite_evenements WHERE suivi_id = $2`,
    [ctx.cabinetId, suiviId, action, JSON.stringify(details), par.id, le],
  );
}

export async function statut(c: Contexte, vers: string, le: string): Promise<void> {
  await c.ctx.proprietaire.query(
    "UPDATE qualite_suivis SET statut = $2, modifie_le = $3 WHERE id = $1",
    [c.suiviId, vers, le],
  );
}

export async function deposer(
  c: Contexte,
  spec: SuiviSpec,
  par: Acteur,
  modeles: { kind: string; libelle: string; source?: string }[],
  decalage: number,
): Promise<ElementEcrit[]> {
  const ecrits: ElementEcrit[] = [];
  let i = decalage;
  for (const m of modeles) {
    const cle = `${spec.cle}:${m.kind}:${i}`;
    const source = m.source ?? null;
    const r = await c.ctx.proprietaire.query<{ id: string }>(
      `INSERT INTO qualite_revue_elements
         (cabinet_id, suivi_id, cle, kind, libelle, ordre, obligatoire, source, source_type, cree_par, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10) RETURNING id`,
      [
        c.ctx.cabinetId,
        c.suiviId,
        cle,
        m.kind,
        m.libelle,
        i * 10,
        source,
        source ? "moteur" : null,
        par.id,
        c.chrono.decale(i - decalage),
      ],
    );
    ecrits.push({ id: r.rows[0]!.id, cle, kind: m.kind, libelle: m.libelle, source });
    i++;
  }
  return ecrits;
}

export async function verification(
  c: Contexte,
  itemId: string,
  rang: number,
  statutV: "conforme" | "non_conforme" | "non_evaluable",
  detail: string | null,
  le: string,
): Promise<void> {
  await c.ctx.proprietaire.query(
    `INSERT INTO qualite_verifications (cabinet_id, suivi_id, item_id, rang, statut, detail, le)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.ctx.cabinetId, c.suiviId, itemId, rang, statutV, detail, le],
  );
}

/** Session de revue d'un relecteur et éléments parcourus (tous, ou le début de la liste). */
export async function parcours(
  c: Contexte,
  acteur: Acteur,
  elements: ElementEcrit[],
  part: number,
): Promise<void> {
  const duree = 25 + c.alea.entier(0, 65);
  const fin = c.chrono.iso();
  const debut = c.chrono.decale(-duree);
  const vus = elements.slice(0, Math.max(1, Math.ceil(elements.length * part)));
  await c.ctx.proprietaire.query(
    `INSERT INTO qualite_revue_sessions (cabinet_id, suivi_id, utilisateur_id, debut, fin, duree_secondes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.ctx.cabinetId, c.suiviId, acteur.id, debut, fin, duree * 60],
  );
  for (const [k, e] of vus.entries()) {
    await c.ctx.proprietaire.query(
      `INSERT INTO qualite_revue_vus (cabinet_id, suivi_id, element_id, utilisateur_id, vu_le)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (element_id, utilisateur_id) DO NOTHING`,
      [
        c.ctx.cabinetId,
        c.suiviId,
        e.id,
        acteur.id,
        c.chrono.decale(-duree + Math.floor(((k + 1) * duree) / (vus.length + 1))),
      ],
    );
  }
}

import type { ContexteTenantDemo } from "../contexte.js";
import { ECHELLE_ITEM, ITEMS, type DefItem } from "./notation-referentiels-items.js";
import { exiger, lire } from "./outils.js";

/*
 * Banque d'items de notation (NOT-09) : un item est rédigé en brouillon par un consultant ou un
 * chef de mission, puis validé par un expert métier qui n'en est ni l'auteur ni le dernier
 * modificateur (route /notation/banque/:id/valider). Certains items restent en brouillon
 * (relecture en attente) ; deux items validés ont une version 2 ouverte en brouillon.
 * Idempotent : la clé naturelle est le code de l'item et son numéro de version.
 */

const majuscule = (texte: string): string => texte.charAt(0).toUpperCase() + texte.slice(1);

export const codeItem = (def: DefItem): string => `item.${def.pratique}`;

/** Contenu d'un item au format du moteur (ancrages comportementaux par niveau, STD-09). */
export function contenuItem(def: DefItem, intitule: string = def.intitule) {
  const n = def.nom;
  return {
    code: codeItem(def),
    dimension: def.dimension,
    pratique: def.pratique,
    intitule,
    echelle: { niveaux: 5, libelles: [...ECHELLE_ITEM] },
    ancrages: [
      { niveau: 1, comportement: `Aucune démarche pour ${n}.` },
      {
        niveau: 2,
        comportement: `${majuscule(n)} existe de façon ponctuelle, sans règle écrite, et dépend de quelques personnes.`,
      },
      {
        niveau: 3,
        comportement: `${majuscule(n)} est formalisé et appliqué dans une partie de l'entreprise.`,
      },
      {
        niveau: 4,
        comportement: `${majuscule(n)} est systématique, suivi par des indicateurs et revu régulièrement.`,
      },
      {
        niveau: 5,
        comportement: `${majuscule(n)} est mesuré, amélioré en continu et partagé avec les équipes.`,
      },
    ],
    formulations: [
      { public: "tous", texte: def.question },
      { public: def.public, texte: def.questionPublic },
    ],
    poids: def.poids,
    priorite: def.priorite,
    dureeSecondes: def.dureeSecondes,
  };
}

interface LigneItem extends Record<string, unknown> {
  id: string;
  version: number;
  statut: string;
}

async function versions(ctx: ContexteTenantDemo, code: string): Promise<LigneItem[]> {
  return lire<LigneItem>(
    ctx,
    "SELECT id, version, statut FROM notation_banque_items WHERE cabinet_id = $1 AND code = $2 ORDER BY version",
    [ctx.cabinetId, code],
  );
}

export async function semerBanqueItems(ctx: ContexteTenantDemo): Promise<void> {
  let crees = 0;
  for (const def of ITEMS) {
    const code = codeItem(def);
    let lignes = await versions(ctx, code);
    if (lignes.length === 0) {
      const r = await ctx
        .session(def.auteur)
        .post("/api/notation/banque", { contenu: contenuItem(def) });
      exiger(r, 201, `Item ${code}`);
      crees++;
      lignes = await versions(ctx, code);
    }
    const v1 = lignes.find((l) => l.version === 1);
    if (def.valideur && v1?.statut === "brouillon") {
      const r = await ctx.session(def.valideur).post(`/api/notation/banque/${v1.id}/valider`);
      exiger(r, 200, `Validation de l'item ${code}`);
    }
    if (def.versionSuivante && !lignes.some((l) => l.version === 2)) {
      const r = await ctx
        .session(def.versionSuivante.auteur)
        .post("/api/notation/banque", { contenu: contenuItem(def, def.versionSuivante.intitule) });
      exiger(r, 201, `Version 2 de l'item ${code}`);
    }
  }
  ctx.journal(`    banque d'items : ${crees} item(s) créé(s), ${ITEMS.length} au total`);
}

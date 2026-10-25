import { DEFINITIONS_PAR_DEFAUT } from "../../../qualite/definitions.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { compterLignes } from "./commun.js";
import { DEFINITION_ETAT_V2, DEFINITIONS_AMORCEES } from "./qualite-donnees.js";
import { acteur, transaction } from "./qualite-outils.js";
import type { Definitions } from "./qualite-historique.js";

/*
 * Définitions de « terminé » (QUA-02, ajout seul) : version 1 de l'état financier à la première
 * ouverture d'un suivi de ce type, version 2 (un item de plus) révisée par un associé, et les
 * définitions par défaut des types lus par d'autres modules (plan, notation, rapport), copiées de
 * `DEFINITIONS_PAR_DEFAUT` à la date de leur première utilisation. Les tables étant en ajout seul,
 * chaque définition naît avec sa date. Idempotent par (type, version).
 */

type TypeAvecDefinition = "etat" | "plan" | "notation" | "rapport";

async function creer(
  ctx: ContexteTenantDemo,
  type: TypeAvecDefinition,
  version: number,
  libelle: string,
  items: {
    code: string;
    libelle: string;
    controle: string;
    obligatoire: boolean;
    parametres: Record<string, unknown>;
  }[],
  quand: string,
  par: string | null,
): Promise<void> {
  if (
    (await compterLignes(
      ctx,
      "SELECT count(*) AS n FROM qualite_definitions WHERE type_livrable = $1 AND version = $2",
      [type, version],
    )) > 0
  ) {
    return;
  }
  await transaction(ctx, async () => {
    const d = await ctx.proprietaire.query<{ id: string }>(
      `INSERT INTO qualite_definitions (cabinet_id, type_livrable, version, libelle, cree_par, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ctx.cabinetId, type, version, libelle, par, quand],
    );
    let ordre = 0;
    for (const i of items) {
      ordre += 10;
      await ctx.proprietaire.query(
        `INSERT INTO qualite_definition_items
           (cabinet_id, definition_id, code, libelle, controle, obligatoire, ordre, parametres)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          ctx.cabinetId,
          d.rows[0]!.id,
          i.code,
          i.libelle,
          i.controle,
          i.obligatoire,
          ordre,
          JSON.stringify(i.parametres),
        ],
      );
    }
  });
}

/** `premierEtat` : jour de la première ouverture d'un suivi « état financier » (la définition naît avant). */
export async function semerDefinitions(
  ctx: ContexteTenantDemo,
  premierEtat: string,
): Promise<Definitions> {
  const etat = DEFINITIONS_PAR_DEFAUT.etat;
  if (!etat) throw new Error("Définition par défaut de l'état financier absente.");
  await creer(ctx, "etat", 1, etat.libelle, etat.items, `${premierEtat}T07:15:00Z`, null);
  await creer(
    ctx,
    "etat",
    2,
    etat.libelle,
    [
      ...etat.items,
      { ...DEFINITION_ETAT_V2.item, controle: "manuel", obligatoire: true, parametres: {} },
    ],
    `${DEFINITION_ETAT_V2.date}T10:20:00Z`,
    acteur(ctx, "associe").id,
  );
  for (const a of DEFINITIONS_AMORCEES) {
    const d = DEFINITIONS_PAR_DEFAUT[a.type];
    if (!d) continue;
    const deja = await compterLignes(
      ctx,
      "SELECT count(*) AS n FROM qualite_definitions WHERE type_livrable = $1",
      [a.type],
    );
    if (deja === 0) await creer(ctx, a.type, 1, d.libelle, d.items, `${a.date}T07:30:00Z`, null);
  }
  return {
    etat: async (iso) => {
      const r = await ctx.proprietaire.query<{ id: string }>(
        `SELECT id FROM qualite_definitions WHERE type_livrable = 'etat' AND cree_le <= $1
          ORDER BY version DESC LIMIT 1`,
        [iso],
      );
      const id =
        r.rows[0]?.id ??
        (
          await ctx.proprietaire.query<{ id: string }>(
            "SELECT id FROM qualite_definitions WHERE type_livrable = 'etat' ORDER BY version LIMIT 1",
          )
        ).rows[0]?.id;
      if (!id) throw new Error("Aucune définition « état financier » disponible.");
      const items = await ctx.proprietaire.query<{ id: string; code: string; controle: string }>(
        "SELECT id, code, controle FROM qualite_definition_items WHERE definition_id = $1 ORDER BY ordre, code",
        [id],
      );
      return { id, items: items.rows };
    },
  };
}

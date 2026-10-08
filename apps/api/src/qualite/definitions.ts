import type { TypeLivrable } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/*
 * Définition de terminé par type de livrable (QUA-02). Les définitions PAR DÉFAUT sont dans ce
 * fichier ; elles sont copiées dans les tables du cabinet (`qualite_definitions`, 0281) à la
 * première ouverture d'un suivi du type, et versionnées en ajout seul. Un item est contrôlé par
 * du code déterministe (`enregistrement`, `statut_source`, `sections`, `chiffres_traces`) ou
 * attesté par le relecteur (`manuel`). L'agent IA qualité (lot AGT) viendra COMPLÉTER ces contrôles,
 * jamais les remplacer : un item contrôlé par le code ne se satisfait pas par une réponse du modèle.
 */

export type ControleItem =
  "enregistrement" | "statut_source" | "sections" | "chiffres_traces" | "manuel";

export interface ItemDefinition {
  code: string;
  libelle: string;
  controle: ControleItem;
  obligatoire: boolean;
  parametres: Record<string, unknown>;
}

interface DefinitionDefaut {
  libelle: string;
  items: ItemDefinition[];
}

const item = (
  code: string,
  libelle: string,
  controle: ControleItem,
  parametres: Record<string, unknown> = {},
  obligatoire = true,
): ItemDefinition => ({ code, libelle, controle, obligatoire, parametres });

export const SECTIONS_PLAN = [
  "diagnostic",
  "swot",
  "vision_mission",
  "axe",
  "objectif",
  "initiative",
] as const;

export const DEFINITIONS_PAR_DEFAUT: Record<TypeLivrable, DefinitionDefaut | null> = {
  rapport: {
    libelle: "Rapport de mission terminé",
    items: [
      item(
        "rapport_enregistre",
        "Le rapport est enregistré dans le dossier de la mission",
        "enregistrement",
      ),
      item("rapport_valide", "Le contenu du rapport est validé", "statut_source", {
        attendu: ["valide"],
      }),
      item(
        "chiffres_traces",
        "Chaque chiffre du rapport cite sa source ou son moteur de calcul",
        "chiffres_traces",
      ),
      item(
        "mention_ia",
        "La mention de contribution de l'IA est conforme à la politique du cabinet",
        "manuel",
      ),
    ],
  },
  notation: {
    libelle: "Notation publiée terminée",
    items: [
      item(
        "notation_enregistree",
        "La version de la notation existe pour cette mission",
        "enregistrement",
      ),
      item("notation_publiee", "La version est publiée", "statut_source", { attendu: ["publiee"] }),
      item("sections_notation", "Le résultat du calcul est présent", "sections", {
        sections: ["resultat"],
      }),
      item("chiffres_traces", "Chaque score cite son calcul et ses réponses", "chiffres_traces"),
      item("ajustements_motives", "Les ajustements éventuels sont motivés et justifiés", "manuel"),
    ],
  },
  plan: {
    libelle: "Plan stratégique terminé",
    items: [
      item("plan_enregistre", "Le plan existe pour cette mission", "enregistrement"),
      item("plan_valide", "Tous les éléments du plan sont validés", "statut_source", {
        attendu: ["valide"],
      }),
      item(
        "sections_plan",
        "Diagnostic, SWOT, vision, axes, objectifs et initiatives sont présents",
        "sections",
        {
          sections: [...SECTIONS_PLAN],
        },
      ),
      item(
        "chiffres_traces",
        "Chaque chiffre du plan cite sa source ou son moteur de calcul",
        "chiffres_traces",
      ),
      item(
        "recommandations_relues",
        "Les recommandations sont cohérentes avec le diagnostic",
        "manuel",
      ),
    ],
  },
  questionnaire: {
    libelle: "Questionnaire terminé",
    items: [
      item(
        "questionnaire_enregistre",
        "Le questionnaire existe pour cette mission",
        "enregistrement",
      ),
      item("questions_relues", "Les questions sont relues et adaptées au client", "manuel"),
    ],
  },
  etat: {
    libelle: "État financier terminé",
    items: [
      item("chiffres_traces", "Chaque chiffre de l'état cite sa source", "chiffres_traces"),
      item("chiffres_rapproches", "Les chiffres sont rapprochés des pièces du client", "manuel"),
      item("hypotheses_documentees", "Les hypothèses retenues sont documentées", "manuel"),
    ],
  },
  autre: null,
};

export interface DefinitionCharge {
  id: string;
  type_livrable: string;
  version: number;
  libelle: string;
  items: (ItemDefinition & { id: string; ordre: number })[];
}

export async function chargerDefinition(db: Db, id: string): Promise<DefinitionCharge | null> {
  const d = await db.query(
    "SELECT id, type_livrable, version, libelle FROM qualite_definitions WHERE id = $1",
    [id],
  );
  if (!d.rows[0]) return null;
  const items = await db.query(
    `SELECT id, code, libelle, controle, obligatoire, ordre, parametres
     FROM qualite_definition_items WHERE definition_id = $1 ORDER BY ordre, code`,
    [id],
  );
  return { ...(d.rows[0] as Omit<DefinitionCharge, "items">), items: items.rows };
}

/** Définition en vigueur pour le type (version la plus récente), amorcée au besoin ; null : aucune. */
export async function definitionEnVigueur(
  db: Db,
  cabinetId: string,
  type: TypeLivrable,
): Promise<DefinitionCharge | null> {
  const defaut = DEFINITIONS_PAR_DEFAUT[type];
  const existante = await db.query(
    `SELECT id FROM qualite_definitions WHERE type_livrable = $1 ORDER BY version DESC LIMIT 1`,
    [type],
  );
  if (existante.rows[0]) return chargerDefinition(db, existante.rows[0].id as string);
  if (!defaut) return null;
  const cree = await db.query(
    `INSERT INTO qualite_definitions (cabinet_id, type_livrable, version, libelle)
     VALUES ($1, $2, 1, $3) ON CONFLICT (cabinet_id, type_livrable, version) DO NOTHING RETURNING id`,
    [cabinetId, type, defaut.libelle],
  );
  const id = cree.rows[0]?.id as string | undefined;
  if (!id) {
    // Amorçage concurrent : l'autre transaction a validé la définition et ses items.
    const relue = await db.query(
      "SELECT id FROM qualite_definitions WHERE type_livrable = $1 ORDER BY version DESC LIMIT 1",
      [type],
    );
    return chargerDefinition(db, relue.rows[0].id as string);
  }
  let ordre = 0;
  for (const i of defaut.items) {
    ordre += 10;
    await db.query(
      `INSERT INTO qualite_definition_items
         (cabinet_id, definition_id, code, libelle, controle, obligatoire, ordre, parametres)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        cabinetId,
        id,
        i.code,
        i.libelle,
        i.controle,
        i.obligatoire,
        ordre,
        JSON.stringify(i.parametres),
      ],
    );
  }
  return chargerDefinition(db, id);
}

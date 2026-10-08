import type { StatutVerification } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import { ajouterEvenement, changerStatut, type Suivi } from "./donnees.js";
import { chargerDefinition, type DefinitionCharge } from "./definitions.js";
import { lireContenuLivrable, type ContenuLivrable } from "./contenu.js";
import { abreger } from "./texte.js";

/*
 * Vérification de la définition de terminé (QUA-02), RÉALISÉE PAR DU CODE DÉTERMINISTE : présence
 * des sections, statut de validation du contenu source, chiffres tracés, enregistrement du
 * livrable. Un item que le code ne sait pas trancher est « non_evaluable » : il ne se règle que par
 * l'attestation motivée d'un humain. Chaque résultat est une ligne en ajout seul ; le résultat en
 * vigueur d'un item est le dernier. La vérification est la porte d'entrée de la revue humaine :
 * elle fait passer un suivi de « brouillon » à « en revue ».
 */

export interface EtatItem {
  id: string;
  code: string;
  libelle: string;
  controle: string;
  obligatoire: boolean;
  statut: StatutVerification | "en_attente";
  detail: string | null;
  par: string | null;
  le: Date | null;
  satisfait: boolean;
}

export interface EtatDefinition {
  definition_id: string | null;
  libelle: string | null;
  version: number | null;
  items: EtatItem[];
  /** Tous les items obligatoires sont conformes ou attestés (vrai s'il n'y a aucune définition). */
  satisfaite: boolean;
  bloquants: string[];
}

const SATISFAIT: readonly string[] = ["conforme", "atteste"];

export async function etatDefinition(db: Db, suivi: Suivi): Promise<EtatDefinition> {
  if (!suivi.definition_id) {
    return {
      definition_id: null,
      libelle: null,
      version: null,
      items: [],
      satisfaite: true,
      bloquants: [],
    };
  }
  const def = await chargerDefinition(db, suivi.definition_id);
  if (!def) {
    return {
      definition_id: null,
      libelle: null,
      version: null,
      items: [],
      satisfaite: true,
      bloquants: [],
    };
  }
  const v = await db.query(
    `SELECT DISTINCT ON (item_id) item_id, statut, detail, par, le
     FROM qualite_verifications WHERE suivi_id = $1 ORDER BY item_id, rang DESC`,
    [suivi.id],
  );
  const dernier = new Map(v.rows.map((l) => [l.item_id as string, l]));
  const items: EtatItem[] = def.items.map((i) => {
    const l = dernier.get(i.id);
    const statut = (l?.statut as StatutVerification | undefined) ?? "en_attente";
    return {
      id: i.id,
      code: i.code,
      libelle: i.libelle,
      controle: i.controle,
      obligatoire: i.obligatoire,
      statut,
      detail: (l?.detail as string | null | undefined) ?? null,
      par: (l?.par as string | null | undefined) ?? null,
      le: (l?.le as Date | undefined) ?? null,
      satisfait: SATISFAIT.includes(statut),
    };
  });
  const bloquants = items.filter((i) => i.obligatoire && !i.satisfait).map((i) => i.code);
  return {
    definition_id: def.id,
    libelle: def.libelle,
    version: def.version,
    items,
    satisfaite: bloquants.length === 0,
    bloquants,
  };
}

interface Resultat {
  statut: StatutVerification;
  detail: string | null;
}

interface ChiffreRevue {
  libelle: string;
  /** Source RÉSOLUE par le serveur (`moteur`, `preuve`) ; un texte libre ne trace pas un chiffre. */
  source_type: string | null;
}

const NON_EVALUABLE = (detail: string): Resultat => ({ statut: "non_evaluable", detail });

function controler(
  item: DefinitionCharge["items"][number],
  contenu: ContenuLivrable | null,
  chiffres: ChiffreRevue[],
): Resultat {
  switch (item.controle) {
    case "enregistrement":
      if (!contenu)
        return { statut: "non_conforme", detail: "Livrable introuvable dans la mission." };
      return contenu.resolu
        ? { statut: "conforme", detail: null }
        : NON_EVALUABLE("Le module qualité ne lit pas ce type de livrable.");
    case "statut_source": {
      if (!contenu?.resolu || contenu.statutSource === null) {
        return NON_EVALUABLE("Statut de validation du contenu inconnu.");
      }
      const attendu = (item.parametres.attendu as string[] | undefined) ?? [];
      return attendu.includes(contenu.statutSource)
        ? { statut: "conforme", detail: null }
        : {
            statut: "non_conforme",
            detail: `Statut du contenu « ${contenu.statutSource} » ; attendu : ${attendu.join(", ")}.`,
          };
    }
    case "sections": {
      if (!contenu?.resolu || contenu.sections === null) {
        return NON_EVALUABLE("Les sections du contenu ne sont pas lisibles.");
      }
      const attendues = (item.parametres.sections as string[] | undefined) ?? [];
      const presentes = new Set(contenu.sections);
      const absentes = attendues.filter((s) => !presentes.has(s));
      return absentes.length === 0
        ? { statut: "conforme", detail: null }
        : { statut: "non_conforme", detail: `Sections absentes : ${absentes.join(", ")}.` };
    }
    case "chiffres_traces": {
      if (chiffres.length === 0) {
        return NON_EVALUABLE("Aucun chiffre déposé dans la revue guidée : à attester.");
      }
      const sansSource = chiffres.filter((c) => !c.source_type);
      return sansSource.length === 0
        ? { statut: "conforme", detail: null }
        : {
            statut: "non_conforme",
            detail: `${sansSource.length} chiffre(s) sans source vérifiée (moteur ou preuve) : ${sansSource
              .slice(0, 3)
              .map((c) => abreger(c.libelle))
              .join(" ; ")}.`,
          };
    }
    default:
      return NON_EVALUABLE("Item à attester par le relecteur.");
  }
}

/**
 * Exécute les contrôles du code, ajoute les résultats qui changent et ouvre la revue (brouillon →
 * en revue). Sous le verrou du suivi. Une attestation humaine n'est jamais écrasée par un
 * « non évaluable » ; un contrôle devenu conforme ou non conforme prend sa place.
 */
export async function verifierDefinition(
  db: Db,
  auth: Auth,
  suivi: Suivi,
): Promise<EtatDefinition> {
  if (suivi.statut === "valide" || suivi.statut === "signe") {
    throw conflit("Le suivi est validé : la vérification est close.");
  }
  const def = suivi.definition_id ? await chargerDefinition(db, suivi.definition_id) : null;
  const contenu = await lireContenuLivrable(
    db,
    suivi.mission_id,
    suivi.type_livrable as never,
    suivi.livrable_id,
    suivi.version,
  );
  if (def) {
    const ch = await db.query(
      `SELECT libelle, source_type FROM qualite_revue_elements
       WHERE suivi_id = $1 AND kind = 'chiffre'`,
      [suivi.id],
    );
    const dernier = await db.query(
      `SELECT DISTINCT ON (item_id) item_id, rang, statut, detail
       FROM qualite_verifications WHERE suivi_id = $1 ORDER BY item_id, rang DESC`,
      [suivi.id],
    );
    const precedent = new Map(dernier.rows.map((l) => [l.item_id as string, l]));
    for (const item of def.items) {
      if (item.controle === "manuel") continue;
      const r = controler(item, contenu, ch.rows as ChiffreRevue[]);
      const p = precedent.get(item.id);
      if (p?.statut === "atteste" && r.statut === "non_evaluable") continue;
      if (p && p.statut === r.statut && (p.detail ?? null) === r.detail) continue;
      await db.query(
        `INSERT INTO qualite_verifications (cabinet_id, suivi_id, item_id, rang, statut, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          auth.cabinetId,
          suivi.id,
          item.id,
          ((p?.rang as number | undefined) ?? 0) + 1,
          r.statut,
          r.detail,
        ],
      );
    }
  }
  // Empreinte du contenu RELU, posée une fois au passage en revue (figée en base, MPY02) ; un
  // suivi ouvert avant la migration 0286 la reçoit à sa prochaine vérification.
  if (suivi.empreinte_revue === null && contenu?.empreinte) {
    await db.query(
      "UPDATE qualite_suivis SET empreinte_revue = $2 WHERE id = $1 AND empreinte_revue IS NULL",
      [suivi.id, contenu.empreinte],
    );
    suivi.empreinte_revue = contenu.empreinte;
  }
  if (suivi.statut === "brouillon") {
    await changerStatut(db, suivi.id, "en_revue");
    await ajouterEvenement(db, auth.cabinetId, suivi.id, auth.utilisateurId, {
      action: "passage_en_revue",
      details: suivi.empreinte_revue ? { empreinte: suivi.empreinte_revue } : {},
    });
    suivi.statut = "en_revue";
  }
  const etat = await etatDefinition(db, suivi);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.verifier",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { satisfaite: etat.satisfaite, bloquants: etat.bloquants },
  });
  return etat;
}

/** Attestation motivée d'un item « manuel » ou « non évaluable » par un humain. */
export async function attesterItem(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  itemId: string,
  commentaire: string,
): Promise<EtatDefinition> {
  if (suivi.statut !== "en_revue") {
    throw conflit("L'attestation se fait pendant la revue : lancez d'abord la vérification.");
  }
  // Séparation des tâches : l'auteur n'atteste pas ce que le code n'a pas su vérifier sur son
  // propre livrable (doublé en base, MPY10).
  if (suivi.auteur_id !== null && suivi.auteur_id === auth.utilisateurId) {
    throw new AppError(
      409,
      "ATTESTATION_PAR_AUTEUR",
      "L'auteur du livrable n'atteste pas sa propre définition de terminé : un autre relecteur atteste.",
    );
  }
  const etat = await etatDefinition(db, suivi);
  const item = etat.items.find((i) => i.id === itemId);
  if (!item) throw requeteInvalide("Cet item n'appartient pas à la définition de ce suivi.");
  if (item.controle !== "manuel" && item.statut !== "non_evaluable") {
    throw conflit(
      "Cet item est contrôlé par le code : corrigez le livrable puis relancez la vérification.",
    );
  }
  const rang = await db.query(
    "SELECT COALESCE(MAX(rang), 0) + 1 AS rang FROM qualite_verifications WHERE suivi_id = $1 AND item_id = $2",
    [suivi.id, itemId],
  );
  await db.query(
    `INSERT INTO qualite_verifications (cabinet_id, suivi_id, item_id, rang, statut, detail, par)
     VALUES ($1, $2, $3, $4, 'atteste', $5, $6)`,
    [auth.cabinetId, suivi.id, itemId, rang.rows[0].rang, commentaire, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.attester",
    entite: "qualite_suivi",
    entiteId: suivi.id,
    details: { item: item.code },
  });
  return etatDefinition(db, suivi);
}

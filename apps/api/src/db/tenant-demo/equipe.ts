import { antidater, attendre, type ContexteTenantDemo } from "./contexte.js";
import type { CleCompte } from "./cles.js";
import { COLLABORATEURS, historiqueCouts, type DefCollaborateur } from "./donnees-equipe.js";

/*
 * Collaborateurs du cabinet « Tenant démo » (tous les types : interne, externe, sous-traitant),
 * leurs coûts datés et leur ancienneté. Voir donnees-equipe.ts pour les données.
 *
 * - Création par la vraie route POST /api/collaborateurs (session de l'associé : droit
 *   `collaborateurs.ecrire`). Idempotent par NOM (unique dans le cabinet) : la liste existante est
 *   lue d'abord, un collaborateur déjà présent n'est ni recréé ni modifié.
 * - Coûts (FIN-02) : POST /api/collaborateurs/:id/couts exige `taux.gerer` (associé ou
 *   gestionnaire) ; on utilise la session de l'associé. L'historique est relu (GET .../couts,
 *   `finance.lire`) et seules les dates manquantes sont postées : jamais de doublon, jamais de
 *   modification d'une ligne existante (l'historique est immuable).
 * - `collaborateurs.cree_le` est antidaté à la date d'arrivée (SQL propriétaire, `antidater`).
 * - Le collaborateur parti (« ex.consultant ») est désactivé en dernier (PATCH actif=false), une
 *   fois ses coûts posés.
 */

interface CollaborateurExistant {
  id: string;
  nom: string;
  actif: boolean;
}

/** Tous les collaborateurs du cabinet (actifs ou non), pagination par curseur. */
async function collaborateursExistants(ctx: ContexteTenantDemo): Promise<CollaborateurExistant[]> {
  const associe = ctx.session("associe");
  const tous: CollaborateurExistant[] = [];
  let curseur: string | null = null;
  do {
    const url: string = `/api/collaborateurs?limite=200${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
    const r = await associe.get(url);
    attendre(200, r, "liste des collaborateurs");
    const page = r.json() as { elements: CollaborateurExistant[]; curseur_suivant: string | null };
    tous.push(...page.elements);
    curseur = page.curseur_suivant;
  } while (curseur);
  return tous;
}

/** Pose les lignes de coûts manquantes (par date d'effet) d'un collaborateur. Renvoie le nombre posé. */
async function assurerCouts(
  ctx: ContexteTenantDemo,
  id: string,
  def: DefCollaborateur,
): Promise<number> {
  const associe = ctx.session("associe");
  const lu = await associe.get(`/api/collaborateurs/${id}/couts`);
  attendre(200, lu, `historique de coûts ${def.nom}`);
  const dates = new Set((lu.json().historique as { depuis_le: string }[]).map((l) => l.depuis_le));
  let poses = 0;
  for (const ligne of historiqueCouts(def)) {
    if (dates.has(ligne.depuis_le)) continue;
    attendre(
      201,
      await associe.post(`/api/collaborateurs/${id}/couts`, { ...ligne, devise: "XOF" }),
      `coûts ${def.nom} au ${ligne.depuis_le}`,
    );
    poses++;
  }
  return poses;
}

/**
 * Crée (ou retrouve) tous les collaborateurs de `CleCollaborateur`, pose leurs coûts, antidate
 * leur arrivée et remplit `ctx.collaborateurs`. Idempotent.
 */
export async function assurerCollaborateurs(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const existants = new Map((await collaborateursExistants(ctx)).map((c) => [c.nom, c]));
  let crees = 0;
  let couts = 0;

  for (const def of COLLABORATEURS) {
    const gradeId = ctx.grades[def.grade];
    if (!gradeId) {
      throw new Error(`Grade « ${def.grade} » introuvable : assurerParametres doit passer avant.`);
    }
    let existant = existants.get(def.nom);
    if (!existant) {
      const r = await associe.post("/api/collaborateurs", {
        nom: def.nom,
        utilisateur_id: ctx.utilisateurs[def.cle as CleCompte] ?? null,
        grade_id: gradeId,
        type: def.type,
        competences: def.competences,
        secteurs: def.secteurs,
        langues: def.langues,
        capacite_pct: def.capacite,
        actif: true,
      });
      attendre(201, r, `collaborateur ${def.nom}`);
      existant = { id: r.json().id as string, nom: def.nom, actif: true };
      crees++;
      await antidater(ctx, "collaborateurs", existant.id, def.depuis);
    }
    ctx.collaborateurs[def.cle] = existant.id;
    couts += await assurerCouts(ctx, existant.id, def);
    // Départ : le collaborateur n'est désactivé qu'une fois son historique de coûts complet.
    if (def.depart && existant.actif) {
      attendre(
        200,
        await associe.patch(`/api/collaborateurs/${existant.id}`, { actif: false }),
        `désactivation de ${def.nom}`,
      );
    }
  }
  ctx.journal(`Collaborateurs : ${crees} créé(s), ${couts} ligne(s) de coûts posée(s).`);
}

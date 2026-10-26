import { ajouterJours } from "@missionpilot/engines";
import type { TypeEntiteCollaboration } from "@missionpilot/shared";
import type { ContexteTenantDemo } from "../contexte.js";
import type { Casting, CleMission, MissionLue } from "./casting.js";
import { FILS_TERMINEES } from "./donnees-collaboration.js";
import { FILS_EN_COURS } from "./donnees-collaboration-cours.js";
import type { Fil, RoleActeur } from "./collaboration-donnees-types.js";
import {
  ancrer,
  encadrer,
  equipeDe,
  heureISO,
  jourSur,
  ouvre,
  periode,
  plusTard,
  sansDeclencheurs,
  sessionDe,
  supprimerAvec,
  type Acteur,
  type Equipe,
} from "./collaboration-outils.js";
import { ok } from "./outils.js";

/*
 * COMMENTAIRES contextuels (SOC-08, migration 0074) : fils de discussion sur les missions, leurs
 * tâches, le pipeline et les factures, échelonnés sur deux ans, avec mentions (notifiées),
 * modifications historisées et suppressions logiques. Tout passe par `POST/PATCH/DELETE
 * /api/commentaires` sous le rôle de l'auteur ; les dates sont ensuite remontées (voir
 * collaboration-outils.ts). Idempotent : la clé naturelle est (entité, auteur, texte initial).
 */

interface Cible {
  type: TypeEntiteCollaboration;
  id: string;
  /** Jour du premier message du fil. */
  jour: string;
  /** Texte de remplacement `{numero}` (factures). */
  numero?: string;
}

interface Prevu {
  cible: Cible;
  equipe: Equipe;
  fil: Pick<Fil, "q" | "msgs">;
  mission: MissionLue;
}

const JETON = /\{@(dir|chef|assoc|c1|c2|c3|exp|gest|res)\}/g;

/** Cible du fil (entité commentée et premier jour), ou null si l'entité n'existe pas. */
async function resoudre(ctx: ContexteTenantDemo, m: MissionLue, fil: Fil): Promise<Cible | null> {
  const p = periode(ctx, m);
  const c = fil.cible;
  if (c === "mission") return { type: "mission", id: m.id, jour: jourSur(p, fil.q) };
  if ("tache" in c) {
    const t = m.taches.find((x) => x.libelle.includes(c.tache));
    return t ? { type: "mission_tache", id: t.id, jour: jourSur(p, fil.q) } : null;
  }
  const intitule = "opportunite" in c ? c.opportunite : c.proposition;
  const r = await ctx.proprietaire.query(
    "opportunite" in c
      ? `SELECT id, (cree_le AT TIME ZONE 'UTC')::date::text AS jour FROM opportunites
          WHERE cabinet_id = $1 AND intitule = $2`
      : `SELECT p.id, (p.cree_le AT TIME ZONE 'UTC')::date::text AS jour
           FROM propositions p JOIN opportunites o ON o.id = p.opportunite_id
          WHERE p.cabinet_id = $1 AND o.intitule = $2 ORDER BY p.cree_le DESC LIMIT 1`,
    [ctx.cabinetId, intitule],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    type: "opportunite" in c ? "opportunite" : "proposition",
    id: l.id as string,
    jour: ajouterJours(l.jour as string, Math.round(fil.q)),
  };
}

/** Texte final (jetons remplacés) et personnes mentionnées (sans l'auteur). */
function rendre(
  texte: string,
  equipe: Equipe,
  auteur: Acteur,
  numero?: string,
): { texte: string; mentions: Acteur[] } {
  const mentions: Acteur[] = [];
  const t = texte.replace(JETON, (_, role: RoleActeur) => {
    const a = equipe.parRole[role];
    if (a.id === auteur.id) return a.nom;
    if (!mentions.some((x) => x.id === a.id)) mentions.push(a);
    return `@${a.nom}`;
  });
  return { texte: numero ? t.replace("{numero}", numero) : t, mentions };
}

async function existe(
  ctx: ContexteTenantDemo,
  entiteId: string,
  auteurId: string,
  texte: string,
): Promise<boolean> {
  const r = await ctx.proprietaire.query(
    "SELECT 1 FROM commentaires WHERE cabinet_id = $1 AND entite_id = $2 AND auteur_id = $3 AND texte = $4",
    [ctx.cabinetId, entiteId, auteurId, texte],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Joue un fil : création, modification et suppression éventuelles, puis datation. */
async function jouerFil(ctx: ContexteTenantDemo, prevu: Prevu): Promise<number> {
  const { cible, equipe, fil } = prevu;
  const auj = ctx.aujourdhui;
  let crees = 0;
  let jourMsg = cible.jour;
  for (const [i, msg] of fil.msgs.entries()) {
    const auteur = equipe.parRole[msg.de];
    const { texte, mentions } = rendre(msg.t, equipe, auteur, cible.numero);
    const revision = msg.rev ? rendre(msg.rev, equipe, auteur).texte : undefined;
    // Jamais avant la création des comptes concernés ; jamais après aujourd'hui.
    const plancher = [auteur, ...mentions].reduce((j, a) => plusTard(j, a.depuis), cible.jour);
    jourMsg = ouvre(plusTard(ajouterJours(jourMsg, i === 0 ? 0 : i % 2), plancher), auj);
    if (await existe(ctx, cible.id, auteur.id, texte)) continue;
    const graine = Math.round(fil.q * 100) + i * 7;
    const instant = heureISO(jourMsg, 8 + (graine % 9), (graine * 13) % 50);
    const s = sessionDe(ctx, auteur);
    const { resultat: id, fenetre } = await encadrer(ctx, async () => {
      const r = await s.post("/api/commentaires", {
        entite_type: cible.type,
        entite_id: cible.id,
        texte,
        mentions: mentions.map((a) => a.id),
      });
      ok(201, r, `commentaire sur ${cible.type}`);
      const cid = r.json().id as string;
      if (revision)
        ok(200, await s.patch(`/api/commentaires/${cid}`, { texte: revision }), "révision");
      return cid;
    });
    const recent = jourMsg > ajouterJours(auj, -4);
    await ancrer(ctx, fenetre, instant, !recent);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query("UPDATE commentaires SET cree_le = $2::timestamptz WHERE id = $1", [
        id,
        instant,
      ]);
      await c.query(
        "UPDATE commentaire_revisions SET cree_le = $2::timestamptz + interval '9 minutes' WHERE commentaire_id = $1",
        [id, instant],
      );
    });
    crees += 1;
    if (!msg.sup) continue;
    // Suppression logique : par l'auteur, ou par un associé (modération), le lendemain au plus tard.
    const jourSup = jourMsg < auj ? ouvre(ajouterJours(jourMsg, 1), auj) : jourMsg;
    const supprimeur: Acteur = msg.sup === "associe" ? equipe.parRole.assoc : auteur;
    const supprime = await encadrer(ctx, async () => {
      const r = await supprimerAvec(ctx, sessionDe(ctx, supprimeur), `/api/commentaires/${id}`);
      ok(204, r, "suppression de commentaire");
    });
    const quand = heureISO(jourSup, 9 + (graine % 7), (graine * 11) % 50);
    await ancrer(ctx, supprime.fenetre, quand, true);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        "UPDATE commentaire_suppressions SET supprime_le = $2::timestamptz WHERE commentaire_id = $1",
        [id, quand],
      );
    });
  }
  return crees;
}

/** Fils sur les factures émises (un par mission, si la facturation a déjà tourné). */
async function filsFactures(
  ctx: ContexteTenantDemo,
  casting: Casting,
  equipes: Map<CleMission, Equipe>,
): Promise<Prevu[]> {
  const prevus: Prevu[] = [];
  const cles: CleMission[] = ["sicafe-plan", "wouri-redressement", "atlantique-bp", "baobab-plan"];
  for (const cle of cles) {
    const m = casting.missions[cle];
    const equipe = equipes.get(cle);
    if (!m || !equipe) continue;
    const f = (
      await ctx.proprietaire.query(
        `SELECT id, numero, date_emission::text AS jour FROM factures
          WHERE cabinet_id = $1 AND mission_id = $2 AND nature = 'facture' AND statut = 'emise'
            AND numero IS NOT NULL ORDER BY date_emission, id LIMIT 1`,
        [ctx.cabinetId, m.id],
      )
    ).rows[0];
    if (!f) continue;
    prevus.push({
      cible: {
        type: "facture",
        id: f.id as string,
        jour: ajouterJours(f.jour as string, 2),
        numero: f.numero as string,
      },
      equipe,
      mission: m,
      fil: {
        q: 0.5,
        msgs: [
          {
            de: "gest",
            t: "Facture {numero} transmise au client par courriel ; je surveille le délai de règlement.",
          },
          { de: "dir", t: "Merci. Je préviens le client lors du prochain point de mission." },
        ],
      },
    });
  }
  return prevus;
}

/** Sème les commentaires ; renvoie le nombre de commentaires créés pendant cette exécution. */
export async function semerCommentaires(
  ctx: ContexteTenantDemo,
  casting: Casting,
  acteurs: Map<string, Acteur>,
): Promise<number> {
  const equipes = new Map<CleMission, Equipe>();
  for (const m of Object.values(casting.missions)) {
    if (m) equipes.set(m.cle, await equipeDe(ctx, m, acteurs));
  }
  const prevus: Prevu[] = [];
  for (const fil of [...FILS_TERMINEES, ...FILS_EN_COURS]) {
    const m = casting.missions[fil.m];
    const equipe = equipes.get(fil.m);
    if (!m || !equipe) continue;
    const cible = await resoudre(ctx, m, fil);
    if (!cible) {
      ctx.journal(`  commentaires : cible introuvable pour « ${fil.m} » (fil ignoré).`);
      continue;
    }
    prevus.push({ cible, equipe, fil, mission: m });
  }
  prevus.push(...(await filsFactures(ctx, casting, equipes)));
  // Ordre chronologique : l'histoire s'écrit dans l'ordre où elle s'est déroulée.
  prevus.sort((a, b) => a.cible.jour.localeCompare(b.cible.jour));
  let total = 0;
  for (const p of prevus) total += await jouerFil(ctx, p);
  ctx.journal(`  commentaires : ${total} créés sur ${prevus.length} fils.`);
  return total;
}

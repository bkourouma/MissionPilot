import { ajouterJours } from "@missionpilot/engines";
import { abreger } from "../../../qualite/texte.js";
import {
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { ORDRE_CRITERES, REVUES } from "./qualite-froide-donnees.js";
import { relecteursIndependants, type MissionCloturee } from "./qualite-froide-historique.js";
import { acteurDe } from "./qualite-outils.js";

/*
 * Campagne de revue à froid ouverte AUJOURD'HUI, par les vraies routes (/api/qualite/revue-froide) :
 * tirage par l'associé, affectation de relecteurs indépendants proposés par la route, grille,
 * constats et terminaison par le relecteur lui-même, puis plan d'amélioration. La première revue
 * est terminée ; la seconde est en cours (grille à moitié remplie) ; la campagne reste ouverte.
 * Reprise possible : chaque étape lit l'état avant d'écrire.
 */

/** Intitulé de la campagne du jour ; la période exacte dépend des missions réellement tirables. */
const PREFIXE_INTITULE = "Revue à froid — missions clôturées du ";

interface Echantillon {
  id: string;
  rang: number;
  statut: string;
  mission_id: string;
}
interface DetailRevue {
  echantillon: { statut: string };
  evaluations: { critere: string }[];
  constats: { id: string; gravite: string; description: string }[];
}

const rangRole = (role: string): number =>
  role === "expert_metier" ? 0 : role === "directeur_mission" ? 1 : 2;

/**
 * Session d'un relecteur : la session du contexte si le compte en a une, sinon une connexion par
 * e-mail pour un compte ajouté par un autre lot SANS double authentification (un compte à 2FA ne
 * peut pas ouvrir de session ici). undefined : relecteur inutilisable pour la campagne du jour.
 */
async function sessionDe(ctx: ContexteTenantDemo, id: string): Promise<SessionDemo | undefined> {
  const a = acteurDe(ctx, id);
  if (a) return ctx.sessions[a.cle];
  const r = await ctx.proprietaire.query<{ email: string }>(
    `SELECT u.email FROM utilisateurs u WHERE u.id = $1 AND u.actif
        AND NOT EXISTS (SELECT 1 FROM utilisateurs_2fa f WHERE f.utilisateur_id = u.id)`,
    [id],
  );
  const email = r.rows[0]?.email;
  if (!email) return undefined;
  try {
    return await ouvrirSessionTenant(ctx.app, email, id);
  } catch {
    return undefined;
  }
}

/**
 * Plus longue suite de missions clôturées, non encore revues et CONSÉCUTIVES par date de clôture,
 * dont chacune a un relecteur indépendant utilisable : la campagne du jour s'y limite (le tirage
 * de la route porte sur toute la période), de sorte qu'aucune mission tirée ne reste sans relecteur.
 */
async function fenetreTirable(
  ctx: ContexteTenantDemo,
  chronologie: MissionCloturee[],
): Promise<MissionCloturee[]> {
  const revues = await ctx.proprietaire.query<{ mission_id: string }>(
    "SELECT mission_id FROM qualite_froide_echantillon WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  const dejaRevues = new Set(revues.rows.map((r) => r.mission_id));
  const restantes = chronologie.filter((m) => !dejaRevues.has(m.id));
  const tirable: boolean[] = [];
  for (const m of restantes) {
    let ok = false;
    for (const r of await relecteursIndependants(ctx, m.id, null)) {
      if (await sessionDe(ctx, r.id)) {
        ok = true;
        break;
      }
    }
    tirable.push(ok);
  }
  let meilleure: MissionCloturee[] = [];
  let courante: MissionCloturee[] = [];
  restantes.forEach((m, i) => {
    courante = tirable[i] ? [...courante, m] : [];
    if (courante.length > meilleure.length) meilleure = courante;
  });
  const debut = meilleure[0]?.cloture;
  const fin = meilleure[meilleure.length - 1]?.cloture;
  if (!debut || !fin) return [];
  // Une mission non tirable qui partage une date de clôture avec la suite entrerait dans la période.
  const intruse = restantes.some((m, i) => !tirable[i] && m.cloture >= debut && m.cloture <= fin);
  return intruse ? [] : meilleure;
}

export async function campagneDuJour(
  ctx: ContexteTenantDemo,
  chronologie: MissionCloturee[],
): Promise<void> {
  const gestion = ctx.session("associe");
  let campagneId = (
    await ctx.proprietaire.query<{ id: string }>(
      "SELECT id FROM qualite_froide_campagnes WHERE intitule LIKE $1 ORDER BY cree_le DESC LIMIT 1",
      [`${PREFIXE_INTITULE}%`],
    )
  ).rows[0]?.id;
  if (!campagneId) {
    const fenetre = await fenetreTirable(ctx, chronologie);
    const debut = fenetre[0];
    const fin = fenetre[fenetre.length - 1];
    if (!debut || !fin) {
      ctx.journal(
        "  campagne de revue à froid du jour ignorée : aucune mission restante avec relecteur indépendant utilisable.",
      );
      return;
    }
    const r = await gestion.post("/api/qualite/revue-froide/campagnes", {
      intitule: `${PREFIXE_INTITULE}${debut.cloture} au ${fin.cloture}`,
      criteres: {
        periode_debut: debut.cloture,
        periode_fin: fin.cloture,
        types_mission_ids: [],
        directeur_ids: [],
        stratifier_par: null,
        exclure_deja_revues: true,
      },
      taille: Math.min(2, fenetre.length),
      graine: "froide-2026-t4",
    });
    attendre(201, r, "création de la campagne du jour");
    campagneId = (r.json() as { id: string }).id;
  }

  const lireCampagne = async (): Promise<Echantillon[]> => {
    const r = await gestion.get(`/api/qualite/revue-froide/campagnes/${campagneId}`);
    attendre(200, r, "lecture de la campagne");
    return (r.json() as { echantillon: Echantillon[] }).echantillon;
  };

  // Affectation d'un relecteur indépendant (de préférence un expert métier) proposé par la route.
  for (const e of await lireCampagne()) {
    if (e.statut !== "a_affecter") continue;
    const r = await gestion.get(
      `/api/qualite/revue-froide/echantillons/${e.id}/relecteurs-eligibles`,
    );
    attendre(200, r, "relecteurs éligibles");
    const proposes = (
      r.json() as { relecteurs: { id: string; eligible: boolean; roles?: string[] }[] }
    ).relecteurs.filter((u) => u.eligible);
    const choix: { id: string; rang: number; nom: string }[] = [];
    for (const u of proposes) {
      if (!(await sessionDe(ctx, u.id))) continue;
      const a = acteurDe(ctx, u.id);
      choix.push({ id: u.id, rang: rangRole(a?.role ?? u.roles?.[0] ?? ""), nom: a?.cle ?? u.id });
    }
    choix.sort((x, y) => x.rang - y.rang || x.nom.localeCompare(y.nom));
    const relecteur = choix[e.rang - 1] ?? choix[0];
    if (!relecteur) {
      ctx.journal(`  revue ${e.id} laissée à affecter : aucun relecteur indépendant utilisable.`);
      continue;
    }
    attendre(
      200,
      await gestion.post(`/api/qualite/revue-froide/echantillons/${e.id}/affectation`, {
        relecteur_id: relecteur.id,
      }),
      "affectation du relecteur",
    );
  }

  // Grille et constats par le relecteur affecté : revue n° 1 terminée, revue n° 2 à moitié remplie.
  for (const e of await lireCampagne()) {
    if (e.statut === "a_affecter") continue; // aucun relecteur utilisable : revue laissée à affecter
    const mission = chronologie.find((m) => m.id === e.mission_id);
    const modele = mission ? REVUES[mission.cle as keyof typeof REVUES] : undefined;
    if (!modele) throw new Error(`Pas de jeu de revue à froid pour la mission ${e.mission_id}.`);
    const d0 = await gestion.get(`/api/qualite/revue-froide/echantillons/${e.id}`);
    attendre(200, d0, "lecture de la revue");
    const relecteurId = (d0.json() as { echantillon: { relecteur: { id: string } } }).echantillon
      .relecteur.id;
    const s = await sessionDe(ctx, relecteurId);
    if (!s) throw new Error("Relecteur sans session utilisable.");
    const detail = d0.json() as DetailRevue;
    if (detail.echantillon.statut === "terminee") continue;
    const aEvaluer = e.rang === 1 ? ORDRE_CRITERES : ORDRE_CRITERES.slice(0, 4);
    for (const [i, critere] of ORDRE_CRITERES.entries()) {
      if (!aEvaluer.includes(critere) || detail.evaluations.some((v) => v.critere === critere))
        continue;
      const note = modele.notes[i] ?? null;
      const commentaire = modele.commentaires[critere] ?? null;
      attendre(
        200,
        await s.put(`/api/qualite/revue-froide/echantillons/${e.id}/evaluations`, {
          critere,
          note,
          commentaire,
        }),
        `évaluation du critère ${critere}`,
      );
    }
    if (e.rang !== 1) continue;
    if (detail.constats.length === 0) {
      for (const k of modele.constats) {
        attendre(
          201,
          await s.post(`/api/qualite/revue-froide/echantillons/${e.id}/constats`, {
            critere: k.critere,
            gravite: k.gravite,
            description: k.description,
            recommandation: k.recommandation,
          }),
          "constat",
        );
      }
    }
    attendre(
      200,
      await s.post(`/api/qualite/revue-froide/echantillons/${e.id}/terminer`, {
        synthese: modele.synthese,
      }),
      "terminaison de la revue",
    );
  }

  // Plan d'amélioration : actions nées des constats de la revue terminée.
  const existantes = await ctx.proprietaire.query(
    "SELECT 1 FROM qualite_froide_actions WHERE campagne_id = $1",
    [campagneId],
  );
  if ((existantes.rowCount ?? 0) > 0) return;
  const premiere = (await lireCampagne()).find((e) => e.statut === "terminee");
  if (!premiere) return;
  const constats = (
    (
      await gestion.get(`/api/qualite/revue-froide/echantillons/${premiere.id}`)
    ).json() as DetailRevue
  ).constats;
  // La route refuse une échéance antérieure à la date réelle du serveur : on prend la plus tardive.
  const reelle = (await ctx.proprietaire.query<{ d: string }>("SELECT (current_date)::text AS d"))
    .rows[0]!.d;
  const echeance = (delai: number): string => {
    const fictive = ajouterJours(ctx.aujourdhui, delai);
    const serveur = ajouterJours(reelle, delai);
    return fictive > serveur ? fictive : serveur;
  };
  const chef = ctx.session("chef.mission");
  const premierConstat = constats[0];
  if (premierConstat) {
    const r = await gestion.post(`/api/qualite/revue-froide/campagnes/${campagneId}/actions`, {
      constat_id: premierConstat.id,
      titre: `Corriger l'écart relevé : ${abreger(premierConstat.description).slice(0, 120)}`,
      description:
        "Action proposée par la revue à froid ; le responsable précise le plan de correction.",
      responsable_id: chef.utilisateurId,
      echeance: echeance(45),
    });
    attendre(201, r, "action du plan d'amélioration");
    const idAction =
      (r.json() as { id?: string; action?: { id: string } }).id ??
      (r.json() as { action: { id: string } }).action.id;
    attendre(
      200,
      await chef.patch(`/api/qualite/revue-froide/actions/${idAction}`, {
        statut: "en_cours",
        commentaire: "Plan de correction en cours de rédaction.",
      }),
      "avancement de l'action",
    );
  }
  attendre(
    201,
    await gestion.post(`/api/qualite/revue-froide/campagnes/${campagneId}/actions`, {
      titre: "Présenter les résultats de la campagne au comité qualité",
      description: "Restitution des conclusions des revues et des actions décidées.",
      responsable_id: ctx.session("associe.2").utilisateurId,
      echeance: echeance(30),
    }),
    "action de restitution",
  );
}

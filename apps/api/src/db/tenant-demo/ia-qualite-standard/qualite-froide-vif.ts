import { ajouterJours } from "@missionpilot/engines";
import { abreger } from "../../../qualite/texte.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { ORDRE_CRITERES, REVUES } from "./qualite-froide-donnees.js";
import type { MissionCloturee } from "./qualite-froide-historique.js";
import { acteurDe } from "./qualite-outils.js";

/*
 * Campagne de revue à froid ouverte AUJOURD'HUI, par les vraies routes (/api/qualite/revue-froide) :
 * tirage par l'associé, affectation de relecteurs indépendants proposés par la route, grille,
 * constats et terminaison par le relecteur lui-même, puis plan d'amélioration. La première revue
 * est terminée ; la seconde est en cours (grille à moitié remplie) ; la campagne reste ouverte.
 * Reprise possible : chaque étape lit l'état avant d'écrire.
 */

const INTITULE = "Revue à froid — missions clôturées de juillet 2025 à mai 2026";

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

export async function campagneDuJour(
  ctx: ContexteTenantDemo,
  chronologie: MissionCloturee[],
): Promise<void> {
  const gestion = ctx.session("associe");
  const debut = chronologie[2];
  const fin = chronologie[chronologie.length - 1];
  if (!debut || !fin) throw new Error("Pas assez de missions clôturées pour la campagne du jour.");

  let campagneId = (
    await ctx.proprietaire.query<{ id: string }>(
      "SELECT id FROM qualite_froide_campagnes WHERE intitule = $1",
      [INTITULE],
    )
  ).rows[0]?.id;
  if (!campagneId) {
    const r = await gestion.post("/api/qualite/revue-froide/campagnes", {
      intitule: INTITULE,
      criteres: {
        periode_debut: debut.cloture,
        periode_fin: fin.cloture,
        types_mission_ids: [],
        directeur_ids: [],
        stratifier_par: null,
        exclure_deja_revues: true,
      },
      taille: 2,
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
    const choix = (r.json() as { relecteurs: { id: string; eligible: boolean }[] }).relecteurs
      .filter((u) => u.eligible)
      .map((u) => acteurDe(ctx, u.id))
      .filter(
        (a): a is NonNullable<typeof a> => a !== undefined && ctx.sessions[a.cle] !== undefined,
      )
      .sort((a, b) => rangRole(a.role) - rangRole(b.role) || a.cle.localeCompare(b.cle));
    const relecteur = choix[e.rang - 1] ?? choix[0];
    if (!relecteur) throw new Error(`Aucun relecteur indépendant éligible pour la revue ${e.id}.`);
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
    const mission = chronologie.find((m) => m.id === e.mission_id);
    const modele = mission ? REVUES[mission.cle as keyof typeof REVUES] : undefined;
    if (!modele) throw new Error(`Pas de jeu de revue à froid pour la mission ${e.mission_id}.`);
    const d0 = await gestion.get(`/api/qualite/revue-froide/echantillons/${e.id}`);
    attendre(200, d0, "lecture de la revue");
    const relecteurId = (d0.json() as { echantillon: { relecteur: { id: string } } }).echantillon
      .relecteur.id;
    const relecteur = acteurDe(ctx, relecteurId);
    if (!relecteur) throw new Error("Relecteur hors des comptes du seed.");
    const s = ctx.session(relecteur.cle);
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

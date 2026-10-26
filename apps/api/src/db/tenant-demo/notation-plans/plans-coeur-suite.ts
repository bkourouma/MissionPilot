import type { EtatPlan } from "./plans-coeur-moteur.js";
import { sessionValideur } from "./plans-coeur-moteur.js";
import type { Donnees, SpecArbitrage, SpecNoeud } from "./plans-coeur-types.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Moteur de rejeu d'un plan, seconde moitié : cascade (projets et jalons), évaluations et
 * arbitrage du portefeuille, versions du modèle financier, partage au client, observations de la
 * bibliothèque. Les chiffres (modèle, scores, optimisation) sortent des moteurs par les routes.
 */

interface NoeudApi {
  id: string;
  type: string;
  titre: string;
  statut: string | null;
  modifiable: boolean;
}

function donneesNoeud(
  e: EtatPlan,
  n: SpecNoeud,
  statut: string,
  type: "projet" | "jalon",
): Donnees {
  return {
    titre: n.titre,
    ...(n.description ? { description: n.description } : {}),
    ...(n.porteur ? { porteur_id: e.ctx.utilisateurs[n.porteur] } : {}),
    ...(type === "projet" && n.debut ? { debut: n.debut } : {}),
    echeance: n.echeance,
    statut,
  };
}

/** Crée ou fait avancer un projet ou un jalon ; renvoie son identifiant. */
async function jouerNoeud(
  e: EtatPlan,
  existants: readonly NoeudApi[],
  n: SpecNoeud,
  type: "projet" | "jalon",
  parentId: string,
): Promise<string> {
  const connu = existants.find((x) => x.modifiable && x.type === type && x.titre === n.titre);
  let id = connu?.id;
  let fait = 0;
  if (connu) {
    fait = n.parcours.lastIndexOf(connu.statut ?? "") + 1;
  } else {
    const r = await e.acteurs.chef.post(`/api/plans/${e.planId}/cascade/noeuds`, {
      type,
      parent_id: parentId,
      donnees: donneesNoeud(e, n, n.parcours[0] as string, type),
    });
    exiger(r, 201, `${type} « ${n.titre} »`);
    id = r.json().id as string;
    fait = 1;
  }
  for (let i = fait; i < n.parcours.length; i++) {
    const r = await e.acteurs.chef.post(`/api/plans/${e.planId}/cascade/noeuds/${id}/versions`, {
      donnees: donneesNoeud(e, n, n.parcours[i] as string, type),
      retire: false,
    });
    exiger(r, 201, `version du ${type} « ${n.titre} »`);
  }
  return id as string;
}

export async function jouerCascade(e: EtatPlan): Promise<void> {
  if (!e.spec.projets?.length) return;
  const lecture = await e.acteurs.chef.get(`/api/plans/${e.planId}/cascade`);
  exiger(lecture, 200, "cascade du plan");
  const existants = lecture.json().noeuds as NoeudApi[];
  for (const p of e.spec.projets) {
    const initiativeId = e.ids.get(p.initiative);
    if (!initiativeId) throw new Error(`Initiative « ${p.initiative} » inconnue (projet).`);
    const projetId = await jouerNoeud(e, existants, p, "projet", initiativeId);
    for (const j of p.jalons) await jouerNoeud(e, existants, j, "jalon", projetId);
  }
}

interface InitiativePortefeuille {
  id: string;
  evaluation: { version: number } | null;
}

export async function jouerEvaluations(e: EtatPlan): Promise<void> {
  if (!e.spec.evaluations?.length) return;
  const lecture = await e.acteurs.chef.get(`/api/plans/${e.planId}/portefeuille`);
  exiger(lecture, 200, "portefeuille du plan");
  const actives = lecture.json().initiatives as InitiativePortefeuille[];
  for (const ev of e.spec.evaluations) {
    const id = e.ids.get(ev.initiative);
    const courante = actives.find((x) => x.id === id);
    if (!id || !courante) {
      e.ctx.journal(`    évaluation ignorée (initiative non active) : ${ev.initiative}`);
      continue;
    }
    for (let i = courante.evaluation?.version ?? 0; i < ev.versions.length; i++) {
      const r = await e.acteurs.consultant.put(
        `/api/plans/${e.planId}/portefeuille/initiatives/${id}`,
        ev.versions[i],
      );
      exiger(r, 200, `évaluation de « ${ev.initiative} »`);
    }
  }
}

function contraintes(
  e: EtatPlan,
  a: Pick<SpecArbitrage, "budget_max" | "capacite_max" | "obligatoires" | "exclues">,
) {
  const versIds = (cles: readonly string[] = []) => cles.map((c) => e.ids.get(c) as string);
  return {
    budget_max: a.budget_max,
    capacite_max: a.capacite_max,
    obligatoires: versIds(a.obligatoires),
    exclues: versIds(a.exclues),
  };
}

/** Proposition du moteur sans arbitrage (lecture) : trace de journal seulement. */
export async function proposerSeulement(e: EtatPlan): Promise<void> {
  const p = e.spec.proposerSeulement;
  if (!p) return;
  const r = await e.acteurs.chef.post(
    `/api/plans/${e.planId}/portefeuille/proposition`,
    contraintes(e, p),
  );
  exiger(r, 200, "proposition de portefeuille");
}

/** Arbitrages du directeur : proposition du moteur recalculée, écart éventuel motivé. */
export async function jouerArbitrages(e: EtatPlan): Promise<void> {
  if (!e.spec.arbitrages?.length) return;
  const deja = await e.acteurs.directeur.get(
    `/api/plans/${e.planId}/portefeuille/arbitrages?limite=100`,
  );
  exiger(deja, 200, "arbitrages du plan");
  const nombre = (deja.json().elements as unknown[]).length;
  for (let i = nombre; i < e.spec.arbitrages.length; i++) {
    const a = e.spec.arbitrages[i] as SpecArbitrage;
    const c = contraintes(e, a);
    const prop = await e.acteurs.directeur.post(
      `/api/plans/${e.planId}/portefeuille/proposition`,
      c,
    );
    exiger(prop, 200, "proposition de portefeuille");
    const retenues = new Set<string>(prop.json().proposition.retenues as string[]);
    const motifs: { initiative_id: string; motif: string }[] = [];
    if (a.ajouter) {
      const id = e.ids.get(a.ajouter.initiative) as string;
      if (!retenues.has(id)) {
        retenues.add(id);
        motifs.push({ initiative_id: id, motif: a.ajouter.motif });
      }
    }
    if (a.retirer) {
      const id = e.ids.get(a.retirer.initiative) as string;
      if (retenues.delete(id)) motifs.push({ initiative_id: id, motif: a.retirer.motif });
    }
    const r = await e.acteurs.directeur.post(`/api/plans/${e.planId}/portefeuille/arbitrages`, {
      contraintes: c,
      retenues: [...retenues],
      motifs,
      commentaire: a.commentaire,
    });
    exiger(r, 201, "arbitrage du portefeuille");
  }
}

interface ModeleApi {
  version: number;
  validation: unknown;
}

/** Versions du modèle financier (chef) et leurs validations ; le moteur calcule tous les chiffres. */
export async function jouerModeles(e: EtatPlan): Promise<void> {
  const specs = e.spec.modeles ?? [];
  if (!specs.length) return;
  const lecture = await e.acteurs.chef.get(`/api/plans/${e.planId}/modeles?limite=100`);
  exiger(lecture, 200, "versions du modèle");
  const versions = lecture.json().elements as ModeleApi[];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (!s) continue;
    const numero = i + 1;
    let existante = versions.find((v) => v.version === numero);
    if (!existante) {
      const r = await e.acteurs.chef.post(`/api/plans/${e.planId}/modeles`, {
        hypotheses: s.hypotheses,
        commentaire: s.commentaire,
      });
      exiger(r, 201, `modèle financier, version ${numero}`);
      existante = { version: numero, validation: null };
    }
    if (s.valider && !existante.validation) {
      const r = await sessionValideur(e.acteurs, s.valider).post(
        `/api/plans/${e.planId}/modeles/${numero}/validation`,
        {},
      );
      exiger(r, 200, `validation du modèle, version ${numero}`);
    }
  }
}

/** Partage au portail client quand tout le contenu est validé (sinon rien, journalisé). */
export async function partager(e: EtatPlan): Promise<void> {
  if (!e.spec.partager) return;
  const r = await e.acteurs.directeur.get(`/api/plans/${e.planId}`);
  exiger(r, 200, "lecture du plan");
  const plan = r.json() as { partage_client: boolean; pret_pour_client: boolean };
  if (plan.partage_client) return;
  if (!plan.pret_pour_client) {
    e.ctx.journal(`    plan « ${e.spec.titre} » non prêt pour le client : partage ignoré`);
    return;
  }
  const p = await e.acteurs.directeur.post(`/api/plans/${e.planId}/partage`, {
    partage_client: true,
  });
  exiger(p, 200, "partage du plan au client");
}

/** Observations d'efficacité (associé : « standard.gerer ») tirées d'initiatives du plan. */
export async function observer(e: EtatPlan): Promise<void> {
  for (const o of e.spec.observations ?? []) {
    const element = e.spec.elements.find((x) => x.cle === o.initiative);
    const code = element?.bibliotheque?.code;
    const initiativeId = e.ids.get(o.initiative);
    if (!code || !initiativeId) continue;
    if (
      await existe(
        e.ctx,
        "SELECT 1 FROM initiative_type_observations WHERE plan_initiative_id = $1",
        [initiativeId],
      )
    ) {
      continue;
    }
    const [type] = await lire<{ id: string }>(
      e.ctx,
      "SELECT id FROM initiatives_types WHERE code = $1 AND cabinet_id IS NULL",
      [code],
    );
    const [client] = await lire<{
      secteur: string | null;
      taille: string | null;
      pays: string | null;
    }>(e.ctx, "SELECT secteur, taille, pays FROM clients WHERE id = $1", [e.mission.clientId]);
    const r = await e.acteurs.associe.post(
      `/api/bibliotheque-initiatives/${type?.id}/observations`,
      {
        secteur: client?.secteur ?? null,
        taille: client?.taille ?? null,
        pays: client?.pays ?? null,
        efficacite: o.efficacite,
        plan_initiative_id: initiativeId,
        commentaire: o.commentaire,
      },
    );
    exiger(r, 201, `observation de « ${o.initiative} »`);
  }
}

/** Bancabilité calculée par le moteur sur la dernière version validée du modèle (lecture). */
export async function verifierBancabilite(e: EtatPlan): Promise<void> {
  if (!e.spec.verifierBancabilite) return;
  const r = await e.acteurs.chef.get(`/api/plans/${e.planId}/bancabilite`);
  exiger(r, 200, "bancabilité du plan");
  const b = r.json() as { verdict: string; plan_financement: unknown[] };
  e.ctx.journal(
    `    bancabilité « ${e.spec.titre} » : verdict ${b.verdict}, ${b.plan_financement.length} exercices au plan de financement`,
  );
}

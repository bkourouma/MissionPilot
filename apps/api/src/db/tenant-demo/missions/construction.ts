import { ajouterJours } from "@missionpilot/engines";
import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";
import type { DefMission } from "./donnees-casting.js";
import { placerTaches } from "./calendrier.js";
import { completerTaux, deviseDuClient, TAUX_USD_XOF, versDevise } from "./devises.js";

/*
 * Construction d'une mission du casting par les VRAIES routes : opportunité -> proposition
 * (validée par un associé, envoyée, acceptée) -> mission -> découpage daté -> dépendances ->
 * signature (budget initial figé). L'équipe et les affectations sont dans equipe.ts.
 */

export interface LigneBudgetTache {
  grade_id: string;
  grade_code: string;
  jours: number;
}

export interface TacheLue {
  id: string;
  libelle: string;
  phase_id: string;
  est_livrable: boolean;
  budget: LigneBudgetTache[];
}

export interface MissionBatie {
  def: DefMission;
  id: string;
  opportuniteId: string;
  propositionId: string;
  phases: { id: string; libelle: string }[];
  taches: TacheLue[];
  jalons: { id: string; phase_id: string | null; libelle: string }[];
  /** Fenêtre calculée par le moteur pour chaque tâche (jours fériés compris). */
  fenetres: Map<string, { debut: string; fin: string }>;
}

const sessionDe = (ctx: ContexteTenantDemo, cle: string): SessionDemo =>
  ctx.session(cle as Parameters<ContexteTenantDemo["session"]>[0]);

/** Pipeline commercial jusqu'à la mission au statut « proposition ». */
async function creerDepuisPipeline(
  ctx: ContexteTenantDemo,
  def: DefMission,
): Promise<Pick<MissionBatie, "id" | "opportuniteId" | "propositionId">> {
  const chef = sessionDe(ctx, def.chef);
  const associe = ctx.session("associe");
  const typeId = ctx.typesMission[def.type];
  if (!typeId) throw new Error(`Type de mission « ${def.type} » absent du catalogue.`);
  const opp = await chef.post("/api/opportunites", {
    client_id: ctx.client(def.client),
    intitule: def.nom,
    type_mission_id: typeId,
    devise: deviseDuClient(def.client),
    probabilite: 35,
    etape: "qualification",
    responsable_id: chef.utilisateurId,
    date_cloture_prevue: def.signature ?? ajouterJours(def.opp, 60),
  });
  attendre(201, opp, `opportunité ${def.nom}`);
  const oppId = opp.json().id as string;
  attendre(
    200,
    await chef.post(`/api/opportunites/${oppId}/etape`, { etape: "proposition" }),
    "étape",
  );
  const prop = await chef.post(`/api/opportunites/${oppId}/propositions`, {
    date_reference: ajouterJours(def.opp, 14),
  });
  attendre(201, prop, `proposition ${def.nom}`);
  const propId = prop.json().id as string;
  await completerTaux(chef, propId, prop.json(), deviseDuClient(def.client));
  const url = `/api/propositions/${propId}`;
  attendre(200, await chef.post(`${url}/statut`, { statut: "a_valider" }), "proposition à valider");
  attendre(200, await associe.post(`${url}/statut`, { statut: "validee" }), "proposition validée");
  attendre(200, await chef.post(`${url}/statut`, { statut: "envoyee" }), "proposition envoyée");
  attendre(
    200,
    await chef.post(`/api/opportunites/${oppId}/etape`, { etape: "negociation" }),
    "étape",
  );
  attendre(
    200,
    await associe.post(`${url}/statut`, { statut: "acceptee" }),
    "proposition acceptée",
  );
  const m = await associe.post(`${url}/mission`, {
    intitule: def.nom,
    directeur_id: ctx.utilisateurs[def.directeur],
    chef_id: ctx.utilisateurs[def.chef],
    date_debut: def.debut,
    date_fin: def.fin,
    activite: "Conseil en stratégie et finance",
    secteur: def.secteur,
    bureau: "Abidjan",
  });
  attendre(201, m, `mission ${def.nom}`);
  return { id: m.json().id as string, opportuniteId: oppId, propositionId: propId };
}

/** Relit le découpage (phases, tâches avec budget, jalons) par la route. */
export async function lireDecoupage(
  session: SessionDemo,
  missionId: string,
): Promise<Pick<MissionBatie, "phases" | "taches" | "jalons">> {
  const r = await session.get(`/api/missions/${missionId}/decoupage`);
  attendre(200, r, "découpage");
  const corps = r.json() as {
    phases: {
      id: string;
      libelle: string;
      lots: { taches: Record<string, unknown>[] }[];
      taches: Record<string, unknown>[];
    }[];
    jalons: { id: string; phase_id: string | null; libelle: string }[];
  };
  const taches: TacheLue[] = [];
  for (const p of corps.phases) {
    for (const t of [...p.lots.flatMap((l) => l.taches), ...p.taches]) {
      taches.push({
        id: t.id as string,
        libelle: t.libelle as string,
        phase_id: p.id,
        est_livrable: t.est_livrable as boolean,
        budget: (t.budget as LigneBudgetTache[] | undefined) ?? [],
      });
    }
  }
  return {
    phases: corps.phases.map((p) => ({ id: p.id, libelle: p.libelle })),
    taches,
    jalons: corps.jalons,
  };
}

/** Grades absents du cabinet à l'époque : leurs jours passent au grade indiqué (avant signature). */
async function reporterGrades(
  ctx: ContexteTenantDemo,
  chef: SessionDemo,
  m: MissionBatie,
): Promise<void> {
  const regrade = m.def.regrade;
  if (!regrade) return;
  for (const t of m.taches) {
    if (!t.budget.some((l) => regrade[l.grade_code as keyof typeof regrade])) continue;
    const jours = new Map<string, number>();
    for (const l of t.budget) {
      const cible = regrade[l.grade_code as keyof typeof regrade] ?? l.grade_code;
      jours.set(cible, (jours.get(cible) ?? 0) + l.jours);
    }
    const lignes = [...jours].map(([code, j]) => ({ grade_id: ctx.grades[code], jours: j }));
    attendre(
      200,
      await chef.put(`/api/missions/${m.id}/taches/${t.id}/budget`, { lignes }),
      "report de grade",
    );
  }
}

/** Dates des tâches, dépendances, fenêtres du moteur, dates prévues des jalons. */
async function planifier(
  ctx: ContexteTenantDemo,
  chef: SessionDemo,
  m: MissionBatie,
): Promise<void> {
  const total = (t: TacheLue) => t.budget.reduce((s, l) => s + l.jours, 0);
  const placement = placerTaches(
    m.phases.map((p) => ({
      id: p.id,
      taches: m.taches
        .filter((t) => t.phase_id === p.id)
        .map((t) => ({ id: t.id, jours: total(t) })),
    })),
    m.def.debut,
    m.def.fin,
  );
  for (const t of m.taches) {
    const p = placement.get(t.id);
    if (!p) continue;
    attendre(
      200,
      await chef.patch(`/api/missions/${m.id}/taches/${t.id}`, {
        date_debut: p.debut,
        duree_jours_ouvres: p.duree,
      }),
      `dates de la tâche ${t.libelle}`,
    );
  }
  // Dépendances fin -> début : première -> dernière tâche de chaque phase, puis d'une phase à la suivante.
  const parPhase = m.phases.map((p) => m.taches.filter((t) => t.phase_id === p.id));
  const liens: [TacheLue, TacheLue][] = [];
  for (const [i, taches] of parPhase.entries()) {
    const premiere = taches[0];
    const derniere = taches[taches.length - 1];
    if (premiere && derniere && premiere !== derniere) liens.push([premiere, derniere]);
    const suivante = parPhase[i + 1]?.[0];
    if (derniere && suivante) liens.push([derniere, suivante]);
  }
  for (const [a, b] of liens) {
    attendre(
      201,
      await chef.post(`/api/missions/${m.id}/dependances`, {
        predecesseur_id: a.id,
        successeur_id: b.id,
        decalage: 0,
      }),
      "dépendance",
    );
  }
  const planning = await chef.get(`/api/missions/${m.id}/planning`);
  attendre(200, planning, "planning");
  for (const t of planning.json().taches as { id: string; debut?: string; fin?: string }[]) {
    if (t.debut && t.fin) m.fenetres.set(t.id, { debut: t.debut, fin: t.fin });
  }
  // Jalon : prévu à la fin de la tâche de même libellé (sinon à la fin de la phase).
  for (const j of m.jalons) {
    const tache =
      m.taches.find((t) => t.libelle === j.libelle) ??
      m.taches.find((t) => t.phase_id === j.phase_id);
    const fenetre = tache ? m.fenetres.get(tache.id) : undefined;
    if (!fenetre) continue;
    const date = fenetre.fin > m.def.fin ? m.def.fin : fenetre.fin;
    attendre(
      200,
      await chef.patch(`/api/missions/${m.id}/jalons/${j.id}`, { date_prevue: date }),
      "date de jalon",
    );
  }
}

/** Signature (budget initial figé, débours et sous-traitance prévus) puis démarrage. */
async function signerEtDemarrer(ctx: ContexteTenantDemo, m: MissionBatie): Promise<void> {
  const def = m.def;
  if (!def.signature) return;
  // La sous-traitance est une donnée financière (FIN-02) : elle est saisie par un associé.
  // Un taux de change flottant (USD) est saisi par un associé, lui aussi.
  const devise = deviseDuClient(def.client);
  const signataire =
    def.sousTraitance?.length || devise === "USD"
      ? ctx.session("associe")
      : sessionDe(ctx, def.directeur);
  const lignes = [
    ...def.debours.map((d) => ({
      nature: "debours",
      libelle: d.libelle,
      montant: versDevise(d.montant, devise),
      refacturable: d.refacturable,
    })),
    ...(def.sousTraitance ?? []).map((s) => ({
      nature: "sous_traitance",
      libelle: s.libelle,
      montant: versDevise(s.montant, devise),
      refacturable: false,
    })),
  ];
  attendre(
    200,
    await signataire.post(`/api/missions/${m.id}/signer`, {
      date_signature: def.signature,
      ...(devise === "USD" ? { taux_change: TAUX_USD_XOF } : {}),
      lignes_supplementaires: lignes,
    }),
    `signature de ${def.nom}`,
  );
  if (def.etat === "terminee" || def.etat === "en_cours") {
    attendre(
      200,
      await sessionDe(ctx, def.directeur).post(`/api/missions/${m.id}/statut`, {
        statut: "en_cours",
      }),
      "démarrage",
    );
  }
}

/** Crée la mission complète (hors équipe) et la renvoie avec son découpage relu. */
export async function batirMission(
  ctx: ContexteTenantDemo,
  def: DefMission,
): Promise<MissionBatie> {
  const chef = sessionDe(ctx, def.chef);
  const base = await creerDepuisPipeline(ctx, def);
  const m: MissionBatie = {
    def,
    ...base,
    phases: [],
    taches: [],
    jalons: [],
    fenetres: new Map(),
  };
  Object.assign(m, await lireDecoupage(chef, m.id));
  await reporterGrades(ctx, chef, m);
  Object.assign(m, await lireDecoupage(chef, m.id));
  await planifier(ctx, chef, m);
  await signerEtDemarrer(ctx, m);
  return m;
}

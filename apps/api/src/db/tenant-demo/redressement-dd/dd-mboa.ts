import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  MISSIONS,
  acteursPour,
  assurerEquipe,
  trouverMission,
  type Acteurs,
  type MissionTrouvee,
} from "./commun.js";
import {
  CADRAGE_V1,
  CADRAGE_VERSIONS,
  ETAPES,
  POINTS,
  SOURCES_PREUVES,
  type Auteur,
  type ClePreuve,
} from "./dd-mboa-donnees.js";
import { CONSTATS, RISQUES } from "./dd-mboa-risques-donnees.js";
import { semerMarcheMboa } from "./dd-mboa-marche.js";
import { semerVerdictsMboa } from "./dd-mboa-verdicts.js";
import { Datation, ecrire, lire } from "./dd-outils.js";
import type { Referentiel } from "./dd-referentiel.js";

/*
 * Dossier de due diligence de la mission 4 « Due diligence — Mboa Solaire » (terminée en pratique,
 * mais encore OUVERTE pendant la phase), par les VRAIES routes `/api/dd/**`.
 *
 * Cette première partie pose le cadrage (trois versions), la chaîne de valeur, les analyses
 * (PESTEL, cinq forces, SWOT, opérationnelle), les risques et les constats de signaux, dans l'ordre
 * chronologique des jours de la mission. Chaque affirmation (point, risque) est une assertion du
 * registre des preuves, sourcée par des preuves DÉJÀ semées pour la mission. Les hypothèses, les
 * verdicts, le dimensionnement, le filtrage et le plan des 100 jours sont dans `dd-mboa-verdicts.ts`
 * et `dd-mboa-marche.ts`. Rédacteurs : consultants (`dd.ecrire` + `preuve.ecrire`) ; l'expert métier
 * valide mais n'écrit pas (roles.ts).
 */

export interface Chantier {
  ctx: ContexteTenantDemo;
  a: Acteurs;
  mission: MissionTrouvee;
  dossierId: string;
  dat: Datation;
  /** Identifiant de preuve par clé `p1`…`p8`. */
  preuves: Map<ClePreuve, string>;
  /** Assertion du registre par clé `h1`…`h6`. */
  registre: Map<string, string>;
  /** Point d'analyse par `<analyse>.<catégorie>`. */
  points: Map<string, { id: string; assertion: string }>;
  etapes: Map<string, string>;
  risques: Map<string, string>;
  signaux: Map<string, string>;
  /** Session du rédacteur. */
  par(cle: Auteur): SessionDemo;
  /** Date ISO du jour `j` de la mission. */
  jour(j: number): string;
  /** Remonte à ce jour les lignes créées depuis le dernier marquage. */
  dater(j: number): Promise<void>;
}

async function charger<T extends { id: string }>(
  ctx: ContexteTenantDemo,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const r = await ctx.proprietaire.query(sql, params);
  return r.rows as T[];
}

async function cartes(ctx: ContexteTenantDemo, missionId: string) {
  const preuves = new Map<ClePreuve, string>();
  const lignes = await charger<{ id: string; source: string }>(
    ctx,
    `SELECT p.id, v.source FROM preuves p
       JOIN LATERAL (SELECT source_precise AS source FROM preuve_versions pv WHERE pv.preuve_id = p.id
                     ORDER BY pv.version DESC LIMIT 1) v ON true
      WHERE p.mission_id = $1`,
    [missionId],
  );
  for (const [cle, fragment] of Object.entries(SOURCES_PREUVES) as [ClePreuve, string][]) {
    const l = lignes.find((x) => x.source.includes(fragment));
    if (!l)
      throw new Error(
        `Preuve « ${fragment} » introuvable : le registre des preuves doit passer avant.`,
      );
    preuves.set(cle, l.id);
  }
  const registre = new Map<string, string>();
  const assertions = await charger<{ id: string; enonce: string }>(
    ctx,
    `SELECT a.id, v.enonce FROM assertions a
       JOIN LATERAL (SELECT enonce FROM assertion_versions av WHERE av.assertion_id = a.id
                     ORDER BY av.version DESC LIMIT 1) v ON true
      WHERE a.mission_id = $1 AND v.enonce LIKE 'Mboa Solaire : %'`,
    [missionId],
  );
  const fragments: [string, string][] = [
    ["h1", "le carnet de commandes couvre"],
    ["h2", "le coût de maintenance annuel réel"],
    ["h3", "le tarif de vente retenu"],
    ["h4", "la production réelle"],
    ["h5", "sept clients sur neuf"],
    ["h6", "la croissance annuelle"],
  ];
  for (const [cle, f] of fragments) {
    const l = assertions.find((x) => x.enonce.includes(f));
    if (!l) throw new Error(`Assertion « Mboa Solaire : ${f}… » introuvable.`);
    registre.set(cle, l.id);
  }
  return { preuves, registre };
}

/** Lie des preuves du registre à une assertion (route `/api/assertions/:id/liens`). */
async function sourcer(
  ch: Chantier,
  par: Auteur,
  assertionId: string,
  cles: ClePreuve[],
): Promise<void> {
  for (const cle of cles) {
    await ecrire(
      ch.par(par),
      `/api/assertions/${assertionId}/liens`,
      { preuve_id: ch.preuves.get(cle), sens: "pour" },
      `lien ${cle}`,
    );
  }
}

function affirmation(enonce: string, classe: string, avis?: string) {
  return {
    enonce,
    classe_risque: classe,
    avis_expert: avis !== undefined,
    avis_expert_motif: avis ?? null,
    signer_avis: false,
  };
}

interface Evenement {
  j: number;
  executer: () => Promise<void>;
}

function evenementsAnalyses(ch: Chantier): Evenement[] {
  const d = ch.dossierId;
  const evts: Evenement[] = [];
  let cumul: Record<string, unknown> = { ...CADRAGE_V1 };
  CADRAGE_VERSIONS.forEach((v, i) => {
    cumul = { ...cumul, ...v.corps };
    const corps = { ...cumul, version_courante: i + 1, motif: v.motif };
    evts.push({
      j: v.j,
      executer: async () => {
        await ecrire(ch.par(v.par), `/api/dd/dossiers/${d}/cadrage`, corps, `cadrage v${i + 2}`);
      },
    });
  });
  for (const e of ETAPES) {
    evts.push({
      j: e.j,
      executer: async () => {
        const r = await ecrire<{ id: string }>(
          ch.par("consultant"),
          `/api/dd/dossiers/${d}/chaine/etapes`,
          {
            libelle: e.libelle,
            description: e.description,
            ordre: e.ordre,
            part_cout_bp: e.part_cout_bp,
            part_marge_bp: e.part_marge_bp,
            acteurs: e.acteurs,
            contraintes: e.contraintes,
          },
          `étape ${e.cle}`,
        );
        ch.etapes.set(e.cle, r.id);
      },
    });
  }
  evts.push({
    j: 44,
    executer: async () => {
      await ecrire(
        ch.par("consultant"),
        `/api/dd/etapes/${ch.etapes.get("exploitation")}/versions`,
        {
          version_courante: 1,
          motif: "Contrainte complétée après l'entretien avec le directeur technique.",
          contraintes:
            "Garantie de performance de 92 % du productible théorique, avec pénalités en deçà.",
        },
        "étape exploitation v2",
      );
    },
  });
  for (const p of POINTS) {
    evts.push({
      j: p.j,
      executer: async () => {
        const r = await ecrire<{ id: string; assertion_id: string }>(
          ch.par(p.par),
          `/api/dd/dossiers/${d}/points`,
          {
            analyse: p.analyse,
            categorie: p.categorie,
            libelle: p.libelle,
            niveau: p.niveau ?? null,
            ...affirmation(p.enonce, p.classe, p.avis),
          },
          `point ${p.analyse}.${p.categorie}`,
        );
        ch.points.set(`${p.analyse}.${p.categorie}`, { id: r.id, assertion: r.assertion_id });
        await sourcer(ch, p.par, r.assertion_id, p.preuves);
      },
    });
  }
  const corrections: [string, number, Auteur, "faible" | "modere" | "eleve", string][] = [
    [
      "cinq_forces.pouvoir_clients",
      47,
      "consultant",
      "eleve",
      "Niveau relevé : les trois plus gros clients pèsent 52 % du montant signé.",
    ],
    [
      "pestel.economique",
      61,
      "consultant",
      "eleve",
      "Niveau relevé après l'arbitrage sur le tarif de 112 XOF/kWh.",
    ],
    [
      "pestel.environnemental",
      66,
      "consultant2",
      "faible",
      "Niveau abaissé : Mboa a engagé un programme de nettoyage.",
    ],
  ];
  for (const [cle, j, par, niveau, motif] of corrections) {
    evts.push({
      j,
      executer: async () => {
        await ecrire(
          ch.par(par),
          `/api/dd/points/${ch.points.get(cle)?.id}/versions`,
          { version_courante: 1, motif, niveau },
          `point ${cle} v2`,
        );
      },
    });
  }
  for (const r of RISQUES) {
    evts.push({
      j: r.j,
      executer: async () => {
        const c = await ecrire<{ id: string; assertion_id: string }>(
          ch.par(r.par),
          `/api/dd/dossiers/${d}/risques`,
          {
            famille: r.famille,
            niveau: r.niveau,
            libelle: r.libelle,
            etape_id: r.etape ? (ch.etapes.get(r.etape) ?? null) : null,
            signal_id: r.signal ? (ch.signaux.get(r.signal) ?? null) : null,
            ...(r.motifEcart ? { motif_ecart: r.motifEcart } : {}),
            ...affirmation(r.enonce, r.classe, r.avis),
          },
          `risque ${r.cle}`,
        );
        ch.risques.set(r.cle, c.id);
        await sourcer(ch, r.par, c.assertion_id, r.preuves);
      },
    });
  }
  for (const c of CONSTATS) {
    evts.push({
      j: c.j,
      executer: async () => {
        const id = ch.signaux.get(c.signal);
        await ecrire(
          ch.par(c.par),
          `/api/dd/dossiers/${d}/signaux/${id}/constats`,
          {
            etat: c.etat,
            commentaire: c.commentaire,
            risque_id: c.risque ? (ch.risques.get(c.risque) ?? null) : null,
          },
          `constat ${c.signal}`,
        );
      },
    });
  }
  return evts.sort((x, y) => x.j - y.j);
}

export async function semerDdMboa(ctx: ContexteTenantDemo, ref: Referentiel): Promise<string> {
  const a = await acteursPour(ctx, MISSIONS.ddTerminee);
  const mission = await trouverMission(ctx, MISSIONS.ddTerminee);
  if (!mission.dateDebut) throw new Error("La mission Mboa Solaire n'a pas de date de début.");
  const existants = await lire<{ elements: unknown[] }>(
    a.consultant,
    `/api/missions/${mission.id}/dd/dossiers`,
    "dossiers existants",
  );
  if (existants.elements.length > 0) {
    throw new Error("La mission Mboa Solaire porte déjà un dossier de due diligence.");
  }
  await assurerEquipe(ctx, mission.id, [
    ctx.utilisateurs["expert.metier"] ?? "",
    ctx.utilisateurs["expert.metier.2"] ?? "",
  ]);
  const dat = new Datation(ctx, mission.dateDebut);
  await dat.relever();
  const { preuves, registre } = await cartes(ctx, mission.id);
  const sessions = { consultant: a.consultant, consultant2: a.consultant2 };

  const dossier = await ecrire<{ id: string }>(
    a.consultant,
    `/api/missions/${mission.id}/dd/dossiers`,
    CADRAGE_V1,
    "dossier Mboa",
  );
  const ch: Chantier = {
    ctx,
    a,
    mission,
    dossierId: dossier.id,
    dat,
    preuves,
    registre,
    points: new Map(),
    etapes: new Map(),
    risques: new Map(),
    signaux: ref.signaux,
    par: (cle) => sessions[cle],
    jour: (j) => dat.jourIso(j),
    dater: (j) => dat.dater(dat.jourIso(j), { dossierId: dossier.id, missionId: mission.id }),
  };
  await ch.dater(3);
  for (const e of evenementsAnalyses(ch)) {
    await e.executer();
    await ch.dater(e.j);
  }
  ctx.journal(
    `  DD Mboa : ${POINTS.length} points, ${ETAPES.length} étapes, ${RISQUES.length} risques.`,
  );
  await semerVerdictsMboa(ch);
  await semerMarcheMboa(ch, ref);
  return dossier.id;
}

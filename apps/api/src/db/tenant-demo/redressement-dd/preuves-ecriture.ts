import type { FiabilitePreuve, TypeSourcePreuve } from "@missionpilot/shared";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  acteursPour,
  appliquerSql,
  assurerEquipe,
  attendre,
  trouverMission,
  type MissionTrouvee,
  type NomMission,
} from "./commun.js";

/*
 * Moteur du registre des preuves de la démonstration (PRV-01 à PRV-05) : types des définitions
 * (données dans preuves-donnees-*.ts) et exécution par les VRAIES routes de l'API
 * (/api/missions/:id/preuves, /assertions, /preuves/:id/versions, /assertions/:id/liens,
 * /assertions/:id/arbitrages), chacune avec la session d'un compte qui a `preuve.ecrire`.
 *
 * Ordre d'exécution d'une mission (les missions 1 à 5 restent OUVERTES pendant la phase : aucune
 * réouverture, aucun contournement) :
 *   1. dimensions ; 2. preuves et leurs révisions (nouvelles versions) ; 3. assertions et liens
 *   « pour » ou « contre » ; 4. arbitrages (par un compte différent des auteurs, sinon la route
 *   répond 409) ; 5. corrections d'assertion et changements de sens de lien postérieurs à
 *   l'arbitrage (`apres: true`).
 *
 * Les tables du registre sont en ajout seul et horodatées « maintenant » par les routes : chaque
 * ligne est ensuite antidatée (`cree_le`, `arbitre_le`) à son jour dans la mission, par des
 * requêtes littérales (appliquerSql), en gardant l'ordre chronologique. Les jours sont des
 * décalages en jours depuis le début de la mission, bornés à sa fin.
 */

export type CleActeur =
  | "associe"
  | "associe2"
  | "directeur"
  | "directeur2"
  | "chef"
  | "chef2"
  | "consultant"
  | "consultant2"
  | "junior";

export interface DefDimension {
  code: string;
  libelle: string;
}

export interface DefRevision {
  j: number;
  par: CleActeur;
  motif: string;
  fiabilite?: FiabilitePreuve;
  extrait?: string;
  source?: string;
}

export interface DefPreuve {
  cle: string;
  type: TypeSourcePreuve;
  source: string;
  j: number;
  fiabilite: FiabilitePreuve;
  extrait: string;
  dims: string[];
  par: CleActeur;
  /** Auteur désigné quand il diffère du saisisseur (membre de l'équipe). */
  auteur?: CleActeur;
  /** Verbatim nominatif ? (défaut de la route : vrai pour entretien et questionnaire). */
  nominatif?: boolean;
  accord?: boolean;
  revision?: DefRevision;
}

export interface DefLien {
  preuve: string;
  sens: "pour" | "contre";
  j: number;
  par: CleActeur;
  /** Posé après l'arbitrage (changement de sens consécutif à une reformulation). */
  apres?: boolean;
}

export interface DefArbitrage {
  preuve: string;
  decision: "contradiction_levee" | "contradiction_maintenue";
  motif: string;
  par: CleActeur;
  j: number;
}

export interface DefCorrection {
  j: number;
  par: CleActeur;
  enonce: string;
  motif: string;
  statut?: "brouillon" | "retenue" | "abandonnee";
}

export interface DefAssertion {
  cle: string;
  enonce: string;
  classe: "R0" | "R1" | "R2" | "R3";
  livrable: string;
  dim?: string;
  j: number;
  par: CleActeur;
  statut?: "brouillon" | "retenue";
  /** Avis d'expert signé (sans preuve) : réservé à l'associé ou à l'expert métier. */
  avis?: string;
  liens: DefLien[];
  arbitrage?: DefArbitrage;
  correction?: DefCorrection;
}

export interface DefMissionPreuves {
  mission: NomMission;
  /** Comptes à ajouter à l'équipe de la mission (le directeur et le chef y sont déjà). */
  equipe: CleActeur[];
  dimensions: DefDimension[];
  preuves: DefPreuve[];
  assertions: DefAssertion[];
}

/** Jour ISO situé `j` jours après `debut`, borné à `fin` (aucune horloge système). */
export function jourDe(debut: string, j: number, fin: string): string {
  const t = Date.parse(`${debut}T00:00:00Z`) + j * 86_400_000;
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso > fin ? fin : iso;
}

interface Resultat {
  id: string;
  version?: number;
}

class Chantier {
  private rang = 0;
  readonly preuves = new Map<string, { id: string; version: number }>();
  readonly assertions = new Map<string, string>();

  constructor(
    readonly ctx: ContexteTenantDemo,
    readonly mission: MissionTrouvee,
    readonly def: DefMissionPreuves,
    private readonly sessions: Record<CleActeur, SessionDemo>,
  ) {}

  /** Jour de la mission. */
  jour(j: number): string {
    return jourDe(
      this.mission.dateDebut ?? this.ctx.debut,
      j,
      this.mission.dateFin ?? this.ctx.aujourdhui,
    );
  }

  /** Horodatage croissant (3 minutes d'écart) pour garder l'ordre des écritures d'un même jour. */
  quand(j: number): string {
    this.rang += 1;
    const base = Date.parse(`${this.jour(j)}T08:00:00Z`);
    return new Date(base + (this.rang % 150) * 180_000).toISOString();
  }

  s(cle: CleActeur): SessionDemo {
    return this.sessions[cle];
  }

  async poster(par: CleActeur, url: string, corps: unknown, quoi: string): Promise<Resultat> {
    const r = await this.s(par).post(url, corps);
    attendre(201, r, `${quoi} (${this.mission.nom})`);
    return r.json() as Resultat;
  }

  preuve(cle: string): { id: string; version: number } {
    const p = this.preuves.get(cle);
    if (!p) throw new Error(`Preuve « ${cle} » inconnue (${this.mission.nom}).`);
    return p;
  }
}

async function dimensions(ch: Chantier): Promise<void> {
  const url = `/api/missions/${ch.mission.id}/preuves/dimensions`;
  for (const d of ch.def.dimensions) {
    await ch.poster("chef", url, d, `dimension ${d.code}`);
    await appliquerSql(
      ch.ctx,
      "UPDATE preuve_dimensions SET cree_le = $1::timestamptz WHERE mission_id = $2 AND code = $3",
      [ch.quand(0), ch.mission.id, d.code],
    );
  }
}

async function preuves(ch: Chantier): Promise<void> {
  for (const p of ch.def.preuves) {
    const corps = {
      type_source: p.type,
      source_precise: p.source,
      date_preuve: ch.jour(p.j),
      fiabilite: p.fiabilite,
      extrait: p.extrait,
      dimensions: p.dims,
      ...(p.auteur ? { auteur_id: ch.s(p.auteur).utilisateurId } : {}),
      ...(p.nominatif !== undefined ? { nominatif: p.nominatif } : {}),
      accord_nominatif: p.accord ?? false,
    };
    const cree = await ch.poster(
      p.par,
      `/api/missions/${ch.mission.id}/preuves`,
      corps,
      `preuve ${p.cle}`,
    );
    ch.preuves.set(p.cle, { id: cree.id, version: 1 });
    const t = ch.quand(p.j);
    await appliquerSql(ch.ctx, "UPDATE preuves SET cree_le = $1::timestamptz WHERE id = $2", [
      t,
      cree.id,
    ]);
    await appliquerSql(
      ch.ctx,
      "UPDATE preuve_versions SET cree_le = $1::timestamptz WHERE preuve_id = $2 AND version = 1",
      [t, cree.id],
    );
    const rev = p.revision;
    if (!rev) continue;
    await ch.poster(
      rev.par,
      `/api/preuves/${cree.id}/versions`,
      {
        ...corps,
        date_preuve: ch.jour(rev.j),
        fiabilite: rev.fiabilite ?? p.fiabilite,
        extrait: rev.extrait ?? p.extrait,
        source_precise: rev.source ?? p.source,
        motif: rev.motif,
      },
      `révision ${p.cle}`,
    );
    ch.preuves.set(p.cle, { id: cree.id, version: 2 });
    await appliquerSql(
      ch.ctx,
      "UPDATE preuve_versions SET cree_le = $1::timestamptz WHERE preuve_id = $2 AND version = 2",
      [ch.quand(rev.j), cree.id],
    );
  }
}

async function poserLien(ch: Chantier, assertionId: string, l: DefLien): Promise<void> {
  const preuve = ch.preuve(l.preuve);
  await ch.poster(
    l.par,
    `/api/assertions/${assertionId}/liens`,
    { preuve_id: preuve.id, sens: l.sens },
    `lien ${l.preuve}`,
  );
  await appliquerSql(
    ch.ctx,
    `UPDATE assertion_preuve_liens SET cree_le = $1::timestamptz
      WHERE assertion_id = $2 AND preuve_id = $3 AND action = 'lier' AND sens = $4`,
    [ch.quand(l.j), assertionId, preuve.id, l.sens],
  );
}

async function assertions(ch: Chantier): Promise<void> {
  for (const a of ch.def.assertions) {
    const cree = await ch.poster(
      a.par,
      `/api/missions/${ch.mission.id}/assertions`,
      {
        enonce: a.enonce,
        classe_risque: a.classe,
        livrable: a.livrable,
        statut: a.statut ?? "brouillon",
        ...(a.dim ? { rattachement_type: "dimension", rattachement_code: a.dim } : {}),
        ...(a.avis ? { avis_expert: true, avis_expert_motif: a.avis, signer_avis: true } : {}),
      },
      `assertion ${a.cle}`,
    );
    ch.assertions.set(a.cle, cree.id);
    const t = ch.quand(a.j);
    await appliquerSql(ch.ctx, "UPDATE assertions SET cree_le = $1::timestamptz WHERE id = $2", [
      t,
      cree.id,
    ]);
    await appliquerSql(
      ch.ctx,
      `UPDATE assertion_versions SET cree_le = $1::timestamptz,
         signe_le = CASE WHEN signe_le IS NULL THEN NULL ELSE $1::timestamptz END
        WHERE assertion_id = $2 AND version = 1`,
      [t, cree.id],
    );
    for (const l of a.liens.filter((x) => !x.apres)) await poserLien(ch, cree.id, l);
  }
}

async function arbitrages(ch: Chantier): Promise<void> {
  for (const a of ch.def.assertions) {
    const arb = a.arbitrage;
    if (!arb) continue;
    const id = ch.assertions.get(a.cle) as string;
    const preuve = ch.preuve(arb.preuve);
    await ch.poster(
      arb.par,
      `/api/assertions/${id}/arbitrages`,
      { preuve_id: preuve.id, decision: arb.decision, motif: arb.motif },
      `arbitrage ${a.cle}`,
    );
    await appliquerSql(
      ch.ctx,
      `UPDATE preuve_arbitrages SET arbitre_le = $1::timestamptz
        WHERE assertion_id = $2 AND preuve_id = $3`,
      [ch.quand(arb.j), id, preuve.id],
    );
  }
}

async function corrections(ch: Chantier): Promise<void> {
  for (const a of ch.def.assertions) {
    const id = ch.assertions.get(a.cle) as string;
    const c = a.correction;
    if (c) {
      await ch.poster(
        c.par,
        `/api/assertions/${id}/versions`,
        {
          enonce: c.enonce,
          classe_risque: a.classe,
          livrable: a.livrable,
          statut: c.statut ?? "retenue",
          ...(a.dim ? { rattachement_type: "dimension", rattachement_code: a.dim } : {}),
          motif: c.motif,
        },
        `correction ${a.cle}`,
      );
      await appliquerSql(
        ch.ctx,
        "UPDATE assertion_versions SET cree_le = $1::timestamptz WHERE assertion_id = $2 AND version = 2",
        [ch.quand(c.j), id],
      );
    }
    for (const l of a.liens.filter((x) => x.apres)) await poserLien(ch, id, l);
  }
}

/** Sème le registre d'UNE mission ; sans effet si elle porte déjà des preuves. */
export async function semerRegistreMission(
  ctx: ContexteTenantDemo,
  def: DefMissionPreuves,
): Promise<void> {
  const mission = await trouverMission(ctx, def.mission);
  const deja = await ctx.proprietaire.query(
    "SELECT count(*)::int AS n FROM preuves WHERE mission_id = $1",
    [mission.id],
  );
  if ((deja.rows[0]?.n as number) > 0) {
    ctx.journal(`  registre « ${def.mission} » déjà semé.`);
    return;
  }
  const a = await acteursPour(ctx, def.mission);
  const sessions: Record<CleActeur, SessionDemo> = {
    associe: a.associe,
    associe2: a.associe2,
    directeur: a.directeur,
    directeur2: a.directeur2,
    chef: a.chef,
    chef2: a.chef2,
    consultant: a.consultant,
    consultant2: a.consultant2,
    junior: a.junior,
  };
  await assurerEquipe(
    ctx,
    mission.id,
    def.equipe.map((c) => sessions[c].utilisateurId),
  );
  const ch = new Chantier(ctx, mission, def, sessions);
  await dimensions(ch);
  await preuves(ch);
  await assertions(ch);
  await arbitrages(ch);
  await corrections(ch);
  ctx.journal(
    `  registre « ${def.mission} » : ${def.preuves.length} preuves, ${def.assertions.length} assertions.`,
  );
}

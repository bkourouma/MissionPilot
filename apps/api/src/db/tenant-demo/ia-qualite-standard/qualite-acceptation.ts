import { ajouterJours } from "@missionpilot/engines";
import { niveauDesFacteurs } from "../../../qualite/acceptation.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { CASTING, compterLignes } from "./commun.js";
import {
  ACCEPTATION_VIVE,
  ACCEPTATIONS,
  RELATIONS,
  SATISFACTIONS,
} from "./qualite-donnees-client.js";
import {
  Chrono,
  acteur,
  jourOuvre,
  present,
  transaction,
  type InfoMission,
} from "./qualite-outils.js";

/*
 * Acceptation de mission et conflits d'intérêts (QUA-07), satisfaction du client (QUA-08).
 * Tables en ajout seul : les lignes passées sont insérées avec leur date (SQL paramétré) ; ce qui
 * se passe AUJOURD'HUI (évaluation de la mission en proposition, notes de jalons récentes) passe
 * par les vraies routes. Les conflits figés dans chaque évaluation sont recalculés à la date de
 * l'évaluation à partir des relations alors actives.
 */

const NIVEAUX = ["faible", "moyen", "eleve"] as const;

/** Relations déclarées entre clients, avec leurs retraits (événements datés). */
export async function semerRelations(ctx: ContexteTenantDemo): Promise<void> {
  const alea = ctx.alea.deriver("qualite:relations");
  for (const r of RELATIONS) {
    const client = ctx.client(r.client);
    const lie = ctx.client(r.lie);
    const quand = (date: string): string =>
      new Chrono(date, alea, ctx.aujourdhui).minutes(alea.entier(0, 120)).iso();
    const existe = await compterLignes(
      ctx,
      `SELECT count(*) AS n FROM qualite_relations_clients
        WHERE nature = $3 AND ((client_id = $1 AND client_lie_id = $2) OR (client_id = $2 AND client_lie_id = $1))`,
      [client, lie, r.nature],
    );
    if (existe > 0) continue;
    const par = present("associe", r.date)
      ? acteur(ctx, "associe")
      : acteur(ctx, "directeur.mission");
    await transaction(ctx, async () => {
      const ins = await ctx.proprietaire.query<{ id: string }>(
        `INSERT INTO qualite_relations_clients (cabinet_id, client_id, client_lie_id, nature, note, cree_par, cree_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [ctx.cabinetId, client, lie, r.nature, r.note, par.id, quand(r.date)],
      );
      if (r.retrait) {
        await ctx.proprietaire.query(
          `INSERT INTO qualite_relations_retraits (cabinet_id, relation_id, retire_par, retire_le)
           VALUES ($1, $2, $3, $4)`,
          [
            ctx.cabinetId,
            ins.rows[0]!.id,
            acteur(ctx, "directeur.mission").id,
            quand(r.retrait.date),
          ],
        );
      }
    });
  }
}

interface ConflitFige {
  relation_id: string;
  nature: string;
  client_lie_id: string;
  client_lie_nom: string;
  missions_en_cours: number;
  note: string | null;
}

/** Conflits d'une mission à une date : relations déjà déclarées et pas encore retirées. */
async function conflitsA(
  ctx: ContexteTenantDemo,
  clientId: string,
  date: string,
): Promise<ConflitFige[]> {
  const r = await ctx.proprietaire.query<{
    id: string;
    nature: string;
    note: string | null;
    lie: string;
    nom: string;
  }>(
    `SELECT r.id, r.nature, r.note, c.id AS lie, c.raison_sociale AS nom
       FROM qualite_relations_clients r
       JOIN clients c ON c.id = CASE WHEN r.client_id = $1 THEN r.client_lie_id ELSE r.client_id END
      WHERE (r.client_id = $1 OR r.client_lie_id = $1)
        AND (r.cree_le AT TIME ZONE 'UTC')::date <= $2::date
        AND NOT EXISTS (SELECT 1 FROM qualite_relations_retraits x
                         WHERE x.relation_id = r.id AND (x.retire_le AT TIME ZONE 'UTC')::date <= $2::date)
      ORDER BY r.cree_le, r.id`,
    [clientId, date],
  );
  return r.rows.map((l) => {
    const cle = (Object.entries(ctx.clients) as [string, string][]).find(
      ([, id]) => id === l.lie,
    )?.[0];
    const enCours = Object.values(CASTING).filter(
      (m) => m.client === cle && m.debut <= date && m.fin >= date && m.etat !== "preparation",
    ).length;
    return {
      relation_id: l.id,
      nature: l.nature,
      client_lie_id: l.lie,
      client_lie_nom: l.nom,
      missions_en_cours: enCours,
      note: l.note,
    };
  });
}

async function evaluation(
  ctx: ContexteTenantDemo,
  info: InfoMission,
  rang: number,
  quand: string,
  par: string,
  p: { facteurs: string[]; releve?: "moyen" | "eleve"; decision: string; motif: string | null },
): Promise<void> {
  const calcule = niveauDesFacteurs(p.facteurs);
  const retenu =
    p.releve && NIVEAUX.indexOf(p.releve) > NIVEAUX.indexOf(calcule) ? p.releve : calcule;
  const conflits = await conflitsA(ctx, info.mission.clientId, quand.slice(0, 10));
  await ctx.proprietaire.query(
    `INSERT INTO qualite_acceptations (cabinet_id, mission_id, client_id, rang, conflits, profil_risque,
       niveau_risque, decision, motif, evalue_par, evalue_le)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      ctx.cabinetId,
      info.mission.id,
      info.mission.clientId,
      rang,
      JSON.stringify(conflits),
      JSON.stringify({ facteurs: p.facteurs, niveau_calcule: calcule, niveau_retenu: retenu }),
      retenu,
      p.decision,
      p.motif,
      par,
      quand,
    ],
  );
}

/** Évaluations d'acceptation : « en attente » par le chef, puis décision d'un signataire. */
export async function semerAcceptations(
  ctx: ContexteTenantDemo,
  infos: Map<string, InfoMission>,
): Promise<void> {
  const alea = ctx.alea.deriver("qualite:acceptations");
  for (const a of ACCEPTATIONS) {
    const info = infos.get(a.mission);
    if (!info) throw new Error(`Mission ${a.mission} absente du casting.`);
    if (
      (await compterLignes(
        ctx,
        "SELECT count(*) AS n FROM qualite_acceptations WHERE mission_id = $1",
        [info.mission.id],
      )) > 0
    )
      continue;
    const reference = info.dateSignature ?? info.mission.debut ?? CASTING[a.mission].debut;
    const jourDecision = jourOuvre(ajouterJours(reference, -a.avant));
    const jourAttente = jourOuvre(ajouterJours(jourDecision, -a.attente));
    const decideur = present(info.directeur.cle, jourDecision)
      ? info.directeur
      : acteur(ctx, "associe");
    await transaction(ctx, async () => {
      await evaluation(
        ctx,
        info,
        1,
        new Chrono(jourAttente, alea, ctx.aujourdhui).iso(),
        info.chef.id,
        {
          facteurs: a.facteurs,
          decision: "en_attente",
          motif: null,
        },
      );
      await evaluation(
        ctx,
        info,
        2,
        new Chrono(jourDecision, alea, ctx.aujourdhui).minutes(90).iso(),
        decideur.id,
        {
          facteurs: a.facteurs,
          releve: a.releve,
          decision: a.decision ?? "en_attente",
          motif: a.motif ?? null,
        },
      );
    });
  }
}

/** Mission en proposition : évaluation du jour, par la vraie route (décision encore en attente). */
export async function evaluerMissionEnProposition(
  ctx: ContexteTenantDemo,
  infos: Map<string, InfoMission>,
): Promise<void> {
  const info = infos.get(ACCEPTATION_VIVE.mission);
  if (!info) throw new Error(`Mission ${ACCEPTATION_VIVE.mission} absente du casting.`);
  if (
    (await compterLignes(
      ctx,
      "SELECT count(*) AS n FROM qualite_acceptations WHERE mission_id = $1",
      [info.mission.id],
    )) > 0
  )
    return;
  const r = await ctx
    .session(info.chef.cle)
    .post(`/api/qualite/missions/${info.mission.id}/acceptation`, {
      facteurs: ACCEPTATION_VIVE.facteurs,
      decision: "en_attente",
    });
  attendre(200, r, `évaluation d'acceptation de ${info.mission.intitule}`);
}

interface Jalon {
  id: string;
  date_prevue: string;
}

/** Satisfaction : notes de jalons (routes si récentes, sinon insertion datée) et note de clôture. */
export async function semerSatisfactions(
  ctx: ContexteTenantDemo,
  infos: Map<string, InfoMission>,
): Promise<void> {
  const alea = ctx.alea.deriver("qualite:satisfactions");
  for (const s of SATISFACTIONS) {
    const info = infos.get(s.mission);
    if (!info) throw new Error(`Mission ${s.mission} absente du casting.`);
    const m = info.mission;
    const jalons = (
      await ctx.proprietaire.query<Jalon>(
        `SELECT id, date_prevue::text FROM mission_jalons
          WHERE mission_id = $1 AND date_prevue IS NOT NULL AND date_prevue <= $2::date
          ORDER BY date_prevue, ordre, id`,
        [m.id, ajouterJours(ctx.aujourdhui, -3)],
      )
    ).rows;
    const terminee = CASTING[s.mission].etat === "terminee";
    for (const [k, jalon] of jalons.slice(0, s.jalons.length).entries()) {
      const note = s.jalons[k] as number;
      const commentaire = s.commentaires[k] ?? null;
      const quand = new Chrono(
        jourOuvre(ajouterJours(jalon.date_prevue, 2 + (k % 3))),
        alea,
        ctx.aujourdhui,
      );
      if (terminee && quand.date() > CASTING[s.mission].fin) continue;
      if (
        (await compterLignes(
          ctx,
          "SELECT count(*) AS n FROM qualite_satisfactions WHERE mission_id = $1 AND cle = $2",
          [m.id, jalon.id],
        )) > 0
      )
        continue;
      if (jalon.date_prevue >= ajouterJours(ctx.aujourdhui, -21)) {
        const r = await ctx
          .session(info.chef.cle)
          .post(`/api/qualite/missions/${m.id}/satisfactions`, {
            moment: "jalon",
            jalon_id: jalon.id,
            note,
            commentaire,
            repondant: s.repondant,
          });
        attendre(201, r, `satisfaction du jalon ${jalon.id}`);
      } else {
        await ctx.proprietaire.query(
          `INSERT INTO qualite_satisfactions (cabinet_id, mission_id, moment, jalon_id, cle, rang, note,
             commentaire, repondant, saisi_par, saisi_le)
           VALUES ($1, $2, 'jalon', $3, $4, 1, $5, $6, $7, $8, $9)`,
          [
            ctx.cabinetId,
            m.id,
            jalon.id,
            jalon.id,
            note,
            commentaire,
            s.repondant,
            info.chef.id,
            quand.iso(),
          ],
        );
      }
    }
    if (!s.cloture) continue;
    const fin = CASTING[s.mission].fin;
    const noteCloture = async (
      rang: number,
      note: number,
      jours: number,
      texte: string,
    ): Promise<void> => {
      if (
        (await compterLignes(
          ctx,
          "SELECT count(*) AS n FROM qualite_satisfactions WHERE mission_id = $1 AND cle = 'cloture' AND rang = $2",
          [m.id, rang],
        )) > 0
      )
        return;
      const quand = new Chrono(ajouterJours(fin, jours), alea, ctx.aujourdhui).iso();
      await ctx.proprietaire.query(
        `INSERT INTO qualite_satisfactions (cabinet_id, mission_id, moment, jalon_id, cle, rang, note,
           commentaire, repondant, saisi_par, saisi_le)
         VALUES ($1, $2, 'cloture', NULL, 'cloture', $3, $4, $5, $6, $7, $8)`,
        [ctx.cabinetId, m.id, rang, note, texte, s.repondant, info.directeur.id, quand],
      );
    };
    await noteCloture(
      1,
      s.cloture.note,
      3,
      "Bilan de fin de mission recueilli lors de la restitution finale.",
    );
    if (s.cloture.correction !== undefined) {
      await noteCloture(
        2,
        s.cloture.correction,
        12,
        "Note revue à la hausse après la décision de financement des banques.",
      );
    }
  }
}

import {
  ajouterJours,
  calculerRevueFroide,
  tirerEchantillon,
  type CandidatEchantillon,
} from "@missionpilot/engines";
import { CRITERES_REVUE_FROIDE, GRILLE_REVUE_FROIDE_VERSION } from "@missionpilot/shared";
import {
  candidatsRelecteurs,
  contexteIndependance,
  jugerIndependance,
} from "../../../qualite/froide-donnees.js";
import type { ContexteTenantDemo } from "../contexte.js";
import type { CleMission } from "./commun.js";
import {
  ORDRE_CRITERES,
  REVUES,
  type CampagneModele,
  type RevueModele,
} from "./qualite-froide-donnees.js";
import { Chrono, acteur, acteurDe, jourOuvre, present, transaction } from "./qualite-outils.js";

/*
 * Campagnes de revue à froid PASSÉES (QUA-05), écrites avec leurs dates : la création d'une
 * campagne, une affectation terminée ou un historique d'action sont figés par des déclencheurs
 * (MQQ01 à MQQ04) et les routes les datent « maintenant ». Le tirage vient du moteur
 * (`tirerEchantillon`, même requête de population que l'API), le score et la conclusion du moteur
 * `calculerRevueFroide`, le relecteur est jugé indépendant par le moteur d'indépendance (puis par
 * le déclencheur MQQ03 à l'insertion). Écrit en SQL paramétré, tables en dur.
 */

export interface MissionCloturee {
  cle: CleMission;
  id: string;
  /** Jour de clôture (UTC), AAAA-MM-JJ. */
  cloture: string;
}

const POIDS = CRITERES_REVUE_FROIDE.map((c) => ({ code: c.code, poids: c.poids }));

export interface RelecteurChoisi {
  id: string;
  role: string;
}

const rangRoles = (roles: readonly string[]): number =>
  roles.includes("expert_metier") ? 0 : roles.includes("directeur_mission") ? 1 : 2;

/**
 * Relecteurs INDÉPENDANTS de la mission (règle QUA-05 jugée par le moteur d'indépendance : ni
 * directeur, chef, membre d'équipe, affecté du planning, créateur, clôtureur, signataire, ni
 * auteur, ouvreur, valideur, signataire ou attestateur d'un suivi qualité de la mission). Le
 * vivier est celui de l'API : TOUS les comptes actifs habilités à relire, avec ou sans clé du
 * contexte (comptes ajoutés par d'autres lots). `date` : un compte du seed n'est retenu que s'il
 * est déjà arrivé au cabinet à cette date (null : aucune contrainte de présence). Experts métier
 * d'abord, puis directeurs de mission, puis les autres ; ordre stable par nom.
 */
export async function relecteursIndependants(
  ctx: ContexteTenantDemo,
  missionId: string,
  date: string | null,
): Promise<RelecteurChoisi[]> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const contexte = await contexteIndependance(db, missionId);
    return (await candidatsRelecteurs(db))
      .filter((u) => jugerIndependance(contexte, u.id).independant)
      .filter((u) => {
        const a = acteurDe(ctx, u.id);
        return date === null || a === undefined || present(a.cle, date);
      })
      .map((u) => ({ id: u.id, role: u.roles[0] ?? "", rang: rangRoles(u.roles) }))
      .sort((x, y) => x.rang - y.rang)
      .map(({ id, role }) => ({ id, role }));
  });
}

/** Un relecteur indépendant (rotation parmi les meilleurs rangs), ou null s'il n'y en a aucun. */
export async function choisirRelecteur(
  ctx: ContexteTenantDemo,
  missionId: string,
  date: string,
  rotation: number,
): Promise<RelecteurChoisi | null> {
  const tries =
    (await relecteursIndependants(ctx, missionId, date)).length > 0
      ? await relecteursIndependants(ctx, missionId, date)
      : await relecteursIndependants(ctx, missionId, null);
  if (tries.length === 0) return null;
  const rang = (r: RelecteurChoisi): number => rangRoles([r.role]);
  const meilleurs = tries.filter((r) => rang(r) === rang(tries[0] as RelecteurChoisi));
  return meilleurs[rotation % meilleurs.length] as RelecteurChoisi;
}

function modeleDe(cle: CleMission): RevueModele {
  const m = REVUES[cle as keyof typeof REVUES];
  if (!m) throw new Error(`Pas de jeu de revue à froid pour la mission ${cle}.`);
  return m;
}

/** Une revue du début à la fin : affectation, grille, constats, terminaison. Renvoie la date de fin. */
async function revuePassee(
  ctx: ContexteTenantDemo,
  chrono: Chrono,
  echantillonId: string,
  mission: MissionCloturee,
  gestionnaire: string,
  rotation: number,
): Promise<{ fin: string; constats: string[] }> {
  const modele = modeleDe(mission.cle);
  const relecteur = await choisirRelecteur(ctx, mission.id, chrono.date(), rotation);
  if (!relecteur) throw new Error(`Aucun relecteur indépendant disponible pour ${mission.cle}.`);
  const c = ctx.proprietaire;
  await c.query(
    `UPDATE qualite_froide_echantillon SET relecteur_id = $2, affecte_par = $3, affecte_le = $4, statut = 'affectee'
      WHERE id = $1`,
    [echantillonId, relecteur.id, gestionnaire, chrono.iso()],
  );
  chrono.jours(4);
  const evaluations = ORDRE_CRITERES.map((critere, i) => ({
    critere,
    note: modele.notes[i] ?? null,
    commentaire: modele.commentaires[critere] ?? null,
  }));
  for (const [i, e] of evaluations.entries()) {
    chrono.minutes(i === 0 ? 0 : 20 + (i % 3) * 25);
    await c.query(
      `INSERT INTO qualite_froide_evaluations (cabinet_id, echantillon_id, critere, note, commentaire, evaluateur_id, evalue_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.cabinetId, echantillonId, e.critere, e.note, e.commentaire, relecteur.id, chrono.iso()],
    );
    if (i === 0) {
      await c.query("UPDATE qualite_froide_echantillon SET statut = 'en_revue' WHERE id = $1", [
        echantillonId,
      ]);
    }
  }
  const constats: string[] = [];
  for (const k of modele.constats) {
    chrono.minutes(35);
    const r = await c.query<{ id: string }>(
      `INSERT INTO qualite_froide_constats (cabinet_id, echantillon_id, critere, gravite, description, recommandation, auteur_id, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        ctx.cabinetId,
        echantillonId,
        k.critere,
        k.gravite,
        k.description,
        k.recommandation,
        relecteur.id,
        chrono.iso(),
      ],
    );
    constats.push(r.rows[0]!.id);
  }
  const resultat = calculerRevueFroide(
    POIDS,
    evaluations.map((e) => ({ critere: e.critere, note: e.note })),
    modele.constats,
  );
  if (!resultat.complete || resultat.score === null || resultat.conclusion === null) {
    throw new Error(`Revue à froid de ${mission.cle} : la grille ne permet pas de conclure.`);
  }
  chrono.jours(2);
  await c.query(
    `UPDATE qualite_froide_echantillon
        SET statut = 'terminee', score = $2, conclusion = $3, synthese = $4, version_grille = $5, terminee_le = $6
      WHERE id = $1`,
    [
      echantillonId,
      resultat.score,
      resultat.conclusion,
      modele.synthese,
      GRILLE_REVUE_FROIDE_VERSION,
      chrono.iso(),
    ],
  );
  return { fin: chrono.date(), constats };
}

/** Campagne passée complète : tirage, revues, clôture et plan d'amélioration. */
export async function campagnePassee(
  ctx: ContexteTenantDemo,
  modele: CampagneModele,
  chronologie: MissionCloturee[],
  numero: number,
): Promise<boolean> {
  const deja = await ctx.proprietaire.query(
    "SELECT 1 FROM qualite_froide_campagnes WHERE intitule = $1",
    [modele.intitule],
  );
  if ((deja.rowCount ?? 0) > 0) return false;
  const debut = chronologie[modele.missions[0]];
  const fin = chronologie[modele.missions[1]];
  if (!debut || !fin) throw new Error("Pas assez de missions clôturées pour cette campagne.");
  const alea = ctx.alea.deriver(`qualite:froide:${numero}`);
  const creation = new Chrono(
    jourOuvre(ajouterJours(fin.cloture, modele.decalage)),
    alea,
    ctx.aujourdhui,
  );
  const gestionnaire = acteur(ctx, modele.creePar);

  let creee = true;
  await transaction(ctx, async () => {
    const c = ctx.proprietaire;
    const criteres = {
      periode_debut: debut.cloture,
      periode_fin: fin.cloture,
      types_mission_ids: [] as string[],
      directeur_ids: [] as string[],
      stratifier_par: null,
      exclure_deja_revues: true,
    };
    // Même population que l'API : missions clôturées de la période et pas encore tirées.
    const pop = await c.query<CandidatEchantillon>(
      `SELECT m.id, m.type_mission_id, m.directeur_id, to_char(m.cloturee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS cloturee_le
         FROM missions m
        WHERE m.cabinet_id = $1 AND m.statut = 'cloturee'
          AND (m.cloturee_le AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date
          AND NOT EXISTS (SELECT 1 FROM qualite_froide_echantillon x WHERE x.mission_id = m.id)
        ORDER BY m.id`,
      [ctx.cabinetId, criteres.periode_debut, criteres.periode_fin],
    );
    // Une mission sans relecteur indépendant ne peut pas être revue : elle n'entre pas dans le tirage.
    const tirables: CandidatEchantillon[] = [];
    for (const m of pop.rows) {
      if ((await relecteursIndependants(ctx, m.id, null)).length > 0) tirables.push(m);
      else {
        const cle = chronologie.find((x) => x.id === m.id)?.cle ?? m.id;
        ctx.journal(`  revue à froid : ${cle} écartée du tirage (aucun relecteur indépendant).`);
      }
    }
    if (tirables.length === 0) {
      ctx.journal(`  campagne « ${modele.intitule} » ignorée : aucune mission tirable.`);
      creee = false;
      return;
    }
    const tirage = tirerEchantillon(
      tirables,
      { ...criteres, exclus: [] },
      modele.taille,
      modele.graine,
    );
    if (tirage.selection.length === 0)
      throw new Error(`Campagne « ${modele.intitule} » : population vide.`);
    const camp = await c.query<{ id: string }>(
      `INSERT INTO qualite_froide_campagnes (cabinet_id, intitule, criteres, taille_demandee, graine, population_ids,
         empreinte_population, cree_par, cree_le)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9) RETURNING id`,
      [
        ctx.cabinetId,
        modele.intitule,
        JSON.stringify(criteres),
        modele.taille,
        modele.graine,
        JSON.stringify(tirage.population),
        tirage.empreinte_population,
        gestionnaire.id,
        creation.iso(),
      ],
    );
    const campagneId = camp.rows[0]!.id;
    const echantillons: { id: string; mission: MissionCloturee }[] = [];
    for (const s of tirage.selection) {
      const e = await c.query<{ id: string }>(
        `INSERT INTO qualite_froide_echantillon (cabinet_id, campagne_id, mission_id, rang, cle, cree_le)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ctx.cabinetId, campagneId, s.id, s.rang, s.cle, creation.iso()],
      );
      const mission = chronologie.find((m) => m.id === s.id);
      if (!mission) throw new Error("Mission tirée hors du casting.");
      echantillons.push({ id: e.rows[0]!.id, mission });
    }

    let derniere = creation.date();
    const constatsParMission = new Map<string, string[]>();
    for (const [i, e] of echantillons.entries()) {
      const chrono = new Chrono(ajouterJours(creation.date(), 1 + i * 2), alea, ctx.aujourdhui);
      const r = await revuePassee(ctx, chrono, e.id, e.mission, gestionnaire.id, numero + i);
      constatsParMission.set(e.mission.cle, r.constats);
      if (r.fin > derniere) derniere = r.fin;
    }
    const cloture = new Chrono(ajouterJours(derniere, 2), alea, ctx.aujourdhui);
    await c.query(
      "UPDATE qualite_froide_campagnes SET statut = 'close', cloturee_par = $2, cloturee_le = $3 WHERE id = $1",
      [campagneId, gestionnaire.id, cloture.iso()],
    );

    // Plan d'amélioration : actions nées des constats de l'échantillon, puis leur suivi.
    for (const [k, a] of modele.actions.entries()) {
      let constatId: string | null = null;
      if (a.constat) {
        const liste = constatsParMission.get(a.constat.mission);
        if (!liste) continue; // la mission visée n'a pas été tirée : pas d'action orpheline
        constatId = liste[a.constat.rang] ?? null;
      }
      const responsable = acteur(ctx, a.responsable);
      const chrono = new Chrono(ajouterJours(cloture.date(), 1 + k), alea, ctx.aujourdhui);
      const echeance = ajouterJours(chrono.date(), a.delai);
      const act = await c.query<{ id: string }>(
        `INSERT INTO qualite_froide_actions (cabinet_id, campagne_id, constat_id, titre, description, responsable_id,
           echeance, cree_par, cree_le, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [
          ctx.cabinetId,
          campagneId,
          constatId,
          a.titre,
          a.description,
          responsable.id,
          echeance,
          gestionnaire.id,
          chrono.iso(),
        ],
      );
      const actionId = act.rows[0]!.id;
      const histo = async (
        rang: number,
        de: string | null,
        vers: string,
        par: string,
        commentaire: string | null,
        le: string,
      ): Promise<void> => {
        await c.query(
          `INSERT INTO qualite_froide_actions_historique (cabinet_id, action_id, rang, de_statut, vers_statut, responsable_id,
             echeance, commentaire, auteur_id, le)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [ctx.cabinetId, actionId, rang, de, vers, responsable.id, echeance, commentaire, par, le],
        );
      };
      await histo(1, null, "a_faire", gestionnaire.id, null, chrono.iso());
      let statut = "a_faire";
      for (const [j, p] of a.parcours.entries()) {
        chrono.jours(p.jours);
        const close = p.vers === "faite" || p.vers === "abandonnee";
        await c.query(
          "UPDATE qualite_froide_actions SET statut = $2, modifie_le = $3, cloturee_le = $4 WHERE id = $1",
          [actionId, p.vers, chrono.iso(), close ? chrono.iso() : null],
        );
        await histo(j + 2, statut, p.vers, responsable.id, p.commentaire ?? null, chrono.iso());
        statut = p.vers;
      }
    }
  });
  return creee;
}

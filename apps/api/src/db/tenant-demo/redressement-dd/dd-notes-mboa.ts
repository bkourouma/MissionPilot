import { ajouterJours } from "@missionpilot/engines";
import { LIVRABLE_DD } from "../../../due-diligence/registre.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, assurerEquipe, trouverMission, type Acteurs } from "./commun.js";
import {
  brouillonComite,
  contenuComite,
  MOTIF_REJET_ES,
  MOTIF_REVISION_COMITE,
  notesThemes,
  precisionEs,
  TITRE_COMITE,
} from "./dd-notes-donnees.js";
import { lireFaits, type FaitsDossier } from "./dd-notes-faits.js";
import { creer, decider, reviser, soumettre } from "./dd-notes-flux.js";
import { Datation, ecrire, lire } from "./dd-outils.js";

/*
 * Notes de la due diligence de la mission 4 « Due diligence — Mboa Solaire » (terminée, mais
 * ouverte pendant la phase). Calendrier ancré sur la fin de la mission (`fin`), en jours ouvrés :
 *
 *   fin-25 à fin-18  quatre notes par thème créées (marché, risques, E&S, plan des 100 jours)
 *   fin-17 / fin-16  révisions de l'équipe (version 2, autre rédacteur que le créateur)
 *   fin-15           régularisation des avis d'expert non signés (un associé signe), condition
 *                    pour que le moteur laisse soumettre (SOURCES_MANQUANTES sinon)
 *   fin-14           soumission des quatre notes par thème (version 3)
 *   fin-11 / fin-10  validations par des tiers `dd.valider` ; la note E&S est d'abord REJETÉE
 *                    (motif), reprise (v4), resoumise (v5) et validée
 *   fin-15 à fin-8   note au comité : créée, révisée, soumise (v3), validée par un expert métier
 *
 * Recommandation de la note au comité : « réservée » (trois hypothèses infirmées : le moteur
 * interdirait « favorable », HYPOTHESE_INFIRMEE_FAVORABLE). Séparation des tâches : les rédacteurs
 * sont les consultants ; les valideurs (expert métier 1 et 2, directeur de mission 2) n'écrivent
 * jamais de version.
 */

export interface ContexteMboa {
  a: Acteurs;
  missionId: string;
  clientId: string;
  dossierId: string;
  fin: string;
  faits: FaitsDossier;
  comiteNoteId: string;
  /** Version soumise et validée de la note au comité. */
  comiteVersion: number;
  /** Jour (ISO) à partir duquel le portail est ouvert. */
  jour: (decalage: number) => string;
}

async function dossierMboa(a: Acteurs, missionId: string): Promise<string> {
  const l = await lire<{ elements: { id: string }[] }>(
    a.consultant,
    `/api/missions/${missionId}/dd/dossiers`,
    "dossiers de la mission Mboa",
  );
  const d = l.elements[0];
  if (!d)
    throw new Error("La mission Mboa Solaire ne porte aucun dossier : dd-dossiers doit passer.");
  return d.id;
}

interface Anomalie {
  assertion_id: string;
  code: string;
}

/**
 * Signe les avis d'expert que le registre des preuves signale non signés (PRV-03), par un associé
 * (habilitation d'expert) et par les routes du point ou du risque concerné. Remonte les lignes
 * créées à `jour`.
 */
async function signerAvis(
  ctx: ContexteTenantDemo,
  a: Acteurs,
  missionId: string,
  dossierId: string,
  jour: string,
): Promise<number> {
  const c = await lire<{ anomalies: Anomalie[] }>(
    a.associe,
    `/api/missions/${missionId}/preuves/controle?livrable=${encodeURIComponent(LIVRABLE_DD)}`,
    "contrôle des sources",
  );
  const dat = new Datation(ctx, jour);
  await dat.relever();
  let signes = 0;
  for (const an of c.anomalies.filter((x) => x.code === "AVIS_EXPERT_NON_SIGNE")) {
    const r = await ctx.proprietaire.query(
      `SELECT e.id, e.type,
              (SELECT max(v.version) FROM dd_element_versions v WHERE v.element_id = e.id) AS version,
              (SELECT av.avis_expert_motif FROM assertion_versions av
                WHERE av.assertion_id = e.assertion_id ORDER BY av.version DESC LIMIT 1) AS motif
         FROM dd_elements e WHERE e.assertion_id = $1 AND e.dossier_id = $2`,
      [an.assertion_id, dossierId],
    );
    const l = r.rows[0] as { id: string; type: string; version: number; motif: string | null };
    const route = l.type === "risque" ? "risques" : "points";
    await ecrire(
      a.associe,
      `/api/dd/${route}/${l.id}/versions`,
      {
        version_courante: l.version,
        motif: "Avis d'expert relu et signé après vérification des sources du dossier.",
        avis_expert: true,
        avis_expert_motif: l.motif ?? "Avis d'équipe, à signer par un expert.",
        signer_avis: true,
      },
      `signature de l'avis ${l.id}`,
    );
    signes += 1;
  }
  await dat.dater(jour, { dossierId, missionId });
  return signes;
}

export async function semerNotesMboa(ctx: ContexteTenantDemo): Promise<ContexteMboa> {
  const a = await acteursPour(ctx, MISSIONS.ddTerminee);
  const mission = await trouverMission(ctx, MISSIONS.ddTerminee);
  if (!mission.dateFin) throw new Error("La mission Mboa Solaire n'a pas de date de fin.");
  await assurerEquipe(ctx, mission.id, [
    ctx.utilisateurs["consultant"] ?? "",
    ctx.utilisateurs["consultant.2"] ?? "",
    ctx.utilisateurs["expert.metier"] ?? "",
    ctx.utilisateurs["expert.metier.2"] ?? "",
    ctx.utilisateurs["directeur.mission.2"] ?? "",
  ]);
  const dossierId = await dossierMboa(a, mission.id);
  const existantes = await lire<{ elements: unknown[] }>(
    a.consultant,
    `/api/dd/dossiers/${dossierId}/notes`,
    "notes existantes",
  );
  if (existantes.elements.length > 0) {
    throw new Error("Le dossier Mboa Solaire porte déjà des notes au comité.");
  }
  const fin = mission.dateFin;
  const jour = (d: number) => ajouterJours(fin, d);
  const signes = await signerAvis(ctx, a, mission.id, dossierId, jour(-15));
  ctx.journal(`  DD Mboa : ${signes} avis d'expert signé(s) par l'associé.`);
  const f = await lireFaits(a.consultant, dossierId, "Mboa Solaire");
  const themes = notesThemes(f);
  const creeurs = [a.consultant, a.consultant2, a.consultant, a.consultant2];
  const reviseurs = [a.consultant2, a.consultant, a.consultant2, a.consultant];
  const valideurs = [a.expert, a.expert2, a.expert2, a.directeur2];
  const jCreation = [-25, -24, -22, -18];
  const jRevision = [-17, -17, -16, -16];
  const jDecision = [-11, -11, -11, -10];
  const idEs = 2;

  const ids: string[] = [];
  const versions: number[] = [];
  for (const [i, t] of themes.entries()) {
    const id = await creer(ctx, creeurs[i]!, dossierId, t.titre, t.v1, jour(jCreation[i]!));
    ids.push(id);
    versions.push(
      await reviser(ctx, reviseurs[i]!, id, 1, t.v2, t.motifRevision, jour(jRevision[i]!)),
    );
  }
  // Le comité : créé avant les soumissions, révisé après la relecture des thèmes.
  const comiteId = await creer(
    ctx,
    a.consultant,
    dossierId,
    TITRE_COMITE(f.cible),
    brouillonComite(f),
    jour(-15),
  );
  await reviser(
    ctx,
    a.consultant2,
    comiteId,
    1,
    contenuComite(f, "initiale"),
    MOTIF_REVISION_COMITE,
    jour(-14),
  );

  // Soumission des notes par thème (version 3), puis décisions de tiers.
  const soumises: number[] = [];
  for (const [i, id] of ids.entries()) {
    const auteur = i % 2 === 0 ? a.consultant : a.consultant2;
    soumises.push(await soumettre(ctx, auteur, id, versions[i]!, jour(-14)));
  }
  for (const [i, id] of ids.entries()) {
    if (i === idEs) {
      await decider(ctx, valideurs[i]!, id, soumises[i]!, "rejete", MOTIF_REJET_ES, jour(-11));
      continue;
    }
    await decider(ctx, valideurs[i]!, id, soumises[i]!, "valide", null, jour(jDecision[i]!));
  }
  // Reprise de la note E&S : version 4 (brouillon), 5 (soumise), validée par le second expert.
  const es = themes[idEs]!;
  const repris = {
    ...es.v2,
    synthese: `${es.v2.synthese}\n\n${precisionEs(f)}`,
  };
  const idRepris = ids[idEs]!;
  const v4 = await reviser(
    ctx,
    a.consultant2,
    idRepris,
    soumises[idEs]!,
    repris,
    "Reprise après le rejet : thèmes modérés précisés.",
    jour(-10),
  );
  const v5 = await soumettre(ctx, a.consultant, idRepris, v4, jour(-10));
  await decider(ctx, a.expert2, idRepris, v5, "valide", null, jour(-9));

  // Note au comité : soumise (version 3) puis validée par un expert métier.
  const comiteSoumise = await soumettre(ctx, a.consultant, comiteId, 2, jour(-11));
  await decider(ctx, a.expert, comiteId, comiteSoumise, "valide", null, jour(-8));
  ctx.journal(`  DD Mboa : 5 notes (4 par thème, 1 au comité) validées par des tiers.`);
  return {
    a,
    missionId: mission.id,
    clientId: mission.clientId,
    dossierId,
    fin,
    faits: f,
    comiteNoteId: comiteId,
    comiteVersion: comiteSoumise,
    jour,
  };
}

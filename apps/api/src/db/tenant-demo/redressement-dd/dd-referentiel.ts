import { ajouterJours } from "@missionpilot/engines";
import { DEBUT_ACTIVITE } from "../constantes.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { acteurs, MISSIONS, trouverMission, type Acteurs } from "./commun.js";
import { LISTES, MODELES, type CleActeurDd } from "./dd-referentiel-donnees.js";
import { SIGNAUX } from "./dd-signaux-donnees.js";
import { Datation, ecrire } from "./dd-outils.js";

/*
 * Référentiel de due diligence du cabinet (hors mission), par les VRAIES routes :
 * - modèles d'analyse par secteur (`/api/dd/modeles-secteur`, DD-07) : créés par un expert métier,
 *   revus (nouvelle version avec motif) par un autre compte qui a `dd.referentiel.gerer` ;
 * - bibliothèque de signaux d'alerte (`/api/dd/signaux`, DD-11) et listes d'exclusion
 *   (`/api/dd/listes-exclusion`, DD-14), avec leurs versions.
 * Les écritures sont antidatées au premier semestre 2025 (avant la première mission de due
 * diligence). Les identifiants créés sont rendus pour que les dossiers s'y rattachent.
 */

export interface Referentiel {
  /** Identifiant de signal par code. */
  signaux: Map<string, string>;
  /** Identifiant de liste d'exclusion par nom. */
  listes: Map<string, string>;
}

const jourDe = (j: number): string => ajouterJours(DEBUT_ACTIVITE, j);

function session(a: Acteurs, cle: CleActeurDd) {
  return a[cle];
}

export async function semerReferentielDd(ctx: ContexteTenantDemo): Promise<Referentiel> {
  const a = acteurs(ctx);
  const dat = new Datation(ctx, DEBUT_ACTIVITE);
  await dat.relever();
  const signaux = new Map<string, string>();
  const listes = new Map<string, string>();

  // --- Modèles d'analyse par secteur ---
  for (const m of MODELES) {
    const cree = await ecrire<{ id: string }>(
      session(a, m.par),
      "/api/dd/modeles-secteur",
      { secteur_code: m.secteur_code, analyse: m.analyse, points: m.points },
      `modèle ${m.secteur_code}/${m.analyse}`,
    );
    await dat.daterReferentiel(jourDe(m.j));
    if (m.revision) {
      await ecrire(
        session(a, m.revision.par),
        `/api/dd/modeles-secteur/${cree.id}/versions`,
        {
          points: m.revision.points ?? m.points,
          actif: m.revision.actif ?? true,
          version_courante: 1,
          motif: m.revision.motif,
        },
        `révision du modèle ${m.secteur_code}/${m.analyse}`,
      );
      await dat.daterReferentiel(jourDe(m.revision.j));
    }
  }

  // --- Listes d'exclusion ---
  const mboa = await trouverMission(ctx, MISSIONS.ddTerminee);
  for (const l of LISTES) {
    const cree = await ecrire<{ id: string }>(
      session(a, l.par),
      "/api/dd/listes-exclusion",
      {
        nom: l.nom,
        client_id: l.client === "mboa" ? mboa.clientId : null,
        reference_cadre: l.reference_cadre,
        regles: l.regles,
      },
      `liste ${l.nom}`,
    );
    listes.set(l.nom, cree.id);
    await dat.daterReferentiel(jourDe(l.j));
    if (l.revision) {
      await ecrire(
        session(a, l.revision.par),
        `/api/dd/listes-exclusion/${cree.id}/versions`,
        {
          regles: l.revision.regles,
          reference_cadre: l.reference_cadre,
          version_courante: 1,
          motif: l.revision.motif,
        },
        `révision de la liste ${l.nom}`,
      );
      await dat.daterReferentiel(jourDe(l.revision.j));
    }
  }

  // --- Signaux d'alerte ---
  for (const s of SIGNAUX) {
    const contenu = {
      libelle: s.libelle,
      description: s.description,
      famille: s.famille,
      secteur_code: s.secteur_code,
      pays_code: s.pays_code,
      gravite_indicative: s.gravite,
      question: s.question,
      reference_publique: s.reference_publique,
      actif: true,
    };
    const cree = await ecrire<{ id: string }>(
      session(a, s.par),
      "/api/dd/signaux",
      { code: s.code, ...contenu },
      `signal ${s.code}`,
    );
    signaux.set(s.code, cree.id);
    await dat.daterReferentiel(jourDe(s.j));
    if (s.revision) {
      await ecrire(
        session(a, s.revision.par),
        `/api/dd/signaux/${cree.id}/versions`,
        {
          ...contenu,
          gravite_indicative: s.revision.gravite ?? s.gravite,
          question: s.revision.question ?? s.question,
          version_courante: 1,
          motif: s.revision.motif,
        },
        `révision du signal ${s.code}`,
      );
      await dat.daterReferentiel(jourDe(s.revision.j));
    }
  }
  ctx.journal(
    `  référentiel DD : ${MODELES.length} modèles, ${LISTES.length} listes, ${SIGNAUX.length} signaux.`,
  );
  return { signaux, listes };
}

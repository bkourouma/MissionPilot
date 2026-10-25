import { ajouterJours } from "@missionpilot/engines";
import { ecartJours, type Alea } from "../horloge.js";
import {
  MISSION_DEPASSEMENT,
  MISSIONS_TERMINEES,
  type Casting,
  type CleMission,
  type MissionLue,
} from "./casting.js";
import { avancement, demiJour, maxDate, minDate } from "./outils.js";
import type { Paquet, PersonneTemps } from "./temps-plan.js";

/*
 * Paquets de travail du module temps : une affectation = une personne sur une tâche, avec sa
 * fenêtre et son volume cible (règles de volume : voir temps-plan.ts).
 */

/** Fenêtre de chaque tâche (dans l'ordre `rang` : phase, tâche, puis création) : tranches consécutives de la mission, proportionnelles aux jours alloués. */
function fenetresTaches(
  m: MissionLue,
  debut: string,
  fin: string,
  rang: ReadonlyMap<string, number>,
) {
  const alloue = new Map<string, number>();
  for (const a of m.affectations) {
    alloue.set(a.tacheId, (alloue.get(a.tacheId) ?? 0) + a.joursAlloues);
  }
  const total = [...alloue.values()].reduce((s, x) => s + x, 0);
  const span = ecartJours(debut, fin);
  const fenetres = new Map<string, { debut: string; fin: string }>();
  let cumul = 0;
  const taches = [...m.taches].sort((a, b) => (rang.get(a.id) ?? 0) - (rang.get(b.id) ?? 0));
  for (const t of taches) {
    const j = alloue.get(t.id);
    if (!j || total <= 0) continue;
    const d = ajouterJours(debut, Math.round((span * cumul) / total));
    cumul += j;
    const f = cumul >= total - 1e-9 ? fin : ajouterJours(debut, Math.round((span * cumul) / total));
    fenetres.set(t.id, { debut: d, fin: f < d ? d : f });
  }
  return fenetres;
}

/** Cible (en jours) d'une affectation d'une mission TERMINÉE. */
function cibleTerminee(cle: CleMission, alloue: number, rng: Alea, reprise: number): number {
  // `reprise` : jours des affectations sans compte, repris par les collaborateurs qui en ont un.
  if (cle === "wouri-redressement") {
    return demiJour(alloue * reprise * (1.25 + 0.12 * rng.suivant()));
  }
  alloue = alloue * reprise;
  const candidats: number[] = [];
  for (let u = Math.ceil(alloue * 0.96 * 2 - 1e-9); u / 2 <= alloue * 1.03 + 1e-9; u++) {
    candidats.push(u / 2);
  }
  return candidats.length > 0 ? rng.choisir(candidats) : demiJour(alloue);
}

/** Paquets de toutes les missions du casting (avertissements dans `avertir`). */
export function construirePaquets(
  casting: Casting,
  personnes: ReadonlyMap<string, PersonneTemps>,
  aujourdhui: string,
  rng: Alea,
  avertir: (ligne: string) => void,
  rang: ReadonlyMap<string, number> = new Map(),
): Paquet[] {
  const paquets: Paquet[] = [];
  for (const [cleM, m] of Object.entries(casting.missions) as [CleMission, MissionLue][]) {
    if (m.statut === "cloturee") {
      avertir(`temps : mission « ${cleM} » déjà clôturée, ignorée.`);
      continue;
    }
    if (m.affectations.length === 0) {
      avertir(`temps : mission « ${cleM} » sans affectation, aucun temps saisi.`);
      continue;
    }
    if (!m.debut || !m.fin) {
      avertir(`temps : mission « ${cleM} » sans dates, ignorée.`);
      continue;
    }
    if (m.debut > aujourdhui) continue;
    const fenetres = fenetresTaches(m, m.debut, m.fin, rang);
    const terminee = MISSIONS_TERMINEES.includes(cleM);
    const facteur = cleM === MISSION_DEPASSEMENT ? 1.35 : 1;
    const sansCompte = m.affectations.filter((a) => !a.utilisateurId).length;
    if (sansCompte > 0) {
      avertir(
        `temps : ${sansCompte} affectation(s) de « ${cleM} » sans compte, aucun temps saisi.`,
      );
    }
    const joursTotal = m.affectations.reduce((t, a) => t + a.joursAlloues, 0);
    const joursComptes = m.affectations
      .filter((a) => a.utilisateurId)
      .reduce((t, a) => t + a.joursAlloues, 0);
    const reprise = joursComptes > 0 ? joursTotal / joursComptes : 1;
    for (const a of m.affectations) {
      const personne = a.utilisateurId ? personnes.get(a.utilisateurId) : undefined;
      if (!personne) continue;
      const f = fenetres.get(a.tacheId);
      let debut = maxDate(m.debut, a.debut, f?.debut ?? m.debut);
      let fin = minDate(m.fin, a.fin, f?.fin ?? m.fin);
      if (debut > fin) {
        debut = maxDate(m.debut, a.debut);
        fin = minDate(m.fin, a.fin);
      }
      if (debut > fin || debut > aujourdhui) continue;
      const jours = terminee
        ? cibleTerminee(cleM, a.joursAlloues, rng, reprise)
        : demiJour(a.joursAlloues * avancement(debut, fin, aujourdhui) * facteur);
      if (jours <= 0) continue;
      // Fenêtre trop étroite pour le volume visé (surconsommation, chevauchements) : élargie par
      // pas de deux semaines, dans la limite de l'affectation, jusqu'à un rythme réaliste.
      const borneDebut = maxDate(m.debut, a.debut);
      const borneFin = minDate(m.fin, a.fin);
      const capacite = (d: string, f: string): number =>
        ((ecartJours(d, minDate(f, aujourdhui)) + 1) / 7) * personne.rythme * 0.55;
      while (jours > capacite(debut, fin) && (debut > borneDebut || fin < borneFin)) {
        debut = maxDate(borneDebut, ajouterJours(debut, -14));
        fin = minDate(borneFin, ajouterJours(fin, 14));
      }
      paquets.push({
        missionCle: cleM,
        missionId: m.id,
        tacheId: a.tacheId,
        affectationId: a.id,
        cle: personne.cle,
        collaborateurId: a.collaborateurId,
        joursAlloues: a.joursAlloues,
        debut,
        fin: minDate(fin, aujourdhui),
        unitesCible: Math.round(jours * 2),
        lignes: [],
        manque: 0,
      });
    }
  }
  return paquets;
}

import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { auteurSaisie, type ActeursMission, type ComptesPortail } from "./kpi-acteurs.js";
import { arrondir, decimalesDe, finDeMois } from "./kpi-series.js";
import type { ErreurSaisie, SpecKpi } from "./kpi-types.js";
import { exiger, lire } from "./outils.js";

/*
 * Saisie des mesures mensuelles d'un KPI par les VRAIES routes, sur un historique de 24 mois au
 * plus : le cabinet (chef, directeur, consultants de l'équipe) par POST /api/kpi/:id/mesures, le
 * client par POST /api/portail/kpi/:id/mesures pour les KPI dont des comptes du portail sont
 * contributeurs désignés. Corrections et annulations passent par leurs routes (motif obligatoire).
 * Rejouable : l'état de chaque date est relu (lignes en ajout seul) avant d'écrire.
 */

interface Ligne {
  id: string;
  date: string;
  valeur: number | null;
  annulation: boolean;
  remplacee: boolean;
}

async function lignesDe(ctx: ContexteTenantDemo, kpiId: string): Promise<Ligne[]> {
  const r = await lire<{
    id: string;
    date: string;
    valeur: string | null;
    annulation: boolean;
    remplacee: boolean;
  }>(
    ctx,
    `SELECT m.id, m.date_mesure::text AS date, m.valeur::text AS valeur, m.annulation,
            EXISTS (SELECT 1 FROM kpi_mesures r WHERE r.remplace_id = m.id) AS remplacee
       FROM kpi_mesures m WHERE m.kpi_id = $1 ORDER BY m.numero`,
    [kpiId],
  );
  return r.map((l) => ({ ...l, valeur: l.valeur === null ? null : Number(l.valeur) }));
}

/** Les trois gestes d'un acteur (cabinet ou portail) sur une mesure. */
interface Acteur {
  poser(date: string, valeur: number, commentaire?: string): Promise<string>;
  corriger(id: string, date: string, valeur: number, motif: string): Promise<void>;
}

function acteurCabinet(ctx: ContexteTenantDemo, kpiId: string, cle: CleCompte): Acteur {
  const s = ctx.session(cle);
  return {
    poser: async (date, valeur, commentaire) => {
      const r = await s.post(`/api/kpi/${kpiId}/mesures`, {
        date_mesure: date,
        valeur,
        ...(commentaire ? { commentaire } : {}),
      });
      exiger(r, 201, `Mesure ${date} du KPI ${kpiId}`);
      return r.json().id as string;
    },
    corriger: async (id, date, valeur, motif) => {
      const r = await s.post(`/api/kpi/mesures/${id}/corrections`, {
        date_mesure: date,
        valeur,
        motif,
      });
      exiger(r, 201, `Correction ${date} du KPI ${kpiId}`);
    },
  };
}

function acteurPortail(ctx: ContexteTenantDemo, kpiId: string, cle: CleCompte): Acteur {
  const s = ctx.session(cle);
  return {
    poser: async (date, valeur, commentaire) => {
      const r = await s.post(`/api/portail/kpi/${kpiId}/mesures`, {
        date_mesure: date,
        valeur,
        ...(commentaire ? { commentaire } : {}),
      });
      exiger(r, 201, `Mesure portail ${date} du KPI ${kpiId}`);
      return r.json().id as string;
    },
    corriger: async (id, date, valeur, motif) => {
      const r = await s.post(`/api/portail/kpi/mesures/${id}/corrections`, {
        date_mesure: date,
        valeur,
        motif,
      });
      exiger(r, 201, `Correction portail ${date} du KPI ${kpiId}`);
    },
  };
}

export interface EntreeSaisies {
  ctx: ContexteTenantDemo;
  kpiId: string;
  spec: SpecKpi;
  indice: number;
  acteurs: ActeursMission;
  portail: ComptesPortail;
  mois: readonly string[];
  valeurs: readonly number[];
  /** Date de fin de la mission si elle borne la dernière mesure (mission terminée). */
  dateFin: string | null;
}

const dateMesure = (mois: string, dateFin: string | null): string => {
  const fin = finDeMois(mois);
  return dateFin && dateFin < fin ? dateFin : fin;
};

const fauxDe = (e: ErreurSaisie, final: number, decimales: number): number =>
  arrondir(final * e.facteur, decimales);

/** Écrit les mesures manquantes ; renvoie le nombre de lignes ajoutées (saisies, corrections, annulations). */
export async function synchroniserMesures(e: EntreeSaisies): Promise<number> {
  const { ctx, kpiId, spec } = e;
  const decimales = decimalesDe(spec);
  let lignes = await lignesDe(ctx, kpiId);
  const avant = lignes.length;
  const compteDe = (t: number): CleCompte | null => {
    const p = spec.portail;
    if (!p || e.mois[t]! < p.depuis) return null;
    const dispo = p.comptes.map((c) => e.portail[c]).filter((c): c is CleCompte => !!c);
    return dispo.length > 0 ? (dispo[t % dispo.length] as CleCompte) : null;
  };
  for (const [t, mois] of e.mois.entries()) {
    if (spec.manque?.includes(mois)) continue;
    const final = e.valeurs[t] as number;
    const date = dateMesure(mois, e.dateFin);
    const portail = compteDe(t);
    const acteur = portail
      ? acteurPortail(ctx, kpiId, portail)
      : acteurCabinet(ctx, kpiId, auteurSaisie(e.acteurs, e.indice, t));
    const commentaire = incident(spec, mois)
      ? "Écart expliqué lors de la clôture mensuelle."
      : undefined;
    const duMois = lignes.filter((l) => l.date === date);
    const active = duMois.find((l) => !l.annulation && !l.remplacee);
    const annul = spec.annulation?.mois === mois ? spec.annulation : undefined;
    const prevue = portail ? spec.portail?.correction : spec.correction;
    const corr = prevue?.mois === mois ? prevue : undefined;
    if (annul) {
      const faux = fauxDe(annul, final, decimales);
      let courante = active;
      if (!courante && duMois.length === 0) {
        const id = await acteur.poser(date, faux);
        courante = { id, date, valeur: faux, annulation: false, remplacee: false };
      }
      if (courante && courante.valeur === faux) {
        const cab = ctx.session(auteurSaisie(e.acteurs, e.indice, t));
        const r = await cab.post(`/api/kpi/mesures/${courante.id}/annulation`, {
          motif: annul.motif,
        });
        exiger(r, 201, `Annulation ${date} du KPI ${kpiId}`);
        await acteur.poser(date, final);
      } else if (!courante) {
        await acteur.poser(date, final);
      }
    } else if (corr) {
      const faux = fauxDe(corr, final, decimales);
      let courante = active;
      if (!courante && duMois.length === 0) {
        const id = await acteur.poser(date, faux, commentaire);
        courante = { id, date, valeur: faux, annulation: false, remplacee: false };
      }
      if (courante && courante.valeur === faux) {
        await acteur.corriger(courante.id, date, final, corr.motif);
      }
    } else if (!active) {
      await acteur.poser(date, final, commentaire);
    }
    lignes = await lignesDe(ctx, kpiId);
  }
  return lignes.length - avant;
}

const incident = (spec: SpecKpi, mois: string): boolean =>
  !("type" in spec.serie) && spec.serie.incidents?.[mois] !== undefined;

"use client";

import type { Langue } from "@missionpilot/shared";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminReprevisions,
  explicationMethode,
  hrefPlanVivant,
  libelleMethode,
  libelleVersionRetenue,
  messagePlanVivant,
  METHODES_REPREVISION_PLAN,
  SEUIL_DEFAUT_POURCENT,
  validerReprevision,
  type MethodeReprevisionPlan,
  type Reprevision,
  type SaisieReprevision,
  type VersionRetenue,
} from "../../lib/plan-vivant";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface FormulaireReprevisionProps {
  missionId: string;
  planId: string;
  exercice: number;
  /** Versions VALIDÉES du modèle financier (les seules acceptées). */
  versions: readonly VersionRetenue[];
  versionInitiale: number | null;
  /** Nombre de trimestres réalisés saisis : 0 désactive le bouton. */
  trimestresSaisis: number;
}

const optionsMethode = (langue: Langue) =>
  METHODES_REPREVISION_PLAN.map((m) => ({
    valeur: m,
    libelle: libelleMethode(m, langue),
  }));

/**
 * Lancement d'une re-prévision (PLA-18) : version validée du modèle, méthode et seuil de « significatif ».
 * Le calcul est fait par le moteur à partir des réalisés enregistrés ; le plan validé n'est pas modifié.
 */
export function FormulaireReprevision({
  missionId,
  planId,
  exercice,
  versions,
  versionInitiale,
  trimestresSaisis,
}: FormulaireReprevisionProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [s, setS] = useState<SaisieReprevision>({
    version: versionInitiale === null ? "" : String(versionInitiale),
    methode: "reste_du_plan",
    seuil: SEUIL_DEFAUT_POURCENT,
  });
  const [erreurs, setErreurs] = useState<Partial<Record<keyof SaisieReprevision, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refErreur = useRef<HTMLDivElement>(null);

  async function relancer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const v = validerReprevision(s, exercice, langue);
    setErreurs(v.erreurs);
    if (!v.corps) {
      const premier = (Object.keys(v.erreurs) as (keyof SaisieReprevision)[])[0];
      if (premier) document.getElementById(`pv-rev-${premier}`)?.focus();
      return;
    }
    setEnCours(true);
    try {
      const rev = await api.post<Reprevision>(cheminReprevisions(planId), v.corps);
      router.push(hrefPlanVivant(missionId, planId, { exercice, reprevision: rev.id }));
      rafraichir();
    } catch (err) {
      setErreur(messagePlanVivant(err, langue));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-pv"
      onSubmit={relancer}
      noValidate
      aria-label={t("Lancer une re-prévision", "Run a re-forecast")}
    >
      {erreur ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Re-prévision refusée", "Re-forecast rejected")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {trimestresSaisis === 0 ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {t(
              "Saisissez au moins le premier trimestre réalisé pour pouvoir re-prévoir l'exercice.",
              "Enter at least the first actual quarter to be able to re-forecast the fiscal year.",
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          id="pv-rev-version"
          libelle={t("Version validée du modèle financier", "Approved financial model version")}
          invite={t("Choisir…", "Choose…")}
          options={versions.map((v) => ({
            valeur: String(v.version),
            libelle: libelleVersionRetenue(v, langue),
          }))}
          value={s.version}
          onChange={(e) => setS((x) => ({ ...x, version: e.target.value }))}
          erreur={erreurs.version}
          required
        />
        <Select
          id="pv-rev-methode"
          libelle={t("Méthode de re-prévision", "Re-forecast method")}
          options={optionsMethode(langue)}
          value={s.methode}
          onChange={(e) => setS((x) => ({ ...x, methode: e.target.value }))}
          aide={explicationMethode(s.methode as MethodeReprevisionPlan, langue)}
          erreur={erreurs.methode}
          required
        />
        <Champ
          id="pv-rev-seuil"
          libelle={t("Seuil d'un écart significatif (%)", "Significant variance threshold (%)")}
          aide={t(
            "Un écart relatif au moins égal à ce seuil est marqué « significatif ».",
            "A relative variance at least equal to this threshold is marked “significant”.",
          )}
          inputMode="decimal"
          value={s.seuil}
          onChange={(e) => setS((x) => ({ ...x, seuil: e.target.value }))}
          erreur={erreurs.seuil}
          required
        />
      </div>
      <div>
        <Bouton
          type="submit"
          chargement={enCours}
          texteChargement={t("Calcul…", "Computing…")}
          disabled={trimestresSaisis === 0 || versions.length === 0}
        >
          {t("Re-prévoir l'exercice", "Re-forecast fiscal year")} {exercice}
        </Bouton>
      </div>
    </form>
  );
}

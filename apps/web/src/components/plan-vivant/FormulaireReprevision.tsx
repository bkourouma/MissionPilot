"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminReprevisions,
  EXPLICATION_METHODE,
  hrefPlanVivant,
  LIBELLE_METHODE,
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

const OPTIONS_METHODE = METHODES_REPREVISION_PLAN.map((m) => ({
  valeur: m,
  libelle: LIBELLE_METHODE[m],
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
  const [s, setS] = useState<SaisieReprevision>({
    version: versionInitiale === null ? "" : String(versionInitiale),
    methode: "reste_du_plan",
    seuil: SEUIL_DEFAUT_POURCENT,
  });
  const [erreurs, setErreurs] = useState<Partial<Record<keyof SaisieReprevision, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refErreur = useRef<HTMLDivElement>(null);

  async function relancer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const v = validerReprevision(s, exercice);
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
      router.refresh();
    } catch (err) {
      setErreur(messagePlanVivant(err));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form className="mp-pv" onSubmit={relancer} noValidate aria-label="Lancer une re-prévision">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Re-prévision refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {trimestresSaisis === 0 ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            Saisissez au moins le premier trimestre réalisé pour pouvoir re-prévoir l&apos;exercice.
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          id="pv-rev-version"
          libelle="Version validée du modèle financier"
          invite="Choisir…"
          options={versions.map((v) => ({
            valeur: String(v.version),
            libelle: libelleVersionRetenue(v),
          }))}
          value={s.version}
          onChange={(e) => setS((x) => ({ ...x, version: e.target.value }))}
          erreur={erreurs.version}
          required
        />
        <Select
          id="pv-rev-methode"
          libelle="Méthode de re-prévision"
          options={OPTIONS_METHODE}
          value={s.methode}
          onChange={(e) => setS((x) => ({ ...x, methode: e.target.value }))}
          aide={EXPLICATION_METHODE[s.methode as MethodeReprevisionPlan]}
          erreur={erreurs.methode}
          required
        />
        <Champ
          id="pv-rev-seuil"
          libelle="Seuil d'un écart significatif (%)"
          aide="Un écart relatif au moins égal à ce seuil est marqué « significatif »."
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
          texteChargement="Calcul…"
          disabled={trimestresSaisis === 0 || versions.length === 0}
        >
          Re-prévoir l&apos;exercice {exercice}
        </Bouton>
      </div>
    </form>
  );
}

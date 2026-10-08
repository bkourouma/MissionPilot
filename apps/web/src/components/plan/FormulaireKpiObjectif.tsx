"use client";

import { useState, type FormEvent } from "react";
import {
  FREQUENCES_KPI,
  NATURES_KPI,
  PERSPECTIVES_KPI,
  SENS_LECTURE_KPI,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  FREQUENCE_LIBELLES,
  NATURE_LIBELLES,
  PERSPECTIVE_LIBELLES,
  SENS_LIBELLES,
} from "../../lib/kpi";
import { DESCRIPTION_MAX, LIBELLE_MAX, UNITE_MAX } from "../../lib/kpi-saisie";
import {
  cheminKpiObjectif,
  messageKpiPlan,
  saisieDepuisObjectif,
  validerKpiObjectif,
  type ChampKpiObjectif,
  type ObjectifAvecKpi,
  type SaisieKpiObjectif,
} from "../../lib/plan-kpi";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const options = <T extends string>(liste: readonly T[], libelles: Record<T, string>) =>
  liste.map((v) => ({ valeur: v, libelle: libelles[v] }));

export interface FormulaireKpiObjectifProps {
  planId: string;
  objectif: ObjectifAvecKpi;
  aujourdhui: string;
}

/**
 * Création d'un KPI depuis un objectif du plan (PLA-10). Le formulaire est prérempli depuis
 * l'objectif (indicateur, perspective) ; le KPI est créé dans le module de pilotage, où se
 * règlent ensuite seuils, alertes, propriétaire et contributeurs. Sens, nature, fréquence et
 * début de suivi sont figés une fois le KPI créé.
 */
export function FormulaireKpiObjectif({
  planId,
  objectif,
  aujourdhui,
}: FormulaireKpiObjectifProps) {
  const f = useFormulaire<ChampKpiObjectif>();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieKpiObjectif>(() => saisieDepuisObjectif(objectif, aujourdhui));
  const texte = (cle: ChampKpiObjectif) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: f.erreurs[cle],
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerKpiObjectif(s, aujourdhui),
      (charge) => api.post<ObjectifAvecKpi>(cheminKpiObjectif(planId, objectif.id), charge),
      {
        succes:
          "KPI créé dans le module de pilotage : il apparaît dans l'onglet KPI de la mission.",
        messageSpecifique: messageKpiPlan,
      },
    );
    if (ok) {
      setOuvert(false);
      setS(saisieDepuisObjectif(objectif, aujourdhui));
    }
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton variante="secondaire" icone="plus" onClick={() => setOuvert(true)}>
            Créer un KPI pour cet objectif
          </Bouton>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Créer un KPI pour l'objectif ${objectif.titre}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Création refusée"
      />
      <div className="mp-grille-champs">
        <Champ libelle="Libellé du KPI" required maxLength={LIBELLE_MAX} {...texte("libelle")} />
        <Champ
          libelle="Unité"
          required
          maxLength={UNITE_MAX}
          aide="Ex. FCFA, %, jours, clients."
          {...texte("unite")}
        />
        <Select
          libelle="Perspective"
          invite="Sans perspective"
          options={options(PERSPECTIVES_KPI, PERSPECTIVE_LIBELLES)}
          {...texte("perspective")}
        />
        <Select
          libelle="Sens de lecture"
          required
          options={options(SENS_LECTURE_KPI, SENS_LIBELLES)}
          {...texte("sens")}
        />
        <Select
          libelle="Nature"
          required
          options={options(NATURES_KPI, NATURE_LIBELLES)}
          {...texte("nature")}
        />
        <Select
          libelle="Fréquence de mesure"
          required
          options={options(FREQUENCES_KPI, FREQUENCE_LIBELLES)}
          {...texte("frequence")}
        />
        <Champ
          libelle="Début du suivi"
          type="date"
          required
          aide="Ramené au début de sa période par le module de pilotage."
          {...texte("debut_suivi")}
        />
        <Champ
          libelle="Cible initiale (facultatif)"
          inputMode="decimal"
          autoComplete="off"
          aide="Valeur chiffrée saisie par vous ; la cible de l'objectif est rappelée dans la description."
          {...texte("cible")}
        />
      </div>
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={DESCRIPTION_MAX}
        {...texte("description")}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Création…">
          Créer le KPI
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

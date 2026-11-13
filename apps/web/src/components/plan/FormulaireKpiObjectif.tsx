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
  FREQUENCE_LIBELLES_EN,
  NATURE_LIBELLES,
  NATURE_LIBELLES_EN,
  PERSPECTIVE_LIBELLES,
  PERSPECTIVE_LIBELLES_EN,
  SENS_LIBELLES,
  SENS_LIBELLES_EN,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const en = langue === "en";
  const f = useFormulaire<ChampKpiObjectif>();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieKpiObjectif>(() =>
    saisieDepuisObjectif(objectif, aujourdhui, langue),
  );
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
        succes: t(
          "KPI créé dans le module de pilotage : il apparaît dans l'onglet KPI de la mission.",
          "KPI created in the performance module: it appears in the engagement's KPI tab.",
        ),
        messageSpecifique: (err) => messageKpiPlan(err, langue),
      },
    );
    if (ok) {
      setOuvert(false);
      setS(saisieDepuisObjectif(objectif, aujourdhui, langue));
    }
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton variante="secondaire" icone="plus" onClick={() => setOuvert(true)}>
            {t("Créer un KPI pour cet objectif", "Create a KPI for this objective")}
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
      aria-label={t(
        `Créer un KPI pour l'objectif ${objectif.titre}`,
        `Create a KPI for objective ${objectif.titre}`,
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Création refusée", "Creation refused")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé du KPI", "KPI label")}
          required
          maxLength={LIBELLE_MAX}
          {...texte("libelle")}
        />
        <Champ
          libelle={t("Unité", "Unit")}
          required
          maxLength={UNITE_MAX}
          aide={t("Ex. FCFA, %, jours, clients.", "E.g. FCFA, %, days, clients.")}
          {...texte("unite")}
        />
        <Select
          libelle={t("Perspective", "Perspective")}
          invite={t("Sans perspective", "No perspective")}
          options={options(PERSPECTIVES_KPI, en ? PERSPECTIVE_LIBELLES_EN : PERSPECTIVE_LIBELLES)}
          {...texte("perspective")}
        />
        <Select
          libelle={t("Sens de lecture", "Reading direction")}
          required
          options={options(SENS_LECTURE_KPI, en ? SENS_LIBELLES_EN : SENS_LIBELLES)}
          {...texte("sens")}
        />
        <Select
          libelle={t("Nature", "Type")}
          required
          options={options(NATURES_KPI, en ? NATURE_LIBELLES_EN : NATURE_LIBELLES)}
          {...texte("nature")}
        />
        <Select
          libelle={t("Fréquence de mesure", "Measurement frequency")}
          required
          options={options(FREQUENCES_KPI, en ? FREQUENCE_LIBELLES_EN : FREQUENCE_LIBELLES)}
          {...texte("frequence")}
        />
        <Champ
          libelle={t("Début du suivi", "Tracking start")}
          type="date"
          required
          aide={t(
            "Ramené au début de sa période par le module de pilotage.",
            "Moved back to the start of its period by the performance module.",
          )}
          {...texte("debut_suivi")}
        />
        <Champ
          libelle={t("Cible initiale (facultatif)", "Initial target (optional)")}
          inputMode="decimal"
          autoComplete="off"
          aide={t(
            "Valeur chiffrée saisie par vous ; la cible de l'objectif est rappelée dans la description.",
            "Figure entered by you; the objective's target is recalled in the description.",
          )}
          {...texte("cible")}
        />
      </div>
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={DESCRIPTION_MAX}
        {...texte("description")}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Création…", "Creating…")}>
          {t("Créer le KPI", "Create KPI")}
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

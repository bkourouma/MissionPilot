"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { CHEMIN_PARAMETRES_KPI, messageKpi, type ParametresKpi } from "../../lib/kpi";
import {
  saisieDepuisParametres,
  validerParametres,
  type ChampParametres,
  type SaisieParametres,
} from "../../lib/kpi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";

/**
 * Réglages du pilotage par KPI du CABINET (toutes les missions) : rappels de saisie, délai de
 * grâce avant qu'une mesure soit « en retard », nombre de dégradations consécutives qui
 * déclenche l'alerte. Valeurs de départ à faire valider par le métier.
 */
export function FormulaireParametresKpi({ actuel }: { actuel: ParametresKpi }) {
  const f = useFormulaire<ChampParametres>();
  const [s, setS] = useState<SaisieParametres>(() => saisieDepuisParametres(actuel));
  const [inchange, setInchange] = useState(false);
  const maj = <K extends ChampParametres>(cle: K, v: SaisieParametres[K]) => {
    setInchange(false);
    setS((x) => ({ ...x, [cle]: v }));
  };

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerParametres(s, actuel);
    if (!v.ok && v.inchange) {
      setInchange(true);
      return;
    }
    await f.envoyer(v, (charge) => api.patch<ParametresKpi>(CHEMIN_PARAMETRES_KPI, charge), {
      succes: "Réglages enregistrés : ils s'appliquent à tous les KPI du cabinet.",
      messageSpecifique: messageKpi,
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Réglages du pilotage par KPI"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Réglages refusés"
      />
      {inchange ? (
        <Alerte tonalite="info" annonce="status">
          <p>Aucune modification à enregistrer.</p>
        </Alerte>
      ) : null}
      <CaseACocher
        libelle="Rappels de saisie actifs pour le cabinet"
        aide="Désactivés, aucun rappel ne part, quel que soit le réglage de chaque KPI ; les alertes restent enregistrées."
        checked={s.rappels_actifs}
        onChange={(e) => maj("rappels_actifs", e.target.checked)}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Délai de grâce (jours)"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.delai_grace_jours}
          onChange={(e) => maj("delai_grace_jours", e.target.value)}
          erreur={f.erreurs.delai_grace_jours}
          aide="Jours après la fin d'une période avant qu'une mesure manquante soit « en retard » (0 à 60)."
        />
        <Champ
          libelle="Alerte de dégradation après (périodes)"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.periodes_degradation}
          onChange={(e) => maj("periodes_degradation", e.target.value)}
          erreur={f.erreurs.periodes_degradation}
          aide="Nombre de dégradations consécutives, dans le sens de lecture du KPI, qui déclenche l'alerte (1 à 24)."
        />
      </div>
      <CaseACocher
        libelle="Valeurs validées par le cabinet"
        aide="À cocher une fois ces réglages confirmés par le métier (valeurs de départ : rappels actifs, 5 jours, 3 périodes)."
        checked={s.valeurs_validees}
        onChange={(e) => maj("valeurs_validees", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer les réglages
        </Bouton>
      </div>
    </form>
  );
}

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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampParametres>();
  const [s, setS] = useState<SaisieParametres>(() => saisieDepuisParametres(actuel));
  const [inchange, setInchange] = useState(false);
  const maj = <K extends ChampParametres>(cle: K, v: SaisieParametres[K]) => {
    setInchange(false);
    setS((x) => ({ ...x, [cle]: v }));
  };

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerParametres(s, actuel, langue);
    if (!v.ok && v.inchange) {
      setInchange(true);
      return;
    }
    await f.envoyer(v, (charge) => api.patch<ParametresKpi>(CHEMIN_PARAMETRES_KPI, charge), {
      succes: t(
        "Réglages enregistrés : ils s'appliquent à tous les KPI du cabinet.",
        "Settings saved: they apply to all the firm's KPIs.",
      ),
      messageSpecifique: (e) => messageKpi(e, langue),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Réglages du pilotage par KPI", "KPI management settings")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Réglages refusés", "Settings refused")}
      />
      {inchange ? (
        <Alerte tonalite="info" annonce="status">
          <p>{t("Aucune modification à enregistrer.", "No change to save.")}</p>
        </Alerte>
      ) : null}
      <CaseACocher
        libelle={t(
          "Rappels de saisie actifs pour le cabinet",
          "Data entry reminders active for the firm",
        )}
        aide={t(
          "Désactivés, aucun rappel ne part, quel que soit le réglage de chaque KPI ; les alertes restent enregistrées.",
          "When disabled, no reminder is sent, whatever the setting of each KPI; alerts are still recorded.",
        )}
        checked={s.rappels_actifs}
        onChange={(e) => maj("rappels_actifs", e.target.checked)}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Délai de grâce (jours)", "Grace period (days)")}
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.delai_grace_jours}
          onChange={(e) => maj("delai_grace_jours", e.target.value)}
          erreur={f.erreurs.delai_grace_jours}
          aide={t(
            "Jours après la fin d'une période avant qu'une mesure manquante soit « en retard » (0 à 60).",
            'Days after the end of a period before a missing measurement is "overdue" (0 to 60).',
          )}
        />
        <Champ
          libelle={t(
            "Alerte de dégradation après (périodes)",
            "Deterioration alert after (periods)",
          )}
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.periodes_degradation}
          onChange={(e) => maj("periodes_degradation", e.target.value)}
          erreur={f.erreurs.periodes_degradation}
          aide={t(
            "Nombre de dégradations consécutives, dans le sens de lecture du KPI, qui déclenche l'alerte (1 à 24).",
            "Number of consecutive deteriorations, in the KPI's reading direction, that triggers the alert (1 to 24).",
          )}
        />
      </div>
      <CaseACocher
        libelle={t("Valeurs validées par le cabinet", "Values approved by the firm")}
        aide={t(
          "À cocher une fois ces réglages confirmés par le métier (valeurs de départ : rappels actifs, 5 jours, 3 périodes).",
          "Tick once these settings are confirmed by the business (starting values: reminders on, 5 days, 3 periods).",
        )}
        checked={s.valeurs_validees}
        onChange={(e) => maj("valeurs_validees", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer les réglages", "Save settings")}
        </Bouton>
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminEvaluation,
  messagePortefeuille,
  OPTIONS_NOTE,
  saisieEvaluation,
  validerEvaluation,
  type EvaluationPortefeuille,
  type SaisieEvaluation,
} from "../../lib/plan-portefeuille";
import type { Resultat } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface EvaluationInitiativeProps {
  planId: string;
  initiativeId: string;
  titre: string;
  evaluation: EvaluationPortefeuille | null;
}

/**
 * Évaluation d'une initiative pour la priorisation (PLA-14) : valeur, effort et risque de 1 à
 * 5, charge en jours-homme. Chaque enregistrement est une nouvelle version ; le score est
 * calculé par le moteur côté API.
 */
export function EvaluationInitiative({
  planId,
  initiativeId,
  titre,
  evaluation,
}: EvaluationInitiativeProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<keyof SaisieEvaluation>();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieEvaluation>(() => saisieEvaluation(evaluation));
  const champ = (cle: keyof SaisieEvaluation) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: f.erreurs[cle],
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerEvaluation(s, langue);
    const validation: Resultat<Record<string, unknown>, keyof SaisieEvaluation> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    const ok = await f.envoyer(
      validation,
      (corps) => api.put(cheminEvaluation(planId, initiativeId), corps),
      {
        succes: t("Évaluation enregistrée.", "Assessment saved."),
        messageSpecifique: (err) => messagePortefeuille(err, langue),
      },
    );
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton variante="discret" icone="crayon" onClick={() => setOuvert(true)}>
            {evaluation ? t("Réévaluer", "Reassess") : t("Évaluer", "Assess")}
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
      aria-label={t(`Évaluer l'initiative ${titre}`, `Assess initiative ${titre}`)}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Évaluation refusée", "Assessment refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Valeur (5 = forte)", "Value (5 = high)")}
          required
          invite={t("Choisir", "Choose")}
          options={OPTIONS_NOTE}
          {...champ("valeur")}
        />
        <Select
          libelle={t("Effort (5 = lourd)", "Effort (5 = heavy)")}
          required
          invite={t("Choisir", "Choose")}
          options={OPTIONS_NOTE}
          {...champ("effort")}
        />
        <Select
          libelle={t("Risque (5 = élevé)", "Risk (5 = high)")}
          required
          invite={t("Choisir", "Choose")}
          options={OPTIONS_NOTE}
          {...champ("risque")}
        />
        <Champ
          libelle={t("Charge (jours-homme)", "Workload (person-days)")}
          required
          inputMode="numeric"
          {...champ("charge_jours")}
        />
        <Champ libelle={t("Commentaire", "Comment")} maxLength={1000} {...champ("commentaire")} />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

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
    const v = validerEvaluation(s);
    const validation: Resultat<Record<string, unknown>, keyof SaisieEvaluation> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    const ok = await f.envoyer(
      validation,
      (corps) => api.put(cheminEvaluation(planId, initiativeId), corps),
      { succes: "Évaluation enregistrée.", messageSpecifique: messagePortefeuille },
    );
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton variante="discret" icone="crayon" onClick={() => setOuvert(true)}>
            {evaluation ? "Réévaluer" : "Évaluer"}
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
      aria-label={`Évaluer l'initiative ${titre}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Évaluation refusée"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Valeur (5 = forte)"
          required
          invite="Choisir"
          options={OPTIONS_NOTE}
          {...champ("valeur")}
        />
        <Select
          libelle="Effort (5 = lourd)"
          required
          invite="Choisir"
          options={OPTIONS_NOTE}
          {...champ("effort")}
        />
        <Select
          libelle="Risque (5 = élevé)"
          required
          invite="Choisir"
          options={OPTIONS_NOTE}
          {...champ("risque")}
        />
        <Champ
          libelle="Charge (jours-homme)"
          required
          inputMode="numeric"
          {...champ("charge_jours")}
        />
        <Champ libelle="Commentaire" maxLength={1000} {...champ("commentaire")} />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

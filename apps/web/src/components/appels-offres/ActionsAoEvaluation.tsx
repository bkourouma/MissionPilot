"use client";

import { seg } from "./ActionsAoBouton";
import { useState } from "react";
import type { Traduire } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  messageAo,
  SAISIE_EVALUATION_VIDE,
  validerEvaluation,
  validerMotif,
  type SaisieEvaluation,
} from "../../lib/appels-offres";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

const champsEvaluation = (t: Traduire): [keyof SaisieEvaluation, string, string?][] => [
  [
    "adequation",
    t("Adéquation (0 à 100)", "Fit (0 to 100)"),
    t("Vide : score de rapprochement de la fiche.", "Empty: the record's matching score."),
  ],
  [
    "references_pertinentes",
    t("Références pertinentes", "Relevant references"),
    t("Vide : références du secteur trouvées.", "Empty: sector references found."),
  ],
  ["references_exigees", t("Références exigées", "Required references")],
  ["jours_disponibles", t("Jours disponibles", "Days available")],
  ["jours_requis", t("Jours requis", "Days required")],
  ["concurrents_connus", t("Concurrents connus", "Known competitors")],
  ["concurrents_forts", t("dont concurrents forts", "of which strong competitors")],
];

/** Entrées du score go/no-go (AO-02) ; la marge n'est proposée qu'avec `finance.lire`. */
export function FormulaireEvaluationAo({ id, voitFinance }: { id: string; voitFinance: boolean }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<keyof SaisieEvaluation>();
  const [s, setS] = useState<SaisieEvaluation>(SAISIE_EVALUATION_VIDE);
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerEvaluation(s, voitFinance, langue),
          (c) => api.post(`/api/appels-offres/${seg(id)}/evaluations`, c),
          {
            messageSpecifique: (err) => messageAo(err, langue),
            succes: t("Score go/no-go calculé.", "Go/no-go score computed."),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Évaluation impossible", "Evaluation failed")}
      />
      <div className="mp-grille-champs">
        {champsEvaluation(t).map(([cle, libelle, aide]) => (
          <Champ
            key={cle}
            libelle={libelle}
            inputMode="numeric"
            value={s[cle]}
            onChange={(e) => setS((x) => ({ ...x, [cle]: e.target.value }))}
            erreur={f.erreurs[cle]}
            aide={aide}
          />
        ))}
        {voitFinance ? (
          <>
            <Champ
              libelle={t("Marge estimée (%)", "Estimated margin (%)")}
              inputMode="decimal"
              value={s.marge}
              onChange={(e) => setS((x) => ({ ...x, marge: e.target.value }))}
              erreur={f.erreurs.marge}
              aide={t(
                "Donnée financière (FIN-02) ; vide : critère non évalué.",
                "Financial data (FIN-02); empty: criterion not assessed.",
              )}
            />
            <Champ
              libelle={t("Marge cible (%)", "Target margin (%)")}
              inputMode="decimal"
              value={s.marge_cible}
              onChange={(e) => setS((x) => ({ ...x, marge_cible: e.target.value }))}
              erreur={f.erreurs.marge_cible}
            />
          </>
        ) : null}
      </div>
      <Bouton type="submit" chargement={f.enCours} texteChargement={t("Calcul…", "Computing…")}>
        {t("Calculer le score", "Compute the score")}
      </Bouton>
    </form>
  );
}

/** Décision go/no-go de l'associé, motivée, sur la dernière évaluation (AO-02). */
export function FormulaireDecisionAo({
  id,
  evaluationId,
  goPossible,
}: {
  id: string;
  evaluationId: string;
  goPossible: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const decider = (decision: "go" | "no_go") =>
    f.envoyer(
      validerMotif(motif, langue),
      (m) =>
        api.post(`/api/appels-offres/${seg(id)}/decision`, {
          evaluation_id: evaluationId,
          decision,
          motif: m,
        }),
      {
        messageSpecifique: (err) => messageAo(err, langue),
        succes: t("Décision enregistrée.", "Decision saved."),
      },
    );
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision impossible", "Decision failed")}
      />
      <ZoneTexte
        libelle={t("Motif de la décision", "Reason for the decision")}
        required
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-ao__actions">
        {goPossible ? (
          <Bouton chargement={f.enCours} onClick={() => decider("go")}>
            {t("Décider go", "Decide go")}
          </Bouton>
        ) : null}
        <Bouton variante="danger" chargement={f.enCours} onClick={() => decider("no_go")}>
          {t("Décider no-go", "Decide no-go")}
        </Bouton>
      </div>
    </form>
  );
}

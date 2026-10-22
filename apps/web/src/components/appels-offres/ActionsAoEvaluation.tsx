"use client";

import { seg } from "./ActionsAoBouton";
import { useState } from "react";
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
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

const CHAMPS_EVALUATION: [keyof SaisieEvaluation, string, string?][] = [
  ["adequation", "Adéquation (0 à 100)", "Vide : score de rapprochement de la fiche."],
  ["references_pertinentes", "Références pertinentes", "Vide : références du secteur trouvées."],
  ["references_exigees", "Références exigées"],
  ["jours_disponibles", "Jours disponibles"],
  ["jours_requis", "Jours requis"],
  ["concurrents_connus", "Concurrents connus"],
  ["concurrents_forts", "dont concurrents forts"],
];

/** Entrées du score go/no-go (AO-02) ; la marge n'est proposée qu'avec `finance.lire`. */
export function FormulaireEvaluationAo({ id, voitFinance }: { id: string; voitFinance: boolean }) {
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
          validerEvaluation(s, voitFinance),
          (c) => api.post(`/api/appels-offres/${seg(id)}/evaluations`, c),
          { messageSpecifique: messageAo, succes: "Score go/no-go calculé." },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Évaluation impossible"
      />
      <div className="mp-grille-champs">
        {CHAMPS_EVALUATION.map(([cle, libelle, aide]) => (
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
              libelle="Marge estimée (%)"
              inputMode="decimal"
              value={s.marge}
              onChange={(e) => setS((x) => ({ ...x, marge: e.target.value }))}
              erreur={f.erreurs.marge}
              aide="Donnée financière (FIN-02) ; vide : critère non évalué."
            />
            <Champ
              libelle="Marge cible (%)"
              inputMode="decimal"
              value={s.marge_cible}
              onChange={(e) => setS((x) => ({ ...x, marge_cible: e.target.value }))}
              erreur={f.erreurs.marge_cible}
            />
          </>
        ) : null}
      </div>
      <Bouton type="submit" chargement={f.enCours} texteChargement="Calcul…">
        Calculer le score
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
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const decider = (decision: "go" | "no_go") =>
    f.envoyer(
      validerMotif(motif),
      (m) =>
        api.post(`/api/appels-offres/${seg(id)}/decision`, {
          evaluation_id: evaluationId,
          decision,
          motif: m,
        }),
      { messageSpecifique: messageAo, succes: "Décision enregistrée." },
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
        titreErreur="Décision impossible"
      />
      <ZoneTexte
        libelle="Motif de la décision"
        required
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-ao__actions">
        {goPossible ? (
          <Bouton chargement={f.enCours} onClick={() => decider("go")}>
            Décider go
          </Bouton>
        ) : null}
        <Bouton variante="danger" chargement={f.enCours} onClick={() => decider("no_go")}>
          Décider no-go
        </Bouton>
      </div>
    </form>
  );
}

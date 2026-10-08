"use client";

import { useState } from "react";
import {
  DECISION_ACCEPTATION_LIBELLES,
  FACTEURS_RISQUE_CLIENT,
  NIVEAUX_RISQUE_CLIENT,
  NIVEAU_RISQUE_LIBELLES,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminAcceptation,
  messageQualite,
  validerAcceptation,
  type SaisieAcceptation,
  type VueAcceptation,
} from "../../lib/qualite";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireAcceptationProps {
  missionId: string;
  /** Nombre de conflits détectés à l'instant par le serveur. */
  conflits: number;
  /** L'utilisateur peut décider (qualite.signer) ; sinon il évalue seulement (« en attente »). */
  peutDecider: boolean;
}

/**
 * Évaluation de l'acceptation (QUA-07) : facteurs de risque du client, niveau retenu (jamais
 * sous celui des facteurs), décision motivée. Les conflits ne se saisissent pas : le serveur les
 * recalcule et les fige dans l'évaluation enregistrée.
 */
export function FormulaireAcceptation({
  missionId,
  conflits,
  peutDecider,
}: FormulaireAcceptationProps) {
  const f = useFormulaire<"decision" | "motif" | "niveau_retenu">();
  const [saisie, setSaisie] = useState<SaisieAcceptation>({
    facteurs: [],
    niveau_retenu: "",
    decision: "en_attente",
    motif: "",
  });
  const decisions = Object.entries(DECISION_ACCEPTATION_LIBELLES).filter(
    ([d]) => peutDecider || d === "en_attente",
  );
  const bascule = (code: string, coche: boolean) =>
    setSaisie((s) => ({
      ...s,
      facteurs: coche ? [...s.facteurs, code] : s.facteurs.filter((x) => x !== code),
    }));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerAcceptation(saisie, { conflits }),
          (charge) => api.post<VueAcceptation>(cheminAcceptation(missionId), charge),
          {
            succes: "Évaluation enregistrée dans l'historique.",
            messageSpecifique: messageQualite,
            apres: () => setSaisie((s) => ({ ...s, motif: "" })),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Évaluation refusée"
      />
      <fieldset className="mp-qualite__facteurs">
        <legend>Profil de risque du client</legend>
        {FACTEURS_RISQUE_CLIENT.map((x) => (
          <CaseACocher
            key={x.code}
            libelle={`${x.libelle} (niveau ${NIVEAU_RISQUE_LIBELLES[x.niveau].toLowerCase()})`}
            checked={saisie.facteurs.includes(x.code)}
            onChange={(e) => bascule(x.code, e.target.checked)}
          />
        ))}
      </fieldset>
      <div className="mp-grille-champs">
        <Select
          libelle="Niveau retenu"
          value={saisie.niveau_retenu}
          onChange={(e) => setSaisie((s) => ({ ...s, niveau_retenu: e.target.value }))}
          invite="Niveau calculé par les facteurs"
          options={NIVEAUX_RISQUE_CLIENT.map((n) => ({
            valeur: n,
            libelle: NIVEAU_RISQUE_LIBELLES[n],
          }))}
          erreur={f.erreurs.niveau_retenu}
          aide="Le niveau calculé est le plus élevé des facteurs cochés ; vous pouvez le relever, jamais le baisser."
        />
        <Select
          libelle="Décision"
          required
          value={saisie.decision}
          onChange={(e) => setSaisie((s) => ({ ...s, decision: e.target.value }))}
          options={decisions.map(([valeur, libelle]) => ({ valeur, libelle }))}
          erreur={f.erreurs.decision}
          aide={
            peutDecider
              ? undefined
              : "Seul un directeur de mission ou un associé décide ; vous pouvez enregistrer une évaluation."
          }
        />
      </div>
      <ZoneTexte
        libelle="Motif"
        rows={3}
        maxLength={2000}
        value={saisie.motif}
        onChange={(e) => setSaisie((s) => ({ ...s, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide={
          conflits > 0
            ? "Des conflits d'intérêts sont détectés : accepter, conditionner ou refuser exige un motif."
            : "Obligatoire pour refuser ou accepter sous conditions."
        }
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer l&apos;évaluation
        </Bouton>
      </div>
    </form>
  );
}

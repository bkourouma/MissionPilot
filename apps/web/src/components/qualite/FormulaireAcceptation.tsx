"use client";

import { useState } from "react";
import {
  DECISIONS_ACCEPTATION,
  FACTEURS_RISQUE_CLIENT,
  NIVEAUX_RISQUE_CLIENT,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminAcceptation,
  libelleDecision,
  libelleFacteurRisque,
  libelleNiveauRisque,
  messageQualite,
  validerAcceptation,
  type SaisieAcceptation,
  type VueAcceptation,
} from "../../lib/qualite";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"decision" | "motif" | "niveau_retenu">();
  const [saisie, setSaisie] = useState<SaisieAcceptation>({
    facteurs: [],
    niveau_retenu: "",
    decision: "en_attente",
    motif: "",
  });
  const decisions = DECISIONS_ACCEPTATION.filter((d) => peutDecider || d === "en_attente");
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
          validerAcceptation(saisie, { conflits }, langue),
          (charge) => api.post<VueAcceptation>(cheminAcceptation(missionId), charge),
          {
            succes: t(
              "Évaluation enregistrée dans l'historique.",
              "Assessment saved in the history.",
            ),
            messageSpecifique: (e) => messageQualite(e, langue),
            apres: () => setSaisie((s) => ({ ...s, motif: "" })),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Évaluation refusée", "Assessment refused")}
      />
      <fieldset className="mp-qualite__facteurs">
        <legend>{t("Profil de risque du client", "Client risk profile")}</legend>
        {FACTEURS_RISQUE_CLIENT.map((x) => (
          <CaseACocher
            key={x.code}
            libelle={t(
              `${libelleFacteurRisque(x.code)} (niveau ${libelleNiveauRisque(x.niveau).toLowerCase()})`,
              `${libelleFacteurRisque(x.code, "en")} (${libelleNiveauRisque(x.niveau, "en").toLowerCase()} level)`,
            )}
            checked={saisie.facteurs.includes(x.code)}
            onChange={(e) => bascule(x.code, e.target.checked)}
          />
        ))}
      </fieldset>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Niveau retenu", "Selected level")}
          value={saisie.niveau_retenu}
          onChange={(e) => setSaisie((s) => ({ ...s, niveau_retenu: e.target.value }))}
          invite={t("Niveau calculé par les facteurs", "Level computed from the factors")}
          options={NIVEAUX_RISQUE_CLIENT.map((n) => ({
            valeur: n,
            libelle: libelleNiveauRisque(n, langue),
          }))}
          erreur={f.erreurs.niveau_retenu}
          aide={t(
            "Le niveau calculé est le plus élevé des facteurs cochés ; vous pouvez le relever, jamais le baisser.",
            "The computed level is the highest of the checked factors; you can raise it, never lower it.",
          )}
        />
        <Select
          libelle={t("Décision", "Decision")}
          required
          value={saisie.decision}
          onChange={(e) => setSaisie((s) => ({ ...s, decision: e.target.value }))}
          options={decisions.map((valeur) => ({
            valeur,
            libelle: libelleDecision(valeur, langue),
          }))}
          erreur={f.erreurs.decision}
          aide={
            peutDecider
              ? undefined
              : t(
                  "Seul un directeur de mission ou un associé décide ; vous pouvez enregistrer une évaluation.",
                  "Only an engagement director or a partner decides; you can save an assessment.",
                )
          }
        />
      </div>
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        rows={3}
        maxLength={2000}
        value={saisie.motif}
        onChange={(e) => setSaisie((s) => ({ ...s, motif: e.target.value }))}
        erreur={f.erreurs.motif}
        aide={
          conflits > 0
            ? t(
                "Des conflits d'intérêts sont détectés : accepter, conditionner ou refuser exige un motif.",
                "Conflicts of interest were detected: accepting, conditioning or declining requires a reason.",
              )
            : t(
                "Obligatoire pour refuser ou accepter sous conditions.",
                "Required to decline or accept with conditions.",
              )
        }
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'évaluation", "Save assessment")}
        </Bouton>
      </div>
    </form>
  );
}

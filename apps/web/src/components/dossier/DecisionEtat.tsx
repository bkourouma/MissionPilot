"use client";

import { useState } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { api } from "../../lib/api";
import { cheminApiDossier, validerDecisionEtat, type ChampDecision } from "../../lib/dossier";

/**
 * Revue d'un état financier en écart ou incomplet : accepter (motif obligatoire si des
 * contrôles échouent ; l'importateur ne force pas lui-même, sauf associé — règle de l'API) ou
 * rejeter (motif obligatoire). Jamais d'acceptation silencieuse.
 */
export function DecisionEtat({
  clientId,
  etatId,
  controlesOk,
}: {
  clientId: string;
  etatId: string;
  controlesOk: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const f = useFormulaire<ChampDecision>();
  const url = `${cheminApiDossier(clientId)}/etats-financiers/${encodeURIComponent(etatId)}/decision`;
  const decider = (decision: "accepte" | "rejete") =>
    f.envoyer(
      validerDecisionEtat(decision, motif, controlesOk, langue),
      (charge) => api.post(url, charge),
      {
        succes:
          decision === "accepte"
            ? t("État accepté.", "Statement accepted.")
            : t("État rejeté.", "Statement rejected."),
      },
    );

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      aria-label={t("Décision sur l'état financier", "Decision on the financial statement")}
      onSubmit={(e) => e.preventDefault()}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      <ZoneTexte
        libelle={t("Motif de la décision", "Reason for the decision")}
        rows={3}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={
          controlesOk
            ? t("Obligatoire pour un rejet.", "Required for a rejection.")
            : t(
                "Obligatoire : expliquez pourquoi les écarts sont admis, ou pourquoi l'état est rejeté.",
                "Required: explain why the gaps are accepted, or why the statement is rejected.",
              )
        }
      />
      <div className="mp-barre-actions">
        <Bouton
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
          onClick={() => void decider("accepte")}
        >
          {controlesOk
            ? t("Accepter", "Accept")
            : t("Accepter malgré les écarts", "Accept despite the gaps")}
        </Bouton>
        <Bouton variante="danger" disabled={f.enCours} onClick={() => void decider("rejete")}>
          {t("Rejeter", "Reject")}
        </Bouton>
      </div>
    </form>
  );
}

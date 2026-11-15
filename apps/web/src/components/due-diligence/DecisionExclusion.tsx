"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { cheminDecisionsFiltrage, libellesDd, messageDd } from "../../lib/due-diligence";
import { MOTIF_DECISION_MIN, validerDecisionExclusion } from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface DecisionExclusionProps {
  filtrageId: string;
  regleCode: string;
  libelleRegle: string;
}

/**
 * Décision sur une règle d'exclusion touchée (DD-14) : « Exclusion confirmée » ou « Faux positif
 * écarté », motivée (10 caractères au moins). Réservée à un valideur autre que l'auteur de la
 * revue ; l'API juge (séparation des tâches, doublée en base).
 */
export function DecisionExclusion({ filtrageId, regleCode, libelleRegle }: DecisionExclusionProps) {
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function decider(decision: "confirmee" | "ecartee") {
    await f.envoyer(
      validerDecisionExclusion(regleCode, decision, motif, langue),
      (charge) => api.post(cheminDecisionsFiltrage(filtrageId), charge),
      {
        succes: t(
          `Décision enregistrée : ${L.DECISION_EXCLUSION[decision].toLowerCase()}.`,
          `Decision saved: ${L.DECISION_EXCLUSION[decision].toLowerCase()}.`,
        ),
        messageSpecifique: (e) => messageDd(e, langue),
        apres: () => setMotif(""),
      },
    );
  }

  return (
    <div className="mp-formulaire">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Décision refusée", "Decision refused")}
      />
      <ZoneTexte
        libelle={t(
          `Motif de la décision sur « ${libelleRegle} »`,
          `Reason for the decision on “${libelleRegle}”`,
        )}
        required
        rows={2}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={t(
          `${MOTIF_DECISION_MIN} caractères au moins ; conservé avec la décision.`,
          `At least ${MOTIF_DECISION_MIN} characters; kept with the decision.`,
        )}
      />
      <div className="mp-barre-actions">
        <Bouton variante="danger" disabled={f.enCours} onClick={() => void decider("confirmee")}>
          {L.DECISION_EXCLUSION.confirmee}
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => void decider("ecartee")}>
          {t("Faux positif écarté", "False positive dismissed")}
        </Bouton>
      </div>
    </div>
  );
}

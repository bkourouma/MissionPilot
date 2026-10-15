"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  cheminDecisionsFiltrage,
  DECISION_EXCLUSION_LIBELLES,
  messageDd,
} from "../../lib/due-diligence";
import { MOTIF_DECISION_MIN, validerDecisionExclusion } from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
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
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function decider(decision: "confirmee" | "ecartee") {
    await f.envoyer(
      validerDecisionExclusion(regleCode, decision, motif),
      (charge) => api.post(cheminDecisionsFiltrage(filtrageId), charge),
      {
        succes: `Décision enregistrée : ${DECISION_EXCLUSION_LIBELLES[decision].toLowerCase()}.`,
        messageSpecifique: messageDd,
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
        titreErreur="Décision refusée"
      />
      <ZoneTexte
        libelle={`Motif de la décision sur « ${libelleRegle} »`}
        required
        rows={2}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={`${MOTIF_DECISION_MIN} caractères au moins ; conservé avec la décision.`}
      />
      <div className="mp-barre-actions">
        <Bouton variante="danger" disabled={f.enCours} onClick={() => void decider("confirmee")}>
          {DECISION_EXCLUSION_LIBELLES.confirmee}
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => void decider("ecartee")}>
          Faux positif écarté
        </Bouton>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
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
  const [motif, setMotif] = useState("");
  const f = useFormulaire<ChampDecision>();
  const url = `${cheminApiDossier(clientId)}/etats-financiers/${encodeURIComponent(etatId)}/decision`;
  const decider = (decision: "accepte" | "rejete") =>
    f.envoyer(
      validerDecisionEtat(decision, motif, controlesOk),
      (charge) => api.post(url, charge),
      {
        succes: decision === "accepte" ? "État accepté." : "État rejeté.",
      },
    );

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      aria-label="Décision sur l'état financier"
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
        rows={3}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={
          controlesOk
            ? "Obligatoire pour un rejet."
            : "Obligatoire : expliquez pourquoi les écarts sont admis, ou pourquoi l'état est rejeté."
        }
      />
      <div className="mp-barre-actions">
        <Bouton
          chargement={f.enCours}
          texteChargement="Enregistrement…"
          onClick={() => void decider("accepte")}
        >
          {controlesOk ? "Accepter" : "Accepter malgré les écarts"}
        </Bouton>
        <Bouton variante="danger" disabled={f.enCours} onClick={() => void decider("rejete")}>
          Rejeter
        </Bouton>
      </div>
    </form>
  );
}

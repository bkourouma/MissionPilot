"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CONCLUSION_LONGUEUR_MAX,
  cheminCloture,
  compteurCaracteres,
  messageNotationAugmentee,
  validerConclusion,
  type SessionCalibration,
} from "../../lib/notation-augmentee";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Clôture d'une session de calibrage par un expert métier (MPN11), avec sa conclusion. Confirmation
 * en deux temps : la session est ensuite figée, les cotations de tous deviennent visibles et la
 * mesure d'écart est calculée sur tous les cas.
 */
export function CloturerCalibration({ sessionId }: { sessionId: string }) {
  const f = useFormulaire<"conclusion">();
  const [conclusion, setConclusion] = useState("");
  const prete = conclusion.trim() !== "";

  function cloturer(): Promise<boolean> {
    return f.envoyer(
      validerConclusion(conclusion),
      (charge) => api.post<SessionCalibration>(cheminCloture(sessionId), charge),
      { succes: "Session close.", messageSpecifique: messageNotationAugmentee },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(ev: FormEvent) => ev.preventDefault()}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Clôture impossible"
      />
      <ZoneTexte
        libelle="Conclusion de la session"
        required
        rows={4}
        value={conclusion}
        onChange={(e) => setConclusion(e.target.value)}
        erreur={f.erreurs.conclusion}
        maxLength={CONCLUSION_LONGUEUR_MAX + 300}
        aide={`Ce qui ressort de la calibration : cas à discuter, consignes aux évaluateurs. ${compteurCaracteres(conclusion, CONCLUSION_LONGUEUR_MAX)}`}
      />
      <div className="mp-barre-actions">
        {prete ? (
          <BoutonConfirmation
            libelle="Clore la session"
            question="Clore cette session ? Plus aucune cotation ne sera acceptée ; les cotations de tous et la mesure d'écart deviennent visibles."
            libelleConfirmation="Oui, clore la session"
            texteChargement="Clôture…"
            variante="primaire"
            action={cloturer}
          />
        ) : (
          <Bouton variante="primaire" disabled>
            Clore la session
          </Bouton>
        )}
      </div>
      {!prete ? (
        <p className="mp-texte-doux mp-texte-petit">
          Rédigez la conclusion pour pouvoir clore la session.
        </p>
      ) : null}
    </form>
  );
}

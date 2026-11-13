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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"conclusion">();
  const [conclusion, setConclusion] = useState("");
  const prete = conclusion.trim() !== "";

  function cloturer(): Promise<boolean> {
    return f.envoyer(
      validerConclusion(conclusion, langue),
      (charge) => api.post<SessionCalibration>(cheminCloture(sessionId), charge),
      {
        succes: t("Session close.", "Session closed."),
        messageSpecifique: (err) => messageNotationAugmentee(err, langue),
      },
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
        titreErreur={t("Clôture impossible", "Close-out failed")}
      />
      <ZoneTexte
        libelle={t("Conclusion de la session", "Session conclusion")}
        required
        rows={4}
        value={conclusion}
        onChange={(e) => setConclusion(e.target.value)}
        erreur={f.erreurs.conclusion}
        maxLength={CONCLUSION_LONGUEUR_MAX + 300}
        aide={
          t(
            "Ce qui ressort de la calibration : cas à discuter, consignes aux évaluateurs.",
            "What comes out of the calibration: cases to discuss, instructions to raters.",
          ) +
          " " +
          compteurCaracteres(conclusion, CONCLUSION_LONGUEUR_MAX, langue)
        }
      />
      <div className="mp-barre-actions">
        {prete ? (
          <BoutonConfirmation
            libelle={t("Clore la session", "Close the session")}
            question={t(
              "Clore cette session ? Plus aucune cotation ne sera acceptée ; les cotations de tous et la mesure d'écart deviennent visibles.",
              "Close this session? No further rating will be accepted; everyone's ratings and the gap measure become visible.",
            )}
            libelleConfirmation={t("Oui, clore la session", "Yes, close the session")}
            texteChargement={t("Clôture…", "Closing…")}
            variante="primaire"
            action={cloturer}
          />
        ) : (
          <Bouton variante="primaire" disabled>
            {t("Clore la session", "Close the session")}
          </Bouton>
        )}
      </div>
      {!prete ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Rédigez la conclusion pour pouvoir clore la session.",
            "Write the conclusion to be able to close the session.",
          )}
        </p>
      ) : null}
    </form>
  );
}

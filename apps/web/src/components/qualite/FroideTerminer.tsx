"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { cheminTerminer, messageFroide } from "../../lib/qualite-froide";
import {
  erreurChampAffichee,
  erreurGlobaleAffichee,
  validerTerminaison,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Fin de la revue : synthèse obligatoire, puis confirmation. Une revue terminée est figée ; le
 * score et la conclusion sont fixés par le moteur à cet instant, pas par le relecteur.
 */
export function FroideTerminer({ echantillonId }: { echantillonId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"synthese">();
  const [synthese, setSynthese] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  // L'erreur du champ vient du dernier envoi : elle ne vaut plus dès que la synthèse change ou
  // que le panneau de confirmation s'ouvre.
  const [erreurPerimee, setErreurPerimee] = useState(false);
  // Idem pour le bandeau d'erreur de l'API (ex. « grille incomplète ») : périmé dès que la synthèse
  // change ou que la confirmation s'ouvre ; remis à faux avant chaque nouvel envoi.
  const [globalePerimee, setGlobalePerimee] = useState(false);
  const validation = validerTerminaison(synthese, langue);

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirmation) {
          if (validation.ok) {
            setErreurPerimee(true);
            setGlobalePerimee(true);
            setConfirmation(true);
          } else {
            setErreurPerimee(false);
            setGlobalePerimee(false);
            await f.envoyer(validation, async () => undefined);
          }
          return;
        }
        setErreurPerimee(false);
        setGlobalePerimee(false);
        const fait = await f.envoyer(
          validation,
          (charge) => api.post(cheminTerminer(echantillonId), charge),
          {
            succes: t("Revue terminée et figée.", "Review completed and frozen."),
            messageSpecifique: (e) => messageFroide(e, langue),
          },
        );
        if (!fait) setConfirmation(false);
      }}
    >
      <RetourFormulaire
        erreur={erreurGlobaleAffichee(f.erreurGlobale, globalePerimee)}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("La revue n'a pas pu être terminée", "The review could not be completed")}
      />
      <ZoneTexte
        libelle={t("Synthèse de la revue", "Review summary")}
        required
        rows={5}
        maxLength={4000}
        value={synthese}
        onChange={(e) => {
          setSynthese(e.target.value);
          setErreurPerimee(true);
          setGlobalePerimee(true);
          setConfirmation(false);
        }}
        erreur={erreurChampAffichee(f.erreurs.synthese, erreurPerimee)}
        aide={t(
          "Votre appréciation d'ensemble, à l'attention de l'associé. Elle sera figée avec la revue.",
          "Your overall assessment, for the partner. It will be frozen with the review.",
        )}
      />
      {confirmation ? (
        <Alerte
          tonalite="attention"
          titre={t("Terminer et figer cette revue ?", "Complete and freeze this review?")}
          annonce="status"
        >
          <p>
            {t(
              "Après confirmation, les notes, les constats et la synthèse ne pourront plus être modifiés. Le score et la conclusion seront calculés par le moteur.",
              "After confirmation, the scores, findings and summary can no longer be edited. The score and conclusion will be computed by the engine.",
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={confirmation ? "danger" : "primaire"}
          chargement={f.enCours}
          texteChargement={t("Clôture de la revue…", "Closing the review…")}
        >
          {confirmation
            ? t("Oui, terminer la revue", "Yes, complete the review")
            : t("Terminer la revue", "Complete the review")}
        </Bouton>
        {confirmation ? (
          <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setConfirmation(false)}>
            {t("Annuler", "Cancel")}
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

"use client";

import { api } from "../../lib/api";
import { cheminClotureCampagne } from "../../lib/qualite-froide";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useT } from "../i18n/FournisseurLangue";
import { useActionFroide } from "./useActionFroide";

/** Clôture de la campagne : confirmation en deux temps ; l'API exige que toutes les revues soient terminées. */
export function FroideClotureCampagne({ campagneId }: { campagneId: string }) {
  const t = useT();
  const a = useActionFroide();
  return (
    <div className="mp-froide__pile">
      <RetourFormulaire
        erreur={a.erreur}
        succes={a.succes}
        refAlerte={a.refAlerte}
        titreErreur={t("Clôture refusée", "Close-out refused")}
      />
      <BoutonConfirmation
        libelle={t("Clore la campagne", "Close the campaign")}
        question={t(
          "Clore cette campagne ? Le tirage et les revues terminées restent figés ; le plan d'amélioration continue.",
          "Close this campaign? The sample and completed reviews stay frozen; the improvement plan continues.",
        )}
        libelleConfirmation={t("Oui, clore la campagne", "Yes, close the campaign")}
        texteChargement={t("Clôture…", "Closing…")}
        action={async () => {
          const r = await a.agir(() => api.post(cheminClotureCampagne(campagneId), {}), {
            succes: t("Campagne close.", "Campaign closed."),
          });
          return r.ok;
        }}
      />
    </div>
  );
}

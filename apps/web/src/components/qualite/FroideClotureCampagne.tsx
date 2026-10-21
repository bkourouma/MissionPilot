"use client";

import { api } from "../../lib/api";
import { cheminClotureCampagne } from "../../lib/qualite-froide";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useActionFroide } from "./useActionFroide";

/** Clôture de la campagne : confirmation en deux temps ; l'API exige que toutes les revues soient terminées. */
export function FroideClotureCampagne({ campagneId }: { campagneId: string }) {
  const a = useActionFroide();
  return (
    <div className="mp-froide__pile">
      <RetourFormulaire
        erreur={a.erreur}
        succes={a.succes}
        refAlerte={a.refAlerte}
        titreErreur="Clôture refusée"
      />
      <BoutonConfirmation
        libelle="Clore la campagne"
        question="Clore cette campagne ? Le tirage et les revues terminées restent figés ; le plan d'amélioration continue."
        libelleConfirmation="Oui, clore la campagne"
        texteChargement="Clôture…"
        action={async () => {
          const r = await a.agir(() => api.post(cheminClotureCampagne(campagneId), {}), {
            succes: "Campagne close.",
          });
          return r.ok;
        }}
      />
    </div>
  );
}

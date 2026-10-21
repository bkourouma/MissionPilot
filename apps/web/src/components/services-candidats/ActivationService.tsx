"use client";

import { useState } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { api } from "../../lib/api";
import { MESSAGE_FIXER_PRIX_D_ABORD, type ServiceCandidat } from "../../lib/services-candidats";

/**
 * Active le type de mission d'UN service (idempotent côté API). Un service à prix fixe dont le
 * prix n'est pas saisi (`a_fixer`) ne s'active pas : l'API répond 409 « PRIX_A_FIXER ».
 */
export function ActivationService({ service }: { service: ServiceCandidat }) {
  const f = useFormulaire<never>();
  const [resultat, setResultat] = useState<string | null>(null);
  const bloque = service.prix.a_fixer;

  const activer = () =>
    f.envoyer(
      { ok: true, charge: null },
      () =>
        api.post<{ types_crees: number }>("/api/services-candidats/activer", {
          service: service.code,
        }),
      {
        apres: (r) =>
          setResultat(
            r.types_crees === 0
              ? "Le type de mission était déjà activé : rien n'a été ajouté."
              : "Type de mission activé. Ces valeurs de départ sont à valider par un expert.",
          ),
      },
    );

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={resultat}
        refAlerte={f.refAlerte}
        titreErreur="Activation impossible"
      />
      <div>
        <Bouton
          variante="secondaire"
          icone="livre"
          disabled={bloque}
          chargement={f.enCours}
          texteChargement="Activation…"
          onClick={activer}
        >
          Activer le type de mission
        </Bouton>
      </div>
      {bloque ? (
        <p className="mp-texte-doux" role="status">
          {MESSAGE_FIXER_PRIX_D_ABORD}
        </p>
      ) : null}
    </div>
  );
}

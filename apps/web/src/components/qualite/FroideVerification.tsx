"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { empreinteCourte } from "../../lib/qualite";
import { cheminVerification, type VerificationTirage } from "../../lib/qualite-froide";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useActionFroide } from "./useActionFroide";

/**
 * Vérification de la reproductibilité du tirage : l'API rejoue le tirage avec la graine et les
 * critères enregistrés et compare le résultat à l'échantillon figé. Le web n'affiche que le verdict.
 */
export function FroideVerification({ campagneId }: { campagneId: string }) {
  const a = useActionFroide();
  const [resultat, setResultat] = useState<VerificationTirage | null>(null);

  return (
    <div className="mp-froide__pile">
      <div>
        <Bouton
          variante="secondaire"
          chargement={a.enCours}
          texteChargement="Vérification…"
          onClick={async () => {
            setResultat(null);
            const r = await a.agir(
              () => api.get<VerificationTirage>(cheminVerification(campagneId)),
              {
                rafraichir: false,
              },
            );
            if (r.ok) setResultat(r.valeur);
          }}
        >
          Vérifier la reproductibilité
        </Bouton>
      </div>
      <RetourFormulaire
        erreur={a.erreur}
        refAlerte={a.refAlerte}
        titreErreur="Vérification impossible"
      />
      {resultat ? (
        <Alerte
          tonalite={resultat.reproductible ? "succes" : "danger"}
          titre={
            resultat.reproductible
              ? "Le tirage est reproductible : les mêmes critères et la même graine redonnent le même échantillon."
              : "Le tirage n'est pas reproductible : des écarts ont été constatés."
          }
          annonce="status"
        >
          <p>
            Graine « {resultat.graine} » · population de {resultat.population_taille} mission(s) ·
            empreinte{" "}
            <span title={resultat.empreinte_population}>
              {empreinteCourte(resultat.empreinte_population)}
            </span>{" "}
            · échantillon de {resultat.taille_echantillon} mission(s).
          </p>
          {resultat.ecarts.length > 0 ? (
            <ul>
              {resultat.ecarts.map((e, i) => (
                <li key={`${e.type}-${i}`}>{e.message}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
    </div>
  );
}

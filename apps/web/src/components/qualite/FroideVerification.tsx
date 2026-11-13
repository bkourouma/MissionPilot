"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { empreinteCourte } from "../../lib/qualite";
import { cheminVerification, type VerificationTirage } from "../../lib/qualite-froide";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useT } from "../i18n/FournisseurLangue";
import { useActionFroide } from "./useActionFroide";

/**
 * Vérification de la reproductibilité du tirage : l'API rejoue le tirage avec la graine et les
 * critères enregistrés et compare le résultat à l'échantillon figé. Le web n'affiche que le verdict.
 */
export function FroideVerification({ campagneId }: { campagneId: string }) {
  const t = useT();
  const a = useActionFroide();
  const [resultat, setResultat] = useState<VerificationTirage | null>(null);

  return (
    <div className="mp-froide__pile">
      <div>
        <Bouton
          variante="secondaire"
          chargement={a.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
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
          {t("Vérifier la reproductibilité", "Check reproducibility")}
        </Bouton>
      </div>
      <RetourFormulaire
        erreur={a.erreur}
        refAlerte={a.refAlerte}
        titreErreur={t("Vérification impossible", "Verification failed")}
      />
      {resultat ? (
        <Alerte
          tonalite={resultat.reproductible ? "succes" : "danger"}
          titre={
            resultat.reproductible
              ? t(
                  "Le tirage est reproductible : les mêmes critères et la même graine redonnent le même échantillon.",
                  "The draw is reproducible: the same criteria and the same seed give the same sample.",
                )
              : t(
                  "Le tirage n'est pas reproductible : des écarts ont été constatés.",
                  "The draw is not reproducible: discrepancies were found.",
                )
          }
          annonce="status"
        >
          <p>
            {t("Graine", "Seed")} « {resultat.graine} » ·{" "}
            {t(
              `population de ${resultat.population_taille} mission(s)`,
              `population of ${resultat.population_taille} engagement(s)`,
            )}{" "}
            · {t("empreinte", "fingerprint")}{" "}
            <span title={resultat.empreinte_population}>
              {empreinteCourte(resultat.empreinte_population)}
            </span>{" "}
            ·{" "}
            {t(
              `échantillon de ${resultat.taille_echantillon} mission(s).`,
              `sample of ${resultat.taille_echantillon} engagement(s).`,
            )}
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

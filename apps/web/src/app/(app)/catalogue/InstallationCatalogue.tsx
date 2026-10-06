"use client";

import { useState } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../components/ui/Bouton";
import { api } from "../../../lib/api";

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Installe les grades et types de mission de conseil de départ (idempotent côté API). */
export function InstallationCatalogue() {
  const f = useFormulaire<never>();
  const [resultat, setResultat] = useState<string | null>(null);

  const installer = () =>
    f.envoyer(
      { ok: true, charge: null },
      () => api.post<{ grades: number; types: number }>("/api/catalogue/semer-conseil"),
      {
        apres: (r) =>
          setResultat(
            r.grades === 0 && r.types === 0
              ? "Le catalogue de conseil était déjà installé : rien n'a été ajouté."
              : `Ajouté : ${pluriel(r.grades, "grade", "grades")} et ${pluriel(r.types, "type de mission", "types de mission")}. Ces valeurs de départ sont à valider par le cabinet.`,
          ),
      },
    );

  return (
    <div className="mp-pile">
      <p>
        Ajoute des grades (junior, senior, manager…) et des types de mission courants (plan
        stratégique, audit organisationnel…) avec leur découpage. Les éléments déjà présents ne sont
        pas modifiés.
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={resultat}
        refAlerte={f.refAlerte}
        titreErreur="Installation impossible"
      />
      <div>
        <Bouton
          variante="secondaire"
          icone="livre"
          chargement={f.enCours}
          texteChargement="Installation…"
          onClick={installer}
        >
          Installer le catalogue de conseil
        </Bouton>
      </div>
    </div>
  );
}

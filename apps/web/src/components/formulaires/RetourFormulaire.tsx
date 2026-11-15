"use client";

import type { Ref } from "react";
import { useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";

export interface RetourFormulaireProps {
  erreur: string | null;
  succes?: string | null;
  refAlerte: Ref<HTMLDivElement>;
  titreErreur?: string;
}

/** Erreur globale (focalisée, annoncée) et message de succès (annoncé poliment). */
export function RetourFormulaire({
  erreur,
  succes,
  refAlerte,
  titreErreur,
}: RetourFormulaireProps) {
  const t = useT();
  return (
    <>
      {erreur ? (
        <Alerte
          ref={refAlerte}
          tonalite="danger"
          titre={titreErreur ?? t("Enregistrement impossible", "Could not save")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
    </>
  );
}

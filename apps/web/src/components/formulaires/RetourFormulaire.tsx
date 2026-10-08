"use client";

import type { Ref } from "react";
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
  titreErreur = "Enregistrement impossible",
}: RetourFormulaireProps) {
  return (
    <>
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre={titreErreur}>
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

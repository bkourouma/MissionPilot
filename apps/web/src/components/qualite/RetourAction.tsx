"use client";

import type { Ref } from "react";
import { libelleViolation, type Violation } from "../../lib/qualite";
import { Alerte } from "../ui/Alerte";

export interface RetourActionProps {
  erreur: string | null;
  succes: string | null;
  violations: Violation[];
  refAlerte: Ref<HTMLDivElement>;
  titreErreur?: string;
}

/** Erreur globale (avec les violations de garde du moteur) et succès d'une action qualité. */
export function RetourAction({
  erreur,
  succes,
  violations,
  refAlerte,
  titreErreur = "Action refusée",
}: RetourActionProps) {
  return (
    <>
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre={titreErreur}>
          <p>{erreur}</p>
          {violations.length > 0 ? (
            <ul>
              {violations.map((v, i) => (
                <li key={`${v.code}-${i}`}>{libelleViolation(v)}</li>
              ))}
            </ul>
          ) : null}
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

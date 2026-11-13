"use client";

import { useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";

/** Erreur (annoncée) et succès (annoncé poliment) d'une action du partage investisseur. */
export function PartageInvestisseurRetour({
  erreur,
  succes,
}: {
  erreur: string | null;
  succes: string | null;
}) {
  const t = useT();
  return (
    <>
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Action impossible", "Action not possible")}>
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

import { Alerte } from "../ui/Alerte";

/** Erreur (annoncée) et succès (annoncé poliment) d'une action du partage investisseur. */
export function PartageInvestisseurRetour({
  erreur,
  succes,
}: {
  erreur: string | null;
  succes: string | null;
}) {
  return (
    <>
      {erreur ? (
        <Alerte tonalite="danger" titre="Action impossible">
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

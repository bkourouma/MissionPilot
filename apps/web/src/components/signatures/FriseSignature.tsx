import type { PreuveSignatureApi, SignataireSignatureApi } from "@missionpilot/shared";
import { dateHeureCourte } from "../../lib/canaux";
import { grouperFrise } from "../../lib/signatures";
import "../canaux/canaux.css";

export interface FriseSignatureProps {
  preuves: readonly PreuveSignatureApi[];
  signataires: readonly SignataireSignatureApi[];
}

/**
 * Frise des preuves : « Demande créée », « Invitation envoyée », « Document consulté », « Signé »…
 * Les dates sont celles de l'horloge de la base : pas un horodatage qualifié.
 */
export function FriseSignature({ preuves, signataires }: FriseSignatureProps) {
  const etapes = grouperFrise(preuves, signataires);
  if (etapes.length === 0) {
    return <p className="mp-texte-doux">Aucune preuve enregistrée pour le moment.</p>;
  }
  return (
    <ol className="mp-frise" aria-label="Frise des preuves de la demande">
      {etapes.map((e) => (
        <li
          key={e.rang}
          className={
            e.tonalite === "succes"
              ? "mp-frise__etape mp-frise__etape--succes"
              : e.tonalite === "danger"
                ? "mp-frise__etape mp-frise__etape--danger"
                : "mp-frise__etape"
          }
        >
          <p className="mp-frise__libelle">{e.libelle}</p>
          <p className="mp-frise__detail">
            {[dateHeureCourte(e.horodatage), e.detail].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ol>
  );
}

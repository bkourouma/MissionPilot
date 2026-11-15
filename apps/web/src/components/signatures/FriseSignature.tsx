import type { PreuveSignatureApi, SignataireSignatureApi } from "@missionpilot/shared";
import { dateHeureCourte } from "../../lib/canaux";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function FriseSignature({ preuves, signataires }: FriseSignatureProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const etapes = grouperFrise(preuves, signataires, langue);
  if (etapes.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t("Aucune preuve enregistrée pour le moment.", "No evidence recorded yet.")}
      </p>
    );
  }
  return (
    <ol
      className="mp-frise"
      aria-label={t("Frise des preuves de la demande", "Request evidence timeline")}
    >
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
            {[dateHeureCourte(e.horodatage, langue), e.detail].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ol>
  );
}

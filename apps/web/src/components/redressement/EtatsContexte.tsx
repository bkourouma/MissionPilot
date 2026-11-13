import Link from "next/link";
import { Alerte } from "../ui/Alerte";
import { classesBouton } from "../ui/Bouton";
import { EtatErreur, EtatVide } from "../ui/EtatListe";
import { obtenirT } from "../../lib/i18n/serveur";
import { hrefRedressement } from "../../lib/redressement";
import type { ContexteRed } from "../../lib/redressement-serveur";

/**
 * Rendu des contextes qui n'ont pas de dossier lisible : erreur de chargement (avec « Réessayer »,
 * la navigation reste utilisable) ou mission sans dossier (renvoi vers la synthèse, qui l'ouvre).
 * Retourne `null` quand le dossier est lisible ou que la mission n'est pas lisible (l'en-tête affiche alors l'erreur).
 */
export async function EtatContexteRed({
  contexte,
  missionId,
  hrefReessayer,
}: {
  contexte: ContexteRed;
  missionId: string;
  hrefReessayer: string;
}) {
  const t = await obtenirT();
  if (contexte.etat === "ok") return null;
  if (contexte.etat === "mission_indisponible") return null;
  if (contexte.etat === "erreur") {
    return (
      <EtatErreur
        titre={t(
          "Le dossier de redressement n'a pas pu être chargé.",
          "The turnaround file could not be loaded.",
        )}
        message={contexte.message}
        hrefReessayer={hrefReessayer}
      />
    );
  }
  return (
    <EtatVide
      titre={t(
        "Aucun dossier de redressement pour cette mission.",
        "No turnaround file for this engagement.",
      )}
      icone="attention"
      action={
        <Link href={hrefRedressement(missionId)} className={classesBouton("primaire")}>
          {t("Aller à la synthèse du dossier", "Go to the file summary")}
        </Link>
      }
    >
      <p>
        {t(
          "Le dossier s'ouvre depuis la synthèse ; les autres sections en dépendent.",
          "The file is opened from the summary; the other sections depend on it.",
        )}
      </p>
    </EtatVide>
  );
}

/** Bandeau « Analyses indicatives » : comptes non certifiés ou de fiabilité faible. */
export async function BandeauIndicatif({
  texte,
  hrefFinances,
}: {
  texte: string;
  hrefFinances: string;
}) {
  const t = await obtenirT();
  return (
    <Alerte
      tonalite="attention"
      titre={t("Analyses indicatives", "Indicative analyses")}
      annonce="aucune"
    >
      <p>
        {texte}{" "}
        <Link href={hrefFinances}>
          {t("Consulter les finances du client", "View the client's finances")}
        </Link>
      </p>
    </Alerte>
  );
}

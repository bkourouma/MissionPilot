import Link from "next/link";
import type { BriefApi } from "../../lib/brief";
import {
  CHEMIN_BRIEF,
  DETAIL_BRIEF_VIDE,
  DETAIL_BRIEF_VIDE_EN,
  FAMILLES_AFFICHEES,
  MESSAGE_BRIEF_VIDE,
  MESSAGE_BRIEF_VIDE_EN,
  resumeBrief,
} from "../../lib/brief";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { aujourdhui } from "../../lib/periode";
import { classesBouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { Icone } from "../ui/Icone";
import { CarteFamilleBrief } from "./CarteFamilleBrief";

/**
 * Brief du jour : trois cartes (à décider, ça dérive, prêt à envoyer), ou l'état vide explicite
 * « Rien à signaler » quand le moteur ne trouve rien dans les droits de l'utilisateur.
 */
export async function BriefDuJour({ brief }: { brief: BriefApi }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (brief.vide) {
    return (
      <EtatVide titre={t(MESSAGE_BRIEF_VIDE, MESSAGE_BRIEF_VIDE_EN)} icone="succes">
        <p>{t(DETAIL_BRIEF_VIDE, DETAIL_BRIEF_VIDE_EN)}</p>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            `Brief du ${formaterDate(brief.date_reference)}.`,
            `Brief of ${formaterDate(brief.date_reference, "UTC", langue)}.`,
          )}
        </p>
      </EtatVide>
    );
  }
  // Brief rejoué à une date passée (?date=) : l'ancienneté se lit à cette date, pas à aujourd'hui.
  const rejoue = brief.date_reference !== aujourdhui();
  return (
    <div className="mp-pile mp-pile--large">
      <p className="mp-texte-doux">
        {t(
          `Brief du ${formaterDate(brief.date_reference)} : ${resumeBrief(brief)}.`,
          `Brief of ${formaterDate(brief.date_reference, "UTC", langue)}: ${resumeBrief(brief, langue)}.`,
        )}
      </p>
      {FAMILLES_AFFICHEES.map((f) => (
        <CarteFamilleBrief key={f} famille={f} donnees={brief.familles[f]} rejoue={rejoue} />
      ))}
    </div>
  );
}

/**
 * Carte « Brief du jour » du tableau de bord : le résumé du moteur et un lien vers l'écran
 * complet. N'affiche aucun élément (pas de montant, pas d'intitulé) : c'est l'écran du brief qui
 * les porte.
 */
export async function CarteBriefAccueil({ brief }: { brief: BriefApi }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Carte
      titre={
        <span className="mp-ligne-icone">
          <Icone nom="cloche" />
          <span>{t("Brief du jour", "Today's brief")}</span>
        </span>
      }
      niveauTitre={3}
    >
      <p>{resumeBrief(brief, langue)}</p>
      <p>
        <Link href={CHEMIN_BRIEF} className={classesBouton("primaire")}>
          {t("Ouvrir mon brief", "Open my brief")}
        </Link>
      </p>
    </Carte>
  );
}

/** Carte du tableau de bord quand le brief n'a pas pu être chargé : l'accueil reste utilisable. */
export async function CarteBriefIndisponible({ message }: { message: string }) {
  const t = await obtenirT();
  return (
    <Carte titre={t("Brief du jour", "Today's brief")} niveauTitre={3}>
      <p className="mp-texte-doux">
        {t(`Brief indisponible : ${message}`, `Brief unavailable: ${message}`)}
      </p>
      <p>
        <Link href={CHEMIN_BRIEF}>{t("Ouvrir mon brief", "Open my brief")}</Link>
      </p>
    </Carte>
  );
}

import Link from "next/link";
import type { BriefApi } from "../../lib/brief";
import {
  CHEMIN_BRIEF,
  DETAIL_BRIEF_VIDE,
  FAMILLES_AFFICHEES,
  MESSAGE_BRIEF_VIDE,
  resumeBrief,
} from "../../lib/brief";
import { formaterDate } from "../../lib/format";
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
export function BriefDuJour({ brief }: { brief: BriefApi }) {
  if (brief.vide) {
    return (
      <EtatVide titre={MESSAGE_BRIEF_VIDE} icone="succes">
        <p>{DETAIL_BRIEF_VIDE}</p>
        <p className="mp-texte-doux mp-texte-petit">
          {`Brief du ${formaterDate(brief.date_reference)}.`}
        </p>
      </EtatVide>
    );
  }
  // Brief rejoué à une date passée (?date=) : l'ancienneté se lit à cette date, pas à aujourd'hui.
  const rejoue = brief.date_reference !== aujourdhui();
  return (
    <div className="mp-pile mp-pile--large">
      <p className="mp-texte-doux">
        {`Brief du ${formaterDate(brief.date_reference)} : ${resumeBrief(brief)}.`}
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
export function CarteBriefAccueil({ brief }: { brief: BriefApi }) {
  return (
    <Carte
      titre={
        <span className="mp-ligne-icone">
          <Icone nom="cloche" />
          <span>Brief du jour</span>
        </span>
      }
      niveauTitre={3}
    >
      <p>{resumeBrief(brief)}</p>
      <p>
        <Link href={CHEMIN_BRIEF} className={classesBouton("primaire")}>
          Ouvrir mon brief
        </Link>
      </p>
    </Carte>
  );
}

/** Carte du tableau de bord quand le brief n'a pas pu être chargé : l'accueil reste utilisable. */
export function CarteBriefIndisponible({ message }: { message: string }) {
  return (
    <Carte titre="Brief du jour" niveauTitre={3}>
      <p className="mp-texte-doux">{`Brief indisponible : ${message}`}</p>
      <p>
        <Link href={CHEMIN_BRIEF}>Ouvrir mon brief</Link>
      </p>
    </Carte>
  );
}

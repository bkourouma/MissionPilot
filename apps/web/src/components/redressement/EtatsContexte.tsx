import Link from "next/link";
import { Alerte } from "../ui/Alerte";
import { classesBouton } from "../ui/Bouton";
import { EtatErreur, EtatVide } from "../ui/EtatListe";
import { hrefRedressement } from "../../lib/redressement";
import type { ContexteRed } from "../../lib/redressement-serveur";

/**
 * Rendu des contextes qui n'ont pas de dossier lisible : erreur de chargement (avec « Réessayer »,
 * la navigation reste utilisable) ou mission sans dossier (renvoi vers la synthèse, qui l'ouvre).
 * Retourne `null` quand le dossier est lisible ou que la mission n'est pas lisible (l'en-tête affiche alors l'erreur).
 */
export function EtatContexteRed({
  contexte,
  missionId,
  hrefReessayer,
}: {
  contexte: ContexteRed;
  missionId: string;
  hrefReessayer: string;
}) {
  if (contexte.etat === "ok") return null;
  if (contexte.etat === "mission_indisponible") return null;
  if (contexte.etat === "erreur") {
    return (
      <EtatErreur
        titre="Le dossier de redressement n'a pas pu être chargé."
        message={contexte.message}
        hrefReessayer={hrefReessayer}
      />
    );
  }
  return (
    <EtatVide
      titre="Aucun dossier de redressement pour cette mission."
      icone="attention"
      action={
        <Link href={hrefRedressement(missionId)} className={classesBouton("primaire")}>
          Aller à la synthèse du dossier
        </Link>
      }
    >
      <p>Le dossier s&apos;ouvre depuis la synthèse ; les autres sections en dépendent.</p>
    </EtatVide>
  );
}

/** Bandeau « Analyses indicatives » : comptes non certifiés ou de fiabilité faible. */
export function BandeauIndicatif({ texte, hrefFinances }: { texte: string; hrefFinances: string }) {
  return (
    <Alerte tonalite="attention" titre="Analyses indicatives" annonce="aucune">
      <p>
        {texte} <Link href={hrefFinances}>Consulter les finances du client</Link>
      </p>
    </Alerte>
  );
}

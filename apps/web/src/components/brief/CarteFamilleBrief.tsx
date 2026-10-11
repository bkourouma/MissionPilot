import Link from "next/link";
import type { ElementBriefApi, FamilleBriefApi, FamilleComposeeBriefApi } from "../../lib/brief";
import {
  libelleAnciennete,
  libelleGravite,
  libelleMontant,
  libelleNombre,
  lienInterne,
  noteTroncature,
  PRESENTATION_FAMILLE,
  TONALITE_GRAVITE,
} from "../../lib/brief";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Icone } from "../ui/Icone";

/**
 * Une ligne du brief : libellé (lien vers l'écran concerné), mission liée, ancienneté et, avec
 * `finance.lire` seulement, le montant servi par l'API ; la gravité vient du moteur.
 */
export function LigneBrief({ element }: { element: ElementBriefApi }) {
  const lien = lienInterne(element.lien);
  const montant = libelleMontant(element);
  const details = [
    element.mission_libelle,
    libelleAnciennete(element.anciennete_jours),
    montant ? `Montant : ${montant}` : null,
  ].filter((d): d is string => Boolean(d));
  return (
    <li className="mp-alertes-derive__ligne">
      <div className="mp-alertes-derive__texte">
        {lien ? (
          <Link href={lien} className="mp-alertes-derive__lien">
            {element.libelle}
          </Link>
        ) : (
          <span className="mp-alertes-derive__lien">{element.libelle}</span>
        )}
        <span className="mp-texte-doux mp-texte-petit">{details.join(" · ")}</span>
      </div>
      <BadgeStatut tonalite={TONALITE_GRAVITE[element.gravite]}>
        {libelleGravite(element.gravite)}
      </BadgeStatut>
    </li>
  );
}

/**
 * Carte d'une famille du brief (« À décider », « Ça dérive », « Prêt à envoyer »). Propriétés
 * sérialisables seulement : la page serveur ne passe aucune fonction.
 */
export function CarteFamilleBrief({
  famille,
  donnees,
}: {
  famille: FamilleBriefApi;
  donnees: FamilleComposeeBriefApi;
}) {
  const p = PRESENTATION_FAMILLE[famille];
  const note = noteTroncature(donnees);
  return (
    <Carte
      niveauTitre={2}
      titre={
        <span className="mp-ligne-icone">
          <Icone nom={p.icone} />
          <span>{p.titre}</span>
        </span>
      }
      actions={
        <BadgeStatut tonalite={donnees.total > 0 ? "attention" : "succes"} sansIcone>
          {libelleNombre(donnees.total)}
        </BadgeStatut>
      }
    >
      <p className="mp-texte-doux mp-texte-petit">{p.description}</p>
      {donnees.elements.length === 0 ? (
        <p className="mp-texte-succes mp-ligne-icone">
          <Icone nom="succes" taille={18} />
          <span>{p.vide}</span>
        </p>
      ) : (
        <ul className="mp-alertes-derive">
          {donnees.elements.map((e) => (
            <LigneBrief key={`${e.type}:${e.entite_id}`} element={e} />
          ))}
        </ul>
      )}
      {note ? <p className="mp-texte-doux mp-texte-petit">{note}</p> : null}
    </Carte>
  );
}

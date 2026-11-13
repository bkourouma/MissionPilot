import Link from "next/link";
import type { ElementBriefApi, FamilleBriefApi, FamilleComposeeBriefApi } from "../../lib/brief";
import {
  libelleAnciennete,
  libelleGravite,
  libelleMotifs,
  libelleElementBrief,
  libelleMontant,
  libelleNombre,
  lienInterne,
  noteTroncature,
  presentationFamille,
  TONALITE_GRAVITE,
} from "../../lib/brief";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Icone } from "../ui/Icone";

/**
 * Une ligne du brief : libellé (lien vers l'écran concerné), mission liée, ancienneté et, avec
 * `finance.lire` seulement, le montant servi par l'API ; la gravité vient du moteur.
 */
export async function LigneBrief({
  element,
  rejoue = false,
}: {
  element: ElementBriefApi;
  rejoue?: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const lien = lienInterne(element.lien);
  const montant = libelleMontant(element, langue);
  const motifs = libelleMotifs(element);
  const details = [
    element.mission_libelle,
    libelleAnciennete(element.anciennete_jours, rejoue, langue),
    montant ? `${t("Montant :", "Amount:")} ${montant}` : null,
  ].filter((d): d is string => Boolean(d));
  return (
    <li className="mp-alertes-derive__ligne">
      <div className="mp-alertes-derive__texte">
        {lien ? (
          <Link href={lien} className="mp-alertes-derive__lien">
            {libelleElementBrief(element, langue)}
          </Link>
        ) : (
          <span className="mp-alertes-derive__lien">{libelleElementBrief(element, langue)}</span>
        )}
        <span className="mp-texte-doux mp-texte-petit">{details.join(" · ")}</span>
        {motifs ? <span className="mp-texte-doux mp-texte-petit">{motifs}</span> : null}
      </div>
      <BadgeStatut tonalite={TONALITE_GRAVITE[element.gravite]}>
        {libelleGravite(element.gravite, langue)}
      </BadgeStatut>
    </li>
  );
}

/**
 * Carte d'une famille du brief (« À décider », « Ça dérive », « Prêt à envoyer »). Propriétés
 * sérialisables seulement : la page serveur ne passe aucune fonction.
 */
export async function CarteFamilleBrief({
  famille,
  donnees,
  rejoue = false,
}: {
  famille: FamilleBriefApi;
  donnees: FamilleComposeeBriefApi;
  rejoue?: boolean;
}) {
  const langue = await obtenirLangue();
  const p = presentationFamille(famille, langue);
  const note = noteTroncature(donnees, langue);
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
          {libelleNombre(donnees.total, langue)}
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
            <LigneBrief key={`${e.type}:${e.entite_id}`} element={e} rejoue={rejoue} />
          ))}
        </ul>
      )}
      {note ? <p className="mp-texte-doux mp-texte-petit">{note}</p> : null}
    </Carte>
  );
}

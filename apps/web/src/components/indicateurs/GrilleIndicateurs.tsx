import Link from "next/link";
import {
  MESSAGE_RESERVE,
  formaterEcartJours,
  type AlerteDerive,
  type IndicateurAffiche,
} from "../../lib/indicateurs";
import { formaterJours } from "../../lib/format";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Icone } from "../ui/Icone";

/**
 * Un indicateur : libellé, définition (PRD), valeur servie par l'API, statut (couleur, icône et
 * texte). Un indicateur financier absent de la réponse affiche un message neutre, sans valeur.
 */
export function CarteIndicateur({ indicateur: i }: { indicateur: IndicateurAffiche }) {
  const d = i.definition;
  const idTitre = `indicateur-${d.id}`;
  return (
    <article className="mp-indicateur" aria-labelledby={idTitre}>
      <h3 id={idTitre} className="mp-indicateur__titre">
        {d.libelle}
      </h3>
      <p className="mp-indicateur__definition">{d.definition}</p>
      {i.present ? (
        <>
          <p className="mp-indicateur__valeur">{i.valeur}</p>
          {i.statut ? (
            <p>
              <BadgeStatut tonalite={i.statut.tonalite}>{i.statut.libelle}</BadgeStatut>
            </p>
          ) : null}
          {i.detail ? <p className="mp-indicateur__detail">{i.detail}</p> : null}
        </>
      ) : (
        <p className="mp-indicateur__reserve">
          <Icone nom="cadenas" taille={16} />
          <span>{MESSAGE_RESERVE}</span>
        </p>
      )}
      <p className="mp-indicateur__meta">{`Lecture : ${d.niveaux} · ${d.frequence}`}</p>
    </article>
  );
}

export function GrilleIndicateurs({ indicateurs }: { indicateurs: readonly IndicateurAffiche[] }) {
  return (
    <ul className="mp-grille-indicateurs">
      {indicateurs.map((i) => (
        <li key={i.definition.id}>
          <CarteIndicateur indicateur={i} />
        </li>
      ))}
    </ul>
  );
}

/** Alertes du parcours C : missions dont l'atterrissage dépasse le budget. */
export function ListeAlertesDerive({
  alertes,
  limite,
}: {
  alertes: readonly AlerteDerive[];
  limite?: number;
}) {
  const affichees = limite ? alertes.slice(0, limite) : alertes;
  if (alertes.length === 0) {
    return (
      <p className="mp-texte-succes mp-ligne-icone">
        <Icone nom="succes" taille={18} />
        <span>Aucune mission ne dépasse son budget à l&apos;atterrissage.</span>
      </p>
    );
  }
  return (
    <ul className="mp-alertes-derive">
      {affichees.map((a) => (
        <li key={a.mission_id} className="mp-alertes-derive__ligne">
          <div className="mp-alertes-derive__texte">
            <Link href={`/missions/${a.mission_id}/suivi`} className="mp-alertes-derive__lien">
              {a.intitule}
            </Link>
            <span className="mp-texte-doux mp-texte-petit">
              {`Atterrissage ${formaterJours(a.jours_atterrissage)} pour ${formaterJours(a.jours_budget)} budgétés · écart ${formaterEcartJours(a.ecart_jours, a.ecart_relatif)}`}
            </span>
          </div>
          <BadgeStatut tonalite={a.statut.tonalite}>{a.statut.libelle}</BadgeStatut>
        </li>
      ))}
      {limite && alertes.length > limite ? (
        <li>
          <Link href="/indicateurs#alertes">{`Voir les ${alertes.length} missions en dérive`}</Link>
        </li>
      ) : null}
    </ul>
  );
}

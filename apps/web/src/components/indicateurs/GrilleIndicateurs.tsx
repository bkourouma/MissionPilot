import Link from "next/link";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import {
  messageReserve,
  formaterEcartJours,
  type AlerteDerive,
  type IndicateurAffiche,
} from "../../lib/indicateurs";
import { formaterJours } from "../../lib/format";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Icone } from "../ui/Icone";
import "./tableau-de-bord.css";

/**
 * Un indicateur : libellé, définition (PRD), valeur servie par l'API, statut (couleur, icône et
 * texte). Un indicateur financier absent de la réponse affiche un message neutre, sans valeur.
 */
export function CarteIndicateur({
  indicateur: i,
  langue = "fr",
}: {
  indicateur: IndicateurAffiche;
  langue?: Langue;
}) {
  const t = creerTraduire(langue);
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
          <span>{messageReserve(langue)}</span>
        </p>
      )}
      <p className="mp-indicateur__meta">{`${t("Lecture", "Level")} : ${d.niveaux} · ${d.frequence}`}</p>
    </article>
  );
}

export function GrilleIndicateurs({
  indicateurs,
  langue = "fr",
}: {
  indicateurs: readonly IndicateurAffiche[];
  langue?: Langue;
}) {
  return (
    <ul
      className="mp-grille-indicateurs"
      aria-label={langue === "en" ? "Indicators" : "Indicateurs"}
    >
      {indicateurs.map((i) => (
        <li key={i.definition.id}>
          <CarteIndicateur indicateur={i} langue={langue} />
        </li>
      ))}
    </ul>
  );
}

/** Alertes du parcours C : missions dont l'atterrissage dépasse le budget. */
export function ListeAlertesDerive({
  alertes,
  limite,
  langue = "fr",
}: {
  alertes: readonly AlerteDerive[];
  limite?: number;
  langue?: Langue;
}) {
  const t = creerTraduire(langue);
  const affichees = limite ? alertes.slice(0, limite) : alertes;
  if (alertes.length === 0) {
    return (
      <p className="mp-texte-succes mp-ligne-icone" role="status">
        <Icone nom="succes" taille={18} />
        <span>
          {t(
            "Aucune mission ne dépasse son budget à l'atterrissage.",
            "No engagement exceeds its budget at landing.",
          )}
        </span>
      </p>
    );
  }
  return (
    <ul className="mp-alertes-derive" aria-label={t("Missions en dérive", "Engagements drifting")}>
      {affichees.map((a) => (
        <li key={a.mission_id} className="mp-alertes-derive__ligne">
          <div className="mp-alertes-derive__texte">
            <Link href={`/missions/${a.mission_id}/suivi`} className="mp-alertes-derive__lien">
              {a.intitule}
            </Link>
            <span className="mp-texte-doux mp-texte-petit">
              {t(
                `Atterrissage ${formaterJours(a.jours_atterrissage, langue)} pour ${formaterJours(a.jours_budget, langue)} budgétés · écart ${formaterEcartJours(a.ecart_jours, a.ecart_relatif, langue)}`,
                `Landing ${formaterJours(a.jours_atterrissage, langue)} for ${formaterJours(a.jours_budget, langue)} budgeted · variance ${formaterEcartJours(a.ecart_jours, a.ecart_relatif, langue)}`,
              )}
            </span>
          </div>
          <BadgeStatut tonalite={a.statut.tonalite}>{a.statut.libelle}</BadgeStatut>
        </li>
      ))}
      {limite && alertes.length > limite ? (
        <li>
          <Link href="/indicateurs#alertes">
            {t(
              `Voir les ${alertes.length} missions en dérive`,
              `See the ${alertes.length} engagements drifting`,
            )}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

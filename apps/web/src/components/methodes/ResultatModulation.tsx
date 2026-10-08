import { decrireEffet, type Differentiel, type ResultatModulation } from "../../lib/methodes";
import { BadgeStatut } from "../ui/BadgeStatut";

/** Différentiel de deux applications des règles (simulation, migration) : effets et règles. */
export function VueDifferentiel({ d }: { d: Differentiel }) {
  if (d.identique) {
    return <p>Aucune différence : les deux contextes donnent la même méthode.</p>;
  }
  return (
    <div className="mp-pile">
      {d.regles_declenchees.length > 0 ? (
        <p>
          <strong>Règles qui se déclenchent :</strong> {d.regles_declenchees.join(", ")}
        </p>
      ) : null}
      {d.regles_eteintes.length > 0 ? (
        <p>
          <strong>Règles qui ne se déclenchent plus :</strong> {d.regles_eteintes.join(", ")}
        </p>
      ) : null}
      <ul className="mp-liste-simple">
        {d.ajoutes.map((e) => (
          <li key={`a-${e.cle}`}>
            <BadgeStatut tonalite="succes">Ajouté</BadgeStatut> {decrireEffet(e.effet)}
          </li>
        ))}
        {d.retires.map((e) => (
          <li key={`r-${e.cle}`}>
            <BadgeStatut tonalite="danger">Retiré</BadgeStatut> {decrireEffet(e.effet)}
          </li>
        ))}
        {d.modifies.map((m) => (
          <li key={`m-${m.cle}`}>
            <BadgeStatut tonalite="attention">Modifié</BadgeStatut> {decrireEffet(m.avant.effet)} →{" "}
            {decrireEffet(m.apres.effet)}
          </li>
        ))}
      </ul>
      {d.variation_conflits_non_resolus !== 0 ? (
        <p>
          Conflits non résolus : {d.variation_conflits_non_resolus > 0 ? "+" : ""}
          {d.variation_conflits_non_resolus}
        </p>
      ) : null}
    </div>
  );
}

/** Journal d'application : règle par règle, déclenchée ou non, valeurs lues. */
export function JournalModulation({ r }: { r: ResultatModulation }) {
  if (r.journal.length === 0) return <p>Aucune règle de modulation dans cette méthode.</p>;
  return (
    <ul className="mp-liste-simple">
      {r.journal.map((j) => (
        <li key={j.regle}>
          <strong>{j.regle}</strong> —{" "}
          {!j.active ? "désactivée" : j.declenchee ? "déclenchée" : "non déclenchée"}
          {j.declenchee
            ? ` (${j.effets_retenus} effet(s) retenu(s), ${j.effets_ecartes} écarté(s))`
            : ""}
          {j.verifications.length > 0 ? (
            <span className="mp-texte-doux mp-texte-petit">
              {" "}
              · lu :{" "}
              {j.verifications
                .map(
                  (v) =>
                    `${v.facteur ?? "brique"} = ${v.lu === null ? "non renseigné" : JSON.stringify(v.lu)}`,
                )
                .join(" ; ")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

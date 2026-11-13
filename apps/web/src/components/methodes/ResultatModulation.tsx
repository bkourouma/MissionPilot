import { creerTraduire, type Langue } from "@missionpilot/shared";
import { decrireEffet, type Differentiel, type ResultatModulation } from "../../lib/methodes";
import { creerLibelles, type LibellesApercu } from "../../lib/methodes-apercu";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Rendu partagé entre pages serveur et composants clients : la langue arrive par la propriété
 * facultative `langue` (défaut « fr »), jamais par un hook.
 */

/** Différentiel de deux applications des règles (simulation, migration) : effets et règles. */
export function VueDifferentiel({ d, langue = "fr" }: { d: Differentiel; langue?: Langue }) {
  const t = creerTraduire(langue);
  if (d.identique) {
    return (
      <p>
        {t(
          "Aucune différence : les deux contextes donnent la même méthode.",
          "No difference: both contexts give the same method.",
        )}
      </p>
    );
  }
  return (
    <div className="mp-pile">
      {d.regles_declenchees.length > 0 ? (
        <p>
          <strong>{t("Règles qui se déclenchent :", "Rules that trigger:")}</strong>{" "}
          {d.regles_declenchees.join(", ")}
        </p>
      ) : null}
      {d.regles_eteintes.length > 0 ? (
        <p>
          <strong>
            {t("Règles qui ne se déclenchent plus :", "Rules that no longer trigger:")}
          </strong>{" "}
          {d.regles_eteintes.join(", ")}
        </p>
      ) : null}
      <ul className="mp-liste-simple">
        {d.ajoutes.map((e) => (
          <li key={`a-${e.cle}`}>
            <BadgeStatut tonalite="succes">{t("Ajouté", "Added")}</BadgeStatut>{" "}
            {decrireEffet(e.effet, langue)}
          </li>
        ))}
        {d.retires.map((e) => (
          <li key={`r-${e.cle}`}>
            <BadgeStatut tonalite="danger">{t("Retiré", "Removed")}</BadgeStatut>{" "}
            {decrireEffet(e.effet, langue)}
          </li>
        ))}
        {d.modifies.map((m) => (
          <li key={`m-${m.cle}`}>
            <BadgeStatut tonalite="attention">{t("Modifié", "Modified")}</BadgeStatut>{" "}
            {decrireEffet(m.avant.effet, langue)} → {decrireEffet(m.apres.effet, langue)}
          </li>
        ))}
      </ul>
      {d.variation_conflits_non_resolus !== 0 ? (
        <p>
          {t("Conflits non résolus : ", "Unresolved conflicts: ")}
          {d.variation_conflits_non_resolus > 0 ? "+" : ""}
          {d.variation_conflits_non_resolus}
        </p>
      ) : null}
    </div>
  );
}

/** Journal d'application : règle par règle, déclenchée ou non, valeurs lues. */
export function JournalModulation({
  r,
  libelles,
  langue = "fr",
}: {
  r: Pick<ResultatModulation, "journal">;
  libelles?: LibellesApercu;
  langue?: Langue;
}) {
  const t = creerTraduire(langue);
  const lib = libelles ?? creerLibelles(undefined, langue);
  if (r.journal.length === 0) {
    return (
      <p>
        {t("Aucune règle de modulation dans cette méthode.", "No modulation rule in this method.")}
      </p>
    );
  }
  return (
    <ul className="mp-liste-simple">
      {r.journal.map((j) => (
        <li key={j.regle}>
          <strong>{lib.regle(j.regle)}</strong> —{" "}
          {!j.active
            ? t("désactivée", "disabled")
            : j.declenchee
              ? t("déclenchée", "triggered")
              : t("non déclenchée", "not triggered")}
          {j.declenchee
            ? ` (${t(
                `${j.effets_retenus} effet(s) retenu(s), ${j.effets_ecartes} écarté(s)`,
                `${j.effets_retenus} effect(s) kept, ${j.effets_ecartes} discarded`,
              )})`
            : ""}
          {j.verifications.length > 0 ? (
            <span className="mp-texte-doux mp-texte-petit">
              {" "}
              · {t("lu :", "read:")}{" "}
              {j.verifications
                .map(
                  (v) =>
                    `${v.facteur ? lib.facteur(v.facteur) : t("Brique", "Building block")}${t(" : ", ": ")}${lib.valeur(v.facteur, v.lu)}`,
                )
                .join(t(" ; ", "; "))}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

"use client";

import type { Devise } from "../../lib/format";
import { formaterMontantMineur } from "../../lib/format";
import {
  formaterBp,
  libelleParametre,
  type CouvertureSources,
  type Fourchette,
  type Recoupement,
  type ResultatDimensionnement,
  type SensibiliteParametre,
} from "../../lib/due-diligence";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";

const ETAGES: Record<string, string> = {
  marche_total: "Marché total",
  marche_adressable: "Marché adressable",
  marche_capturable: "Marché capturable",
  marche_atteignable: "Marché atteignable",
};
const ETAGES_EN: Record<string, string> = {
  marche_total: "Total market",
  marche_adressable: "Addressable market",
  marche_capturable: "Capturable market",
  marche_atteignable: "Attainable market",
};

/** Fourchette bas / base / haut, en devise du dossier (montants déjà calculés par le moteur). */
export function FourchetteMarche({
  fourchette,
  devise,
  titre,
}: {
  fourchette: Fourchette;
  devise: Devise;
  titre: string;
}) {
  const t = useT();
  const langue = useLangue();
  return (
    <dl className="mp-fourchette" aria-label={titre}>
      <div>
        <dt>{t("Bas", "Low")}</dt>
        <dd>{formaterMontantMineur(fourchette.bas, devise, langue)}</dd>
      </div>
      <div>
        <dt>{t("Central", "Base")}</dt>
        <dd>{formaterMontantMineur(fourchette.base, devise, langue)}</dd>
      </div>
      <div>
        <dt>{t("Haut", "High")}</dt>
        <dd>{formaterMontantMineur(fourchette.haut, devise, langue)}</dd>
      </div>
    </dl>
  );
}

/**
 * Sensibilité : un `<meter>` par paramètre, de 0 à 10 000 points de base (part de l'amplitude du
 * paramètre le plus influent). La valeur vient du moteur : aucune division n'est faite ici.
 */
export function TornadoSensibilite({
  sensibilite,
  devise,
}: {
  sensibilite: SensibiliteParametre[];
  devise: Devise;
}) {
  const t = useT();
  const langue = useLangue();
  if (sensibilite.length === 0) return null;
  return (
    <ul
      className="mp-tornado"
      aria-label={t(
        "Sensibilité du résultat à chaque paramètre",
        "Sensitivity of the result to each parameter",
      )}
    >
      {sensibilite.map((p) => {
        const nom = libelleParametre(p.code, langue);
        return (
          <li key={p.code} className="mp-tornado__ligne">
            <span>{nom}</span>
            <meter
              min={0}
              max={10_000}
              value={p.part_amplitude_bp}
              aria-label={t(`Influence de ${nom}`, `Influence of ${nom}`)}
              aria-valuetext={t(
                `${formaterBp(p.part_amplitude_bp)} de l'influence maximale`,
                `${formaterBp(p.part_amplitude_bp, langue)} of the maximum influence`,
              )}
            >
              {formaterBp(p.part_amplitude_bp, langue)}
            </meter>
            <span className="mp-tornado__valeur">
              {t(
                `${formaterMontantMineur(p.resultat_bas, devise)} à ${formaterMontantMineur(p.resultat_haut, devise)}`,
                `${formaterMontantMineur(p.resultat_bas, devise, langue)} to ${formaterMontantMineur(p.resultat_haut, devise, langue)}`,
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Couverture des sources : les paramètres sans source sont signalés en texte. */
export function CouvertureMarche({ couverture }: { couverture: CouvertureSources }) {
  const t = useT();
  const langue = useLangue();
  const absents = couverture.absente ?? [];
  return (
    <div className="mp-dd-pile">
      <p className="mp-texte-petit">
        {t(
          `Sources : ${couverture.preuve} paramètre(s) sourcé(s) par une preuve, ${couverture.avis_expert} par un avis d'expert, sur ${couverture.total}.`,
          `Sources: ${couverture.preuve} parameter(s) sourced from evidence, ${couverture.avis_expert} from an expert opinion, out of ${couverture.total}.`,
        )}
      </p>
      {absents.length > 0 ? (
        <Alerte
          tonalite="attention"
          titre={t("Paramètres sans source", "Parameters without source")}
          annonce="aucune"
        >
          <p>{absents.map((code) => libelleParametre(code, langue)).join(", ")}</p>
        </Alerte>
      ) : null}
    </div>
  );
}

/** Étages, fourchette finale, ajustements d'expert, sensibilité et couverture : sortie du moteur. */
export function ResultatMarche({
  resultat,
  devise,
}: {
  resultat: ResultatDimensionnement;
  devise: Devise;
}) {
  const t = useT();
  const langue = useLangue();
  const etages = langue === "en" ? ETAGES_EN : ETAGES;
  const etageDefaut = t("Étage", "Tier");
  return (
    <div className="mp-dd-pile">
      {resultat.etages.length > 1 ? (
        <div className="mp-dd-pile">
          {resultat.etages.map((e) => (
            <div key={e.code} className="mp-dd-pile">
              <p className="mp-dd-element__titre">{etages[e.code] ?? etageDefaut}</p>
              <FourchetteMarche
                fourchette={e.valeurs}
                devise={devise}
                titre={etages[e.code] ?? etageDefaut}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="mp-dd-pile">
        <p className="mp-dd-element__titre">
          {resultat.ajuste
            ? t("Résultat après ajustements d'expert", "Result after expert adjustments")
            : t("Résultat", "Result")}
        </p>
        <FourchetteMarche
          fourchette={resultat.resultat}
          devise={devise}
          titre={t("Résultat du dimensionnement", "Sizing result")}
        />
        {resultat.ajuste ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `Avant ajustement : ${formaterMontantMineur(resultat.avant_ajustement.bas, devise)} à ${formaterMontantMineur(resultat.avant_ajustement.haut, devise)}.`,
              `Before adjustment: ${formaterMontantMineur(resultat.avant_ajustement.bas, devise, langue)} to ${formaterMontantMineur(resultat.avant_ajustement.haut, devise, langue)}.`,
            )}
          </p>
        ) : null}
      </div>
      {resultat.ajustements_appliques.length > 0 ? (
        <ul
          className="mp-liste-simple"
          aria-label={t("Ajustements d'expert appliqués", "Expert adjustments applied")}
        >
          {resultat.ajustements_appliques.map((a) => (
            <li key={a.libelle}>
              {t(
                `${a.libelle} : facteur ${formaterBp(a.facteur_bp)}`,
                `${a.libelle}: factor ${formaterBp(a.facteur_bp, langue)}`,
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mp-dd-pile">
        <p className="mp-dd-element__titre">{t("Sensibilité", "Sensitivity")}</p>
        <TornadoSensibilite sensibilite={resultat.sensibilite} devise={devise} />
      </div>
      <CouvertureMarche couverture={resultat.couverture} />
    </div>
  );
}

/** Recoupement descendant / ascendant : écart relatif, alerte et chevauchement des fourchettes. */
export function RecoupementMarche({ recoupement }: { recoupement: Recoupement }) {
  const t = useT();
  const langue = useLangue();
  const plusEleve =
    recoupement.plus_eleve === "egal"
      ? t(
          "Les deux méthodes donnent le même résultat central.",
          "Both methods give the same central result.",
        )
      : t(
          `Le résultat central le plus élevé vient de la méthode ${recoupement.plus_eleve === "descendant" ? "descendante" : "ascendante"}.`,
          `The higher central result comes from the ${recoupement.plus_eleve === "descendant" ? "top-down" : "bottom-up"} method.`,
        );
  return (
    <div className="mp-dd-pile">
      <span className="mp-dd-meta">
        <BadgeStatut tonalite={recoupement.alerte ? "attention" : "succes"}>
          {recoupement.alerte
            ? t("Écart important entre les deux méthodes", "Large gap between the two methods")
            : t("Méthodes cohérentes", "Consistent methods")}
        </BadgeStatut>
        <BadgeStatut tonalite={recoupement.chevauchement ? "succes" : "attention"}>
          {recoupement.chevauchement
            ? t("Les fourchettes se recoupent", "The ranges overlap")
            : t("Les fourchettes ne se recoupent pas", "The ranges do not overlap")}
        </BadgeStatut>
      </span>
      <p>
        {t(
          `Écart relatif des résultats centraux : ${formaterBp(recoupement.ecart_bp)}. ${plusEleve}`,
          `Relative gap between the central results: ${formaterBp(recoupement.ecart_bp, langue)}. ${plusEleve}`,
        )}
      </p>
    </div>
  );
}

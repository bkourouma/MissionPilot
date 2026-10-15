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
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";

const ETAGES: Record<string, string> = {
  marche_total: "Marché total",
  marche_adressable: "Marché adressable",
  marche_capturable: "Marché capturable",
  marche_atteignable: "Marché atteignable",
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
  return (
    <dl className="mp-fourchette" aria-label={titre}>
      <div>
        <dt>Bas</dt>
        <dd>{formaterMontantMineur(fourchette.bas, devise)}</dd>
      </div>
      <div>
        <dt>Central</dt>
        <dd>{formaterMontantMineur(fourchette.base, devise)}</dd>
      </div>
      <div>
        <dt>Haut</dt>
        <dd>{formaterMontantMineur(fourchette.haut, devise)}</dd>
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
  if (sensibilite.length === 0) return null;
  return (
    <ul className="mp-tornado" aria-label="Sensibilité du résultat à chaque paramètre">
      {sensibilite.map((p) => {
        const nom = libelleParametre(p.code);
        return (
          <li key={p.code} className="mp-tornado__ligne">
            <span>{nom}</span>
            <meter
              min={0}
              max={10_000}
              value={p.part_amplitude_bp}
              aria-label={`Influence de ${nom}`}
              aria-valuetext={`${formaterBp(p.part_amplitude_bp)} de l'influence maximale`}
            >
              {formaterBp(p.part_amplitude_bp)}
            </meter>
            <span className="mp-tornado__valeur">
              {`${formaterMontantMineur(p.resultat_bas, devise)} à ${formaterMontantMineur(p.resultat_haut, devise)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Couverture des sources : les paramètres sans source sont signalés en texte. */
export function CouvertureMarche({ couverture }: { couverture: CouvertureSources }) {
  const absents = couverture.absente ?? [];
  return (
    <div className="mp-dd-pile">
      <p className="mp-texte-petit">
        {`Sources : ${couverture.preuve} paramètre(s) sourcé(s) par une preuve, ${couverture.avis_expert} par un avis d'expert, sur ${couverture.total}.`}
      </p>
      {absents.length > 0 ? (
        <Alerte tonalite="attention" titre="Paramètres sans source" annonce="aucune">
          <p>{absents.map(libelleParametre).join(", ")}</p>
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
  return (
    <div className="mp-dd-pile">
      {resultat.etages.length > 1 ? (
        <div className="mp-dd-pile">
          {resultat.etages.map((e) => (
            <div key={e.code} className="mp-dd-pile">
              <p className="mp-dd-element__titre">{ETAGES[e.code] ?? "Étage"}</p>
              <FourchetteMarche
                fourchette={e.valeurs}
                devise={devise}
                titre={ETAGES[e.code] ?? "Étage"}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="mp-dd-pile">
        <p className="mp-dd-element__titre">
          {resultat.ajuste ? "Résultat après ajustements d'expert" : "Résultat"}
        </p>
        <FourchetteMarche
          fourchette={resultat.resultat}
          devise={devise}
          titre="Résultat du dimensionnement"
        />
        {resultat.ajuste ? (
          <p className="mp-texte-doux mp-texte-petit">
            {`Avant ajustement : ${formaterMontantMineur(resultat.avant_ajustement.bas, devise)} à ${formaterMontantMineur(resultat.avant_ajustement.haut, devise)}.`}
          </p>
        ) : null}
      </div>
      {resultat.ajustements_appliques.length > 0 ? (
        <ul className="mp-liste-simple" aria-label="Ajustements d'expert appliqués">
          {resultat.ajustements_appliques.map((a) => (
            <li key={a.libelle}>{`${a.libelle} : facteur ${formaterBp(a.facteur_bp)}`}</li>
          ))}
        </ul>
      ) : null}
      <div className="mp-dd-pile">
        <p className="mp-dd-element__titre">Sensibilité</p>
        <TornadoSensibilite sensibilite={resultat.sensibilite} devise={devise} />
      </div>
      <CouvertureMarche couverture={resultat.couverture} />
    </div>
  );
}

/** Recoupement descendant / ascendant : écart relatif, alerte et chevauchement des fourchettes. */
export function RecoupementMarche({ recoupement }: { recoupement: Recoupement }) {
  const plusEleve =
    recoupement.plus_eleve === "egal"
      ? "Les deux méthodes donnent le même résultat central."
      : `Le résultat central le plus élevé vient de la méthode ${recoupement.plus_eleve === "descendant" ? "descendante" : "ascendante"}.`;
  return (
    <div className="mp-dd-pile">
      <span className="mp-dd-meta">
        <BadgeStatut tonalite={recoupement.alerte ? "attention" : "succes"}>
          {recoupement.alerte ? "Écart important entre les deux méthodes" : "Méthodes cohérentes"}
        </BadgeStatut>
        <BadgeStatut tonalite={recoupement.chevauchement ? "succes" : "attention"}>
          {recoupement.chevauchement
            ? "Les fourchettes se recoupent"
            : "Les fourchettes ne se recoupent pas"}
        </BadgeStatut>
      </span>
      <p>{`Écart relatif des résultats centraux : ${formaterBp(recoupement.ecart_bp)}. ${plusEleve}`}</p>
    </div>
  );
}

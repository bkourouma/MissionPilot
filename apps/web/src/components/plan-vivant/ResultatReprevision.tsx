import { formaterDateHeure, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  compterSignificatifs,
  formaterSeuil,
  LIBELLE_TRIMESTRE,
  libelleMethode,
  lignesAnnuelles,
  lignesCumul,
  lignesTrimestre,
  MENTION_PROJECTION_SIMPLIFIEE,
  montantOuNonSaisi,
  phraseEcartEbe,
  titreCumul,
  formaterEcart,
  type LigneEcart,
  type Reprevision,
} from "../../lib/plan-vivant";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/** Colonnes communes des tableaux d'écarts : le marqueur « Significatif » est un texte, jamais seulement une couleur. */
const COLONNES: readonly ColonneTableau<LigneEcart>[] = [
  { cle: "mesure", entete: "Mesure" },
  { cle: "prevu", entete: "Plan", alignement: "droite" },
  { cle: "reel", entete: "Réel", alignement: "droite" },
  { cle: "ecart", entete: "Écart", alignement: "droite" },
  { cle: "ecartRelatif", entete: "Écart relatif", alignement: "droite" },
  {
    cle: "marqueur",
    entete: "Seuil",
    rendu: (l) =>
      l.significatif ? (
        <BadgeStatut tonalite="attention">{l.marqueur}</BadgeStatut>
      ) : (
        <span>{l.marqueur}</span>
      ),
  },
];

/**
 * Résultat d'une re-prévision enregistrée (PLA-18) : tous les chiffres sont ceux du moteur, tels que
 * figés à l'enregistrement. Le plan validé n'est pas modifié ; la trésorerie de clôture est une
 * projection simplifiée.
 */
export function ResultatReprevision({
  reprevision,
  devise,
}: {
  reprevision: Reprevision;
  devise: Devise;
}) {
  const r = reprevision.resultat;
  const m = (v: number | null) => montantOuNonSaisi(v, devise);
  const annuelles = lignesAnnuelles(r.ecartsAnnuels, devise);
  const nbSignificatifs = compterSignificatifs(annuelles);

  return (
    <div className="mp-pv">
      <p>
        Re-prévision {reprevision.version} de l&apos;exercice {reprevision.exercice}, calculée le{" "}
        {formaterDateHeure(reprevision.cree_le)} par {reprevision.auteur_nom} sur la version{" "}
        {reprevision.modele_version} du modèle (validée) et {reprevision.dernier_trimestre}{" "}
        trimestre(s) réalisé(s). Méthode : {libelleMethode(reprevision.methode).toLowerCase()} ;
        seuil d&apos;un écart significatif : {formaterSeuil(reprevision.seuil_pour_mille)}.
      </p>

      <h4 className="mp-pv__intertitre">Re-prévision annuelle comparée au plan</h4>
      <dl className="mp-pv__resume">
        <div className="mp-pv__chiffre">
          <dt>Chiffre d&apos;affaires re-prévu</dt>
          <dd>{m(r.reprevision.chiffreAffaires)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>EBE re-prévu</dt>
          <dd>{m(r.reprevision.excedentBrutExploitation)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>Résultat net re-prévu</dt>
          <dd>{m(r.reprevision.resultatNet)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>Trésorerie de clôture re-prévue (projection simplifiée)</dt>
          <dd>{m(r.reprevision.tresorerieCloture)}</dd>
        </div>
      </dl>
      <p className="mp-texte-doux">{MENTION_PROJECTION_SIMPLIFIEE}</p>
      <Tableau
        legende="Exercice : re-prévision annuelle comparée au plan"
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={annuelles}
        colonnes={COLONNES}
      />
      <p className="mp-visuellement-cache" role="status">
        {nbSignificatifs === 0
          ? "Aucun écart annuel significatif."
          : `${nbSignificatifs} écart(s) annuel(s) significatif(s).`}
      </p>

      <h4 className="mp-pv__intertitre">Écarts par trimestre</h4>
      {r.ecartsTrimestres.map((e) => (
        <Tableau
          key={e.trimestre}
          legende={`${LIBELLE_TRIMESTRE(e.trimestre)} : plan et réel`}
          legendeVisible
          cleLigne={(l) => l.cle}
          lignes={lignesTrimestre(e, devise)}
          colonnes={COLONNES}
        />
      ))}

      <h4 className="mp-pv__intertitre">Écarts cumulés</h4>
      {r.ecartsCumules.map((e) => (
        <Tableau
          key={e.trimestre}
          legende={titreCumul(e.trimestre)}
          legendeVisible
          cleLigne={(l) => l.cle}
          lignes={lignesCumul(e, devise)}
          colonnes={COLONNES}
        />
      ))}

      <h4 className="mp-pv__intertitre">Explication de l&apos;écart d&apos;EBE</h4>
      <div className="mp-pv__ebe">
        <p>{phraseEcartEbe(r.explicationEbe, r.trimestresRealises, devise)}</p>
        {r.explicationEbe ? (
          <dl className="mp-pv__resume">
            <div className="mp-pv__chiffre">
              <dt>Écart d&apos;EBE cumulé</dt>
              <dd>{formaterEcart(r.explicationEbe.ecartEbe, devise)}</dd>
            </div>
            <div className="mp-pv__chiffre">
              <dt>dont effet volume</dt>
              <dd>{formaterEcart(r.explicationEbe.effetVolume, devise)}</dd>
            </div>
            <div className="mp-pv__chiffre">
              <dt>dont effet de marge</dt>
              <dd>{formaterEcart(r.explicationEbe.effetMarge, devise)}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <details>
        <summary>Réalisés utilisés par cette re-prévision</summary>
        <ul className="mp-pv__historique">
          {reprevision.entrees.map((e) => (
            <li key={e.trimestre}>
              {LIBELLE_TRIMESTRE(e.trimestre)} (version {e.version} du réalisé) : chiffre
              d&apos;affaires {formaterMontantMineur(e.chiffreAffaires, devise)}, EBE{" "}
              {formaterMontantMineur(e.excedentBrutExploitation, devise)}, résultat net{" "}
              {montantOuNonSaisi(e.resultatNet, devise)}, trésorerie{" "}
              {montantOuNonSaisi(e.tresorerieFin, devise)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import {
  aideContenuIa,
  libelleContenuIa,
  ligneHistoriqueIa,
  type OrigineIa,
} from "../../../../../lib/questionnaires-ia";

/**
 * Origine IA d'une version (SOC-11) : statut du contenu (brouillon IA, modifié, validé),
 * besoin décrit et historique. Affiché seulement pour une version proposée par l'IA.
 */
export function PanneauIa({ ia }: { ia: OrigineIa }) {
  const statut = libelleContenuIa(ia.statut_contenu);
  const brief = ia.brief;
  return (
    <Carte
      niveauTitre={2}
      titre="Contenu proposé par l'IA"
      actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
    >
      <div className="mp-pile">
        <Alerte tonalite={ia.statut_contenu === "valide" ? "succes" : "attention"} annonce="status">
          <p>{aideContenuIa(ia)}</p>
          {ia.chiffres_non_verifies && ia.statut_contenu !== "valide" ? (
            <p>
              Des nombres du questionnaire ne viennent pas d&apos;un moteur de calcul : ils sont à
              vérifier et à acquitter explicitement avant la validation.
            </p>
          ) : null}
        </Alerte>
        {brief.service || brief.population || brief.theme ? (
          <dl className="mp-liste-def">
            {brief.service ? (
              <div>
                <dt>Service</dt>
                <dd>{brief.service}</dd>
              </div>
            ) : null}
            {brief.population ? (
              <div>
                <dt>Population interrogée</dt>
                <dd>{brief.population}</dd>
              </div>
            ) : null}
            {brief.theme ? (
              <div>
                <dt>Thème</dt>
                <dd>{brief.theme}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <ol className="mp-liste-simple" aria-label="Historique du contenu">
          {ia.historique.map((r) => (
            <li key={r.rang}>{ligneHistoriqueIa(r)}</li>
          ))}
        </ol>
      </div>
    </Carte>
  );
}

import type { Metadata } from "next";
import { TableauTriangulation } from "../../../../../../components/preuves/AffichagePreuves";
import {
  BoutonActivationDimension,
  FormulaireDimension,
} from "../../../../../../components/preuves/ActionsLiens";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  cheminTriangulation,
  droitsPreuves,
  hrefTriangulation,
  libelleDimension,
  TYPE_SOURCE_LIBELLES,
  type CarteTriangulationVue,
  type DimensionVue,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Triangulation des preuves" };

/**
 * Carte de triangulation (PRV-05) : sources × dimensions, avec les zones non couvertes signalées
 * AVANT l'analyse. La carte est calculée par le moteur de l'API ; la page déclare les dimensions
 * de la mission et affiche le résultat.
 */
export default async function PageTriangulation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const [carte, dimensions] = await Promise.all([
    chargerServeur<CarteTriangulationVue>(cheminTriangulation(id)),
    chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id)),
  ]);
  const dims = dimensions.ok ? dimensions.donnees.elements : [];

  return (
    <>
      <p className="mp-texte-doux">
        Chaque dimension doit être éclairée par plusieurs types de source indépendants. Les cases «
        Non couverte » indiquent où chercher une preuve avant d&apos;écrire l&apos;analyse.
      </p>

      {!carte.ok ? (
        <EtatErreur
          titre="La carte de triangulation n'a pas pu être calculée."
          message={carte.message}
          hrefReessayer={hrefTriangulation(id)}
        />
      ) : carte.donnees.dimensions.length === 0 ? (
        <EtatVide titre="Aucune dimension n'est déclarée pour cette mission." icone="barres">
          <p>
            {droits.ecrire
              ? "Déclarez les axes d'analyse de la mission (gouvernance, finance, ressources humaines…) : la carte indiquera où les preuves manquent."
              : "Un consultant de la mission doit d'abord déclarer ses dimensions d'analyse."}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre="Sources × dimensions">
            <div className="mp-pile">
              <TableauTriangulation carte={carte.donnees} />
              <p className="mp-texte-petit">
                {carte.donnees.zones_non_couvertes.length === 0
                  ? "Aucune zone non couverte."
                  : `${carte.donnees.zones_non_couvertes.length} zone(s) non couverte(s) sur les types de source attendus.`}
              </p>
            </div>
          </Carte>
          {carte.donnees.dimensions_non_couvertes.length > 0 ? (
            <Alerte tonalite="attention" titre="Dimensions sans aucune preuve" annonce="aucune">
              <p>
                {carte.donnees.dimensions_non_couvertes
                  .map((c) => libelleDimension(c, dims))
                  .join(", ")}
                . Une assertion sur ces dimensions serait sans fondement.
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.dimensions_sous_triangulees.length > 0 ? (
            <Alerte
              tonalite="info"
              titre="Dimensions éclairées par une seule source"
              annonce="aucune"
            >
              <p>
                {carte.donnees.dimensions_sous_triangulees
                  .map((c) => libelleDimension(c, dims))
                  .join(", ")}
                . Cherchez une source d&apos;un autre type pour recouper.
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.rattachements_inconnus.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre="Preuves rattachées à une dimension retirée"
              annonce="aucune"
            >
              <p>
                {carte.donnees.rattachements_inconnus.length} rattachement(s) ignoré(s) : la
                dimension a été désactivée. Réactivez-la ou corrigez les preuves.
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.preuves_ecartees.length > 0 ? (
            <p className="mp-texte-doux">
              {`${carte.donnees.preuves_ecartees.length} preuve(s) sous la fiabilité minimale sont écartées de la carte.`}
            </p>
          ) : null}
          <p className="mp-texte-doux mp-texte-petit">
            Types de source suivis :{" "}
            {Object.values(TYPE_SOURCE_LIBELLES)
              .map((l) => l.toLowerCase())
              .join(", ")}
            .
          </p>
        </>
      )}

      <Carte titre="Dimensions de la mission">
        {dims.length === 0 ? (
          <p className="mp-texte-doux">Aucune dimension déclarée.</p>
        ) : (
          <ul className="mp-preuves-liste" aria-label="Dimensions de la mission">
            {dims.map((d) => (
              <li key={d.id} className="mp-preuve-ligne">
                <span className="mp-preuve-ligne__meta">
                  <strong>{d.libelle}</strong>
                  <BadgeStatut tonalite={d.actif ? "succes" : "neutre"} sansIcone>
                    {d.actif ? "Active" : "Désactivée"}
                  </BadgeStatut>
                </span>
                {droits.ecrire ? <BoutonActivationDimension missionId={id} dimension={d} /> : null}
              </li>
            ))}
          </ul>
        )}
        {droits.ecrire ? <FormulaireDimension missionId={id} /> : null}
      </Carte>
    </>
  );
}

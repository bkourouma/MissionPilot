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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  cheminTriangulation,
  droitsPreuves,
  hrefTriangulation,
  libelleDimension,
  libelleTypeSourcePreuve,
  TYPE_SOURCE_LIBELLES,
  type CarteTriangulationVue,
  type DimensionVue,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Triangulation des preuves", "Evidence triangulation") };
}

/**
 * Carte de triangulation (PRV-05) : sources × dimensions, avec les zones non couvertes signalées
 * AVANT l'analyse. La carte est calculée par le moteur de l'API ; la page déclare les dimensions
 * de la mission et affiche le résultat.
 */
export default async function PageTriangulation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        {t(
          "Chaque dimension doit être éclairée par plusieurs types de source indépendants. Les cases « Non couverte » indiquent où chercher une preuve avant d'écrire l'analyse.",
          'Each dimension must be covered by several independent source types. The "Not covered" cells show where to look for evidence before writing the analysis.',
        )}
      </p>

      {!carte.ok ? (
        <EtatErreur
          titre={t(
            "La carte de triangulation n'a pas pu être calculée.",
            "The triangulation map could not be computed.",
          )}
          message={carte.message}
          hrefReessayer={hrefTriangulation(id)}
        />
      ) : carte.donnees.dimensions.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune dimension n'est déclarée pour cette mission.",
            "No dimension is declared for this engagement.",
          )}
          icone="barres"
        >
          <p>
            {droits.ecrire
              ? t(
                  "Déclarez les axes d'analyse de la mission (gouvernance, finance, ressources humaines…) : la carte indiquera où les preuves manquent.",
                  "Declare the engagement's analysis axes (governance, finance, human resources…): the map will show where evidence is missing.",
                )
              : t(
                  "Un consultant de la mission doit d'abord déclarer ses dimensions d'analyse.",
                  "A consultant on the engagement must first declare its analysis dimensions.",
                )}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre={t("Sources × dimensions", "Sources × dimensions")}>
            <div className="mp-pile">
              <TableauTriangulation carte={carte.donnees} />
              <p className="mp-texte-petit">
                {carte.donnees.zones_non_couvertes.length === 0
                  ? t("Aucune zone non couverte.", "No uncovered area.")
                  : t(
                      `${carte.donnees.zones_non_couvertes.length} zone(s) non couverte(s) sur les types de source attendus.`,
                      `${carte.donnees.zones_non_couvertes.length} uncovered area(s) among the expected source types.`,
                    )}
              </p>
            </div>
          </Carte>
          {carte.donnees.dimensions_non_couvertes.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t("Dimensions sans aucune preuve", "Dimensions with no evidence")}
              annonce="aucune"
            >
              <p>
                {carte.donnees.dimensions_non_couvertes
                  .map((c) => libelleDimension(c, dims))
                  .join(", ")}
                {t(
                  ". Une assertion sur ces dimensions serait sans fondement.",
                  ". An assertion on these dimensions would be unfounded.",
                )}
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.dimensions_sous_triangulees.length > 0 ? (
            <Alerte
              tonalite="info"
              titre={t(
                "Dimensions éclairées par une seule source",
                "Dimensions covered by a single source",
              )}
              annonce="aucune"
            >
              <p>
                {carte.donnees.dimensions_sous_triangulees
                  .map((c) => libelleDimension(c, dims))
                  .join(", ")}
                {t(
                  ". Cherchez une source d'un autre type pour recouper.",
                  ". Look for a source of another type to cross-check.",
                )}
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.rattachements_inconnus.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t(
                "Preuves rattachées à une dimension retirée",
                "Evidence linked to a removed dimension",
              )}
              annonce="aucune"
            >
              <p>
                {t(
                  `${carte.donnees.rattachements_inconnus.length} rattachement(s) ignoré(s) : la dimension a été désactivée. Réactivez-la ou corrigez les preuves.`,
                  `${carte.donnees.rattachements_inconnus.length} link(s) ignored: the dimension was deactivated. Reactivate it or correct the evidence.`,
                )}
              </p>
            </Alerte>
          ) : null}
          {carte.donnees.preuves_ecartees.length > 0 ? (
            <p className="mp-texte-doux">
              {t(
                `${carte.donnees.preuves_ecartees.length} preuve(s) sous la fiabilité minimale sont écartées de la carte.`,
                `${carte.donnees.preuves_ecartees.length} piece(s) of evidence below the minimum reliability are left off the map.`,
              )}
            </p>
          ) : null}
          <p className="mp-texte-doux mp-texte-petit">
            {t("Types de source suivis", "Source types tracked")} :{" "}
            {Object.keys(TYPE_SOURCE_LIBELLES)
              .map((k) => libelleTypeSourcePreuve(k, langue).toLowerCase())
              .join(", ")}
            .
          </p>
        </>
      )}

      <Carte titre={t("Dimensions de la mission", "Engagement dimensions")}>
        {dims.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucune dimension déclarée.", "No dimension declared.")}
          </p>
        ) : (
          <ul
            className="mp-preuves-liste"
            aria-label={t("Dimensions de la mission", "Engagement dimensions")}
          >
            {dims.map((d) => (
              <li key={d.id} className="mp-preuve-ligne">
                <span className="mp-preuve-ligne__meta">
                  <strong>{d.libelle}</strong>
                  <BadgeStatut tonalite={d.actif ? "succes" : "neutre"} sansIcone>
                    {d.actif ? t("Active", "Active") : t("Désactivée", "Deactivated")}
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

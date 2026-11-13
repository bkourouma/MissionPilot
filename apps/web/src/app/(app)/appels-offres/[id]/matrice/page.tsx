import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/appels-offres/appels-offres.css";
import {
  FormulaireDossierAo,
  FormulaireExigenceAo,
  LancerExtractionAo,
  SuiviExigenceAo,
  ValidationExtractionAo,
} from "../../../../../components/appels-offres/ActionsAo";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  droitsAppelsOffres,
  estOuverte,
  hrefFiche,
  hrefMatrice,
  libelleCategorie,
  libelleConformite,
  LIBELLES_SIGNAUX,
  LIBELLES_SIGNAUX_EN,
  libelleStatutAo,
  tonaliteConformite,
  tonaliteStatutAo,
  type DossierAo,
  type ExtractionAo,
  type FicheDetail,
  type MatriceAo,
} from "../../../../../lib/appels-offres";
import { exigerLectureAo } from "../../../../../lib/appels-offres-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Matrice de conformité", "Compliance matrix") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exigences du dossier et matrice de conformité (AO-03). Le dossier est un contenu non fiable
 * (AGT-07) ; son extraction (IA par l'orchestrateur ou découpage déterministe) n'est qu'un
 * BROUILLON qu'un humain valide avant toute entrée dans la matrice. La synthèse et la condition
 * de dépôt sont calculées par le moteur ; la matrice se fige au dépôt.
 */
export default async function PageMatrice({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const signaux = langue === "en" ? LIBELLES_SIGNAUX_EN : LIBELLES_SIGNAUX;
  const session = await exigerLectureAo();
  const droits = droitsAppelsOffres(session.utilisateur.roles);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [fiche, matrice, dossiers, extractions] = await Promise.all([
    chargerServeur<FicheDetail>(`/api/appels-offres/${id}`),
    chargerServeur<MatriceAo>(`/api/appels-offres/${id}/exigences`),
    chargerServeur<{ elements: DossierAo[] }>(`/api/appels-offres/${id}/dossiers`),
    chargerServeur<{ elements: ExtractionAo[] }>(`/api/appels-offres/${id}/extractions`),
  ]);
  if (!fiche.ok && fiche.statut === 404) notFound();
  if (!fiche.ok || !matrice.ok || !dossiers.ok || !extractions.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Matrice de conformité", "Compliance matrix")}
          retour={{ href: hrefFiche(id), libelle: t("Fiche", "Record") }}
        />
        <EtatErreur
          titre={t("La matrice n'a pas pu être chargée.", "The matrix could not be loaded.")}
          message={t("Réessayez dans un instant.", "Try again in a moment.")}
          hrefReessayer={hrefMatrice(id)}
        />
      </div>
    );
  }
  const f = fiche.donnees;
  const { exigences, synthese } = matrice.donnees;
  const modifiable = droits.gerer && estOuverte(f.statut);
  const brouillons = extractions.donnees.elements.filter((x) => x.statut === "brouillon");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t(`Matrice : ${f.titre}`, `Matrix: ${f.titre}`)}
        retour={{ href: hrefFiche(id), libelle: t("Fiche", "Record") }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut, langue)}
          </BadgeStatut>
        }
      />

      <Carte titre={t("Synthèse", "Summary")}>
        <p>
          {t(
            `${synthese.total} exigence(s) · ${synthese.obligatoiresSatisfaites}/${synthese.obligatoires} obligatoire(s) satisfaite(s) · conformité ${synthese.tauxConformite === null ? "—" : `${synthese.tauxConformite} %`}`,
            `${synthese.total} requirement(s) · ${synthese.obligatoiresSatisfaites}/${synthese.obligatoires} mandatory met · compliance ${synthese.tauxConformite === null ? "—" : `${synthese.tauxConformite}%`}`,
          )}
        </p>
        <BadgeStatut tonalite={synthese.pretAuDepot ? "succes" : "attention"}>
          {synthese.pretAuDepot
            ? t("Prête au dépôt", "Ready for submission")
            : t(
                `${synthese.bloquantes} exigence(s) obligatoire(s) bloquent le dépôt`,
                `${synthese.bloquantes} mandatory requirement(s) block submission`,
              )}
        </BadgeStatut>
      </Carte>

      {modifiable ? (
        <Carte titre={t("Dossier d'appel d'offres", "Tender document")}>
          <FormulaireDossierAo id={f.id} />
        </Carte>
      ) : null}

      {dossiers.donnees.elements.length > 0 ? (
        <Carte titre={t("Dossiers enregistrés", "Saved documents")}>
          <ul className="mp-liste-lignes">
            {dossiers.donnees.elements.map((d) => (
              <li key={d.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <span>
                    {t(`Dossier n° ${d.numero}`, `Document #${d.numero}`)}{" "}
                    {d.nom_fichier ? `(${d.nom_fichier})` : ""} · {d.longueur}{" "}
                    {t("caractères", "characters")}
                  </span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {d.cree_par_nom} · {formaterDateHeure(d.cree_le, undefined, langue)}
                  </span>
                  {d.signaux_injection.length > 0 ? (
                    <Alerte tonalite="attention" annonce="aucune">
                      <p>
                        {t(
                          "Contenu à relire avec prudence (consignes adressées à l'IA, jamais suivies) :",
                          "Content to review with caution (instructions aimed at the AI, never followed):",
                        )}{" "}
                        {d.signaux_injection.map((s) => signaux[s] ?? s).join(", ")}.
                      </p>
                    </Alerte>
                  ) : null}
                </div>
                {modifiable ? (
                  <LancerExtractionAo id={f.id} dossierId={d.id} ia={droits.ia} />
                ) : null}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {modifiable
        ? brouillons.map((x) => (
            <Carte
              key={x.id}
              titre={t(`Exigences proposées (${x.nombre})`, `Proposed requirements (${x.nombre})`)}
              actions={
                <BadgeStatut tonalite="attention">
                  {x.gabarit
                    ? t("Découpage automatique", "Automatic split")
                    : t("Brouillon IA", "AI draft")}
                </BadgeStatut>
              }
            >
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "À relire et valider : rien n'entre dans la matrice sans votre validation.",
                  "To review and approve: nothing enters the matrix without your approval.",
                )}
                {x.tronque
                  ? t(
                      " Le dossier a été lu en partie seulement.",
                      " The document was only partly read.",
                    )
                  : ""}
                {x.chiffres_non_verifies
                  ? t(
                      " Des nombres sont à vérifier dans le dossier.",
                      " Some numbers need to be checked against the document.",
                    )
                  : ""}
              </p>
              <ValidationExtractionAo extraction={x} />
            </Carte>
          ))
        : null}

      <section aria-labelledby="titre-matrice" className="mp-pile">
        <h2 id="titre-matrice" className="mp-section__titre">
          {t("Exigences", "Requirements")}
        </h2>
        {exigences.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucune exigence dans la matrice.", "No requirements in the matrix.")}
          </p>
        ) : (
          <ul className="mp-liste-lignes">
            {exigences.map((e) => (
              <li key={e.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <span>
                    {e.numero}. {e.reference ? `[${e.reference}] ` : ""}
                    {e.libelle}
                  </span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleCategorie(e.categorie, langue)} ·{" "}
                    {e.obligatoire ? t("obligatoire", "mandatory") : t("facultative", "optional")}
                    {e.responsable_nom ? ` · ${e.responsable_nom}` : ""}
                    {e.piece ? ` · ${t("pièce", "document")} : ${e.piece}` : ""}
                    {e.commentaire ? ` · ${e.commentaire}` : ""}
                  </span>
                  {modifiable ? <SuiviExigenceAo exigence={e} /> : null}
                </div>
                <BadgeStatut tonalite={tonaliteConformite(e.statut)}>
                  {libelleConformite(e.statut, langue)}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modifiable ? (
        <Carte titre={t("Ajouter une exigence", "Add a requirement")}>
          <FormulaireExigenceAo id={f.id} />
        </Carte>
      ) : null}
    </div>
  );
}

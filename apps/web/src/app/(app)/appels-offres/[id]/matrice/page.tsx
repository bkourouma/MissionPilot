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

export const metadata: Metadata = { title: "Matrice de conformité" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exigences du dossier et matrice de conformité (AO-03). Le dossier est un contenu non fiable
 * (AGT-07) ; son extraction (IA par l'orchestrateur ou découpage déterministe) n'est qu'un
 * BROUILLON qu'un humain valide avant toute entrée dans la matrice. La synthèse et la condition
 * de dépôt sont calculées par le moteur ; la matrice se fige au dépôt.
 */
export default async function PageMatrice({ params }: { params: Promise<{ id: string }> }) {
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
          titre="Matrice de conformité"
          retour={{ href: hrefFiche(id), libelle: "Fiche" }}
        />
        <EtatErreur
          titre="La matrice n'a pas pu être chargée."
          message="Réessayez dans un instant."
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
        titre={`Matrice : ${f.titre}`}
        retour={{ href: hrefFiche(id), libelle: "Fiche" }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut)}
          </BadgeStatut>
        }
      />

      <Carte titre="Synthèse">
        <p>
          {synthese.total} exigence(s) · {synthese.obligatoiresSatisfaites}/{synthese.obligatoires}{" "}
          obligatoire(s) satisfaite(s) · conformité{" "}
          {synthese.tauxConformite === null ? "—" : `${synthese.tauxConformite} %`}
        </p>
        <BadgeStatut tonalite={synthese.pretAuDepot ? "succes" : "attention"}>
          {synthese.pretAuDepot
            ? "Prête au dépôt"
            : `${synthese.bloquantes} exigence(s) obligatoire(s) bloquent le dépôt`}
        </BadgeStatut>
      </Carte>

      {modifiable ? (
        <Carte titre="Dossier d'appel d'offres">
          <FormulaireDossierAo id={f.id} />
        </Carte>
      ) : null}

      {dossiers.donnees.elements.length > 0 ? (
        <Carte titre="Dossiers enregistrés">
          <ul className="mp-liste-lignes">
            {dossiers.donnees.elements.map((d) => (
              <li key={d.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <span>
                    Dossier n° {d.numero} {d.nom_fichier ? `(${d.nom_fichier})` : ""} · {d.longueur}{" "}
                    caractères
                  </span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {d.cree_par_nom} · {formaterDateHeure(d.cree_le)}
                  </span>
                  {d.signaux_injection.length > 0 ? (
                    <Alerte tonalite="attention" annonce="aucune">
                      <p>
                        Contenu à relire avec prudence (consignes adressées à l&apos;IA, jamais
                        suivies) :{" "}
                        {d.signaux_injection.map((s) => LIBELLES_SIGNAUX[s] ?? s).join(", ")}.
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
              titre={`Exigences proposées (${x.nombre})`}
              actions={
                <BadgeStatut tonalite="attention">
                  {x.gabarit ? "Découpage automatique" : "Brouillon IA"}
                </BadgeStatut>
              }
            >
              <p className="mp-texte-doux mp-texte-petit">
                À relire et valider : rien n&apos;entre dans la matrice sans votre validation.
                {x.tronque ? " Le dossier a été lu en partie seulement." : ""}
                {x.chiffres_non_verifies ? " Des nombres sont à vérifier dans le dossier." : ""}
              </p>
              <ValidationExtractionAo extraction={x} />
            </Carte>
          ))
        : null}

      <section aria-labelledby="titre-matrice" className="mp-pile">
        <h2 id="titre-matrice" className="mp-section__titre">
          Exigences
        </h2>
        {exigences.length === 0 ? (
          <p className="mp-texte-doux">Aucune exigence dans la matrice.</p>
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
                    {libelleCategorie(e.categorie)} ·{" "}
                    {e.obligatoire ? "obligatoire" : "facultative"}
                    {e.responsable_nom ? ` · ${e.responsable_nom}` : ""}
                    {e.piece ? ` · pièce : ${e.piece}` : ""}
                    {e.commentaire ? ` · ${e.commentaire}` : ""}
                  </span>
                  {modifiable ? <SuiviExigenceAo exigence={e} /> : null}
                </div>
                <BadgeStatut tonalite={tonaliteConformite(e.statut)}>
                  {libelleConformite(e.statut)}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modifiable ? (
        <Carte titre="Ajouter une exigence">
          <FormulaireExigenceAo id={f.id} />
        </Carte>
      ) : null}
    </div>
  );
}

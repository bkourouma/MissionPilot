import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AmorcageProposition } from "../../../../../../../components/methodes/AmorcageProposition";
import { ActualisationAuto } from "../../../../../../../components/ingestion/ActualisationAuto";
import { BoutonRelance } from "../../../../../../../components/ingestion/BoutonRelance";
import { StatutDocument } from "../../../../../../../components/ingestion/StatutDocument";
import { VisionneusePages } from "../../../../../../../components/ingestion/VisionneusePages";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import {
  apiIngestionStandard,
  cheminDocument,
  documentEnCours,
  erreurDocument,
  formaterTaille,
  hrefAmorcage,
  hrefDocumentAmorcage,
  hrefEditeurVersion,
  LIBELLES_FORMAT,
  libelleMethode,
  libelleResultat,
  pageCitee,
  type DetailDocumentIngestion,
} from "../../../../../../../lib/ingestion";
import {
  droitsIngestionStandard,
  extractionCourante,
  relancePossible,
} from "../../../../../../../lib/ingestion-extractions";
import type { VersionDetail } from "../../../../../../../lib/methodes";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Document d'amorçage", "Bootstrap document") };
}

/**
 * Détail d'un document d'amorçage (STD-13) : statut, erreur lisible, pages lues et proposition de
 * l'IA en brouillon (étapes, briques, éléments, rubriques ; retrait, validation ou rejet).
 * Réservé aux détenteurs de `standard.gerer`. Aucun coût affiché.
 */
export default async function PageDocumentAmorcage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, docId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(docId)) notFound();
  const { utilisateur } = await exigerPermission("standard.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const citee = pageCitee((await searchParams).page);
  const api = apiIngestionStandard(id);
  const [doc, version] = await Promise.all([
    chargerServeur<DetailDocumentIngestion>(cheminDocument(api, docId)),
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
  ]);
  if ((!doc.ok && doc.statut === 404) || (!version.ok && version.statut === 404)) notFound();
  const retour = {
    href: hrefAmorcage(id),
    libelle: t("Documents d'amorçage", "Bootstrap documents"),
  };
  if (!doc.ok || !version.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Document d'amorçage", "Bootstrap document")} retour={retour} />
        <EtatErreur
          titre={t("Le document n'a pas pu être chargé.", "The document could not be loaded.")}
          message={!doc.ok ? doc.message : !version.ok ? version.message : ""}
          hrefReessayer={hrefDocumentAmorcage(id, docId)}
        />
      </div>
    );
  }
  const d = doc.donnees;
  const brouillon = version.donnees.version.statut === "brouillon";
  const droits = droitsIngestionStandard(utilisateur.roles, brouillon);
  const enCours = documentEnCours(d);
  const erreur = erreurDocument(d, langue);
  const courante = extractionCourante(d.extractions);
  const proposition = courante?.nature === "standard_proposition" ? courante : null;
  const relancable = relancePossible("standard", d, d.extractions);
  const hrefDocument = hrefDocumentAmorcage(id, d.id);

  return (
    <div className="mp-page">
      <ActualisationAuto actif={enCours} />
      <EnteteDePage
        titre={d.nom}
        retour={retour}
        soustitre={t(
          `${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille, langue)} · importé par ${d.cree_par.nom}${d.cree_le ? ` le ${formaterDateHeure(d.cree_le, undefined, langue)}` : ""}`,
          `${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille, langue)} · imported by ${d.cree_par.nom}${d.cree_le ? ` on ${formaterDateHeure(d.cree_le, undefined, langue)}` : ""}`,
        )}
        badges={<StatutDocument statut={d.statut} />}
      />

      {enCours ? (
        <Alerte
          tonalite="info"
          titre={t("Lecture en cours", "Reading in progress")}
          annonce="aucune"
        >
          <p>
            {t(
              "Le document est lu en arrière-plan ; cette page se met à jour toute seule.",
              "The document is being read in the background; this page updates by itself.",
            )}
          </p>
        </Alerte>
      ) : null}

      {d.statut === "echec" ? (
        <Alerte
          tonalite="danger"
          titre={t("La lecture a échoué", "The reading failed")}
          annonce="aucune"
        >
          <p>{erreur ?? t("Erreur inconnue.", "Unknown error.")}</p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "ia_indisponible" ? (
        <Alerte
          tonalite="attention"
          titre={t("L'IA n'est pas disponible", "AI is not available")}
          annonce="aucune"
        >
          <p>
            {t(
              "Le texte du document est lu, mais l'IA n'a pas pu en proposer de standard. Rien n'a été inventé : relancez quand l'IA est de nouveau disponible.",
              "The document text was read, but the AI could not propose a standard from it. Nothing was made up: rerun when the AI is available again.",
            )}
          </p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "rien_trouve" ? (
        <Alerte
          tonalite="info"
          titre={t("Rien d'exploitable trouvé", "Nothing usable found")}
          annonce="aucune"
        >
          <p>
            {t(
              "L'IA n'a rien trouvé à proposer dans ce document.",
              "The AI found nothing to propose in this document.",
            )}
          </p>
        </Alerte>
      ) : null}

      {relancable ? (
        droits.relancer ? (
          <BoutonRelance
            api={api}
            docId={d.id}
            libelle={t("Relancer la proposition", "Rerun the proposal")}
          />
        ) : !brouillon ? (
          <p className="mp-texte-doux">
            {t(
              "Cette version est publiée : la proposition ne peut plus être relancée.",
              "This version is published: the proposal can no longer be rerun.",
            )}
          </p>
        ) : (
          <p className="mp-texte-doux">
            {t(
              "Relancer la proposition demande aussi le droit d'utiliser l'IA.",
              "Rerunning the proposal also requires the right to use AI.",
            )}
          </p>
        )
      ) : null}

      <Carte titre={t("Lecture du document", "Document reading")}>
        <dl className="mp-liste-definitions">
          <dt>{t("Résultat", "Result")}</dt>
          <dd>{libelleResultat(d.resultat, langue)}</dd>
          <dt>{t("Méthode de lecture", "Reading method")}</dt>
          <dd>{libelleMethode(d.methode, langue)}</dd>
          <dt>{t("Pages lues", "Pages read")}</dt>
          <dd>{d.nb_pages ?? "—"}</dd>
          {d.termine_le ? (
            <>
              <dt>{t("Terminé le", "Completed on")}</dt>
              <dd>{formaterDateHeure(d.termine_le, undefined, langue)}</dd>
            </>
          ) : null}
        </dl>
      </Carte>

      {proposition ? (
        <Carte titre={t("Proposition de l'IA (brouillon)", "AI proposal (draft)")}>
          <AmorcageProposition
            api={api}
            extraction={proposition}
            hrefDocument={hrefDocument}
            hrefEditeur={hrefEditeurVersion(id)}
            peutCorriger={droits.corriger}
            peutDecider={droits.decider}
            versionPubliee={!brouillon}
          />
        </Carte>
      ) : null}

      <Carte titre={t("Pages lues", "Pages read")}>
        <VisionneusePages
          api={api}
          docId={d.id}
          pages={d.pages}
          pageCitee={citee}
          textePurgeLe={d.texte_purge_le}
        />
      </Carte>
    </div>
  );
}

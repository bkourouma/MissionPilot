import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActualiserPage } from "../../../../../../../components/transcriptions/ActualiserPage";
import { CorrectionsOcr } from "../../../../../../../components/ingestion/CorrectionsOcr";
import "../../../../../../../components/ingestion/ingestion.css";
import { StatutDocument } from "../../../../../../../components/ingestion/StatutDocument";
import { VisionneusePages } from "../../../../../../../components/ingestion/VisionneusePages";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { AVERTISSEMENT_OCR, AVERTISSEMENT_OCR_EN } from "../../../../../../../lib/dossier";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import {
  apiIngestionDossier,
  cheminDocument,
  documentEnCours,
  erreurDocumentAvecAide,
  formaterTaille,
  hrefEtatFinancier,
  LIBELLES_FORMAT,
  libelleMethode,
  libelleResultat,
  pageCitee,
  type DetailDocumentIngestion,
} from "../../../../../../../lib/ingestion";
import { avertissementOcrPertinent } from "../../../../../../../lib/ingestion-detail";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Document importé", "Imported document") };
}

/** Détail d'un document d'état financier importé (DOS-03) : statut, résultat, erreur, pages lues. */
export default async function PageDocumentEtat({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, docId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(docId)) notFound();
  await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const citee = pageCitee((await searchParams).page);
  const api = apiIngestionDossier(id);
  const r = await chargerServeur<DetailDocumentIngestion>(cheminDocument(api, docId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: `/dossiers/${id}/finances`,
    libelle: t("Finances du client", "Client finances"),
  };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Document importé", "Imported document")} retour={retour} />
        <EtatErreur
          titre={t("Le document n'a pas pu être chargé.", "The document could not be loaded.")}
          message={r.message}
          hrefReessayer={`/dossiers/${id}/finances/documents/${docId}`}
        />
      </div>
    );
  }
  const d = r.donnees;
  const erreur = erreurDocumentAvecAide(d, langue);
  const enCours = documentEnCours(d);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={d.nom}
        retour={retour}
        soustitre={`${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille, langue)} · ${t("importé par", "imported by")} ${d.cree_par.nom}${d.cree_le ? ` ${t("le", "on")} ${formaterDateHeure(d.cree_le, undefined, langue)}` : ""}`}
        badges={<StatutDocument statut={d.statut} />}
        actions={enCours ? <ActualiserPage /> : undefined}
      />

      {enCours ? (
        <Alerte
          tonalite="info"
          titre={t("Lecture en cours", "Reading in progress")}
          annonce="aucune"
        >
          <p>
            {t(
              "Le document est lu en arrière-plan. Actualisez la page pour suivre l'avancement.",
              "The document is being read in the background. Refresh the page to follow progress.",
            )}
          </p>
        </Alerte>
      ) : null}

      {d.statut === "echec" ? (
        <Alerte
          tonalite="danger"
          titre={t("La lecture a échoué", "Reading failed")}
          annonce="aucune"
        >
          <p>{erreur ?? t("Erreur inconnue.", "Unknown error.")}</p>
        </Alerte>
      ) : null}

      {avertissementOcrPertinent(d) ? (
        <Alerte
          tonalite="attention"
          titre={t("Lu par reconnaissance de caractères", "Read by character recognition")}
          annonce="aucune"
        >
          <p>{langue === "en" ? AVERTISSEMENT_OCR_EN : AVERTISSEMENT_OCR}</p>
        </Alerte>
      ) : null}

      <Carte titre={t("Résultat", "Result")}>
        <dl className="mp-ing-definitions">
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
        {d.etat_financier_id ? (
          <p>
            <Link href={hrefEtatFinancier(id, d.etat_financier_id)}>
              {t("Ouvrir l'état financier créé", "Open the financial statement created")}
            </Link>
          </p>
        ) : null}
      </Carte>

      <CorrectionsOcr corrections={d.corrections_ocr} />

      <Carte titre={t("Pages lues", "Pages read")}>
        <VisionneusePages
          api={api}
          docId={d.id}
          pages={d.pages}
          pageCitee={citee}
          textePurgeLe={d.texte_purge_le}
          statut={d.statut}
          // Le motif d'échec figure déjà dans l'alerte au-dessus : pas de seconde mention ici.
        />
      </Carte>
    </div>
  );
}

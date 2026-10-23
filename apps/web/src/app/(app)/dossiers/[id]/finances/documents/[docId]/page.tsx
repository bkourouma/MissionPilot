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
import { AVERTISSEMENT_OCR } from "../../../../../../../lib/dossier";
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
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Document importé" };

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
  const citee = pageCitee((await searchParams).page);
  const api = apiIngestionDossier(id);
  const r = await chargerServeur<DetailDocumentIngestion>(cheminDocument(api, docId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: `/dossiers/${id}/finances`, libelle: "Finances du client" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Document importé" retour={retour} />
        <EtatErreur
          titre="Le document n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/dossiers/${id}/finances/documents/${docId}`}
        />
      </div>
    );
  }
  const d = r.donnees;
  const erreur = erreurDocumentAvecAide(d);
  const enCours = documentEnCours(d);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={d.nom}
        retour={retour}
        soustitre={`${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille)} · importé par ${d.cree_par.nom}${d.cree_le ? ` le ${formaterDateHeure(d.cree_le)}` : ""}`}
        badges={<StatutDocument statut={d.statut} />}
        actions={enCours ? <ActualiserPage /> : undefined}
      />

      {enCours ? (
        <Alerte tonalite="info" titre="Lecture en cours" annonce="aucune">
          <p>
            Le document est lu en arrière-plan. Actualisez la page pour suivre l&apos;avancement.
          </p>
        </Alerte>
      ) : null}

      {d.statut === "echec" ? (
        <Alerte tonalite="danger" titre="La lecture a échoué" annonce="aucune">
          <p>{erreur ?? "Erreur inconnue."}</p>
        </Alerte>
      ) : null}

      {avertissementOcrPertinent(d) ? (
        <Alerte tonalite="attention" titre="Lu par reconnaissance de caractères" annonce="aucune">
          <p>{AVERTISSEMENT_OCR}</p>
        </Alerte>
      ) : null}

      <Carte titre="Résultat">
        <dl className="mp-ing-definitions">
          <dt>Résultat</dt>
          <dd>{libelleResultat(d.resultat)}</dd>
          <dt>Méthode de lecture</dt>
          <dd>{libelleMethode(d.methode)}</dd>
          <dt>Pages lues</dt>
          <dd>{d.nb_pages ?? "—"}</dd>
          {d.termine_le ? (
            <>
              <dt>Terminé le</dt>
              <dd>{formaterDateHeure(d.termine_le)}</dd>
            </>
          ) : null}
        </dl>
        {d.etat_financier_id ? (
          <p>
            <Link href={hrefEtatFinancier(id, d.etat_financier_id)}>
              Ouvrir l&apos;état financier créé
            </Link>
          </p>
        ) : null}
      </Carte>

      <CorrectionsOcr corrections={d.corrections_ocr} />

      <Carte titre="Pages lues">
        <VisionneusePages
          api={api}
          docId={d.id}
          pages={d.pages}
          pageCitee={citee}
          textePurgeLe={d.texte_purge_le}
          statut={d.statut}
          motifEchec={d.statut === "echec" ? erreur : null}
        />
      </Carte>
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentsLecture } from "../../../../../../../../components/due-diligence/DocumentsLecture";
import { ActualisationAuto } from "../../../../../../../../components/ingestion/ActualisationAuto";
import { BoutonRelance } from "../../../../../../../../components/ingestion/BoutonRelance";
import { StatutDocument } from "../../../../../../../../components/ingestion/StatutDocument";
import { VisionneusePages } from "../../../../../../../../components/ingestion/VisionneusePages";
import { Alerte } from "../../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../../lib/identifiant";
import {
  apiIngestionDd,
  cheminDocument,
  documentEnCours,
  erreurDocument,
  formaterTaille,
  hrefDocumentDd,
  hrefDocumentsDd,
  LIBELLES_FORMAT,
  libelleMethode,
  libelleResultat,
  libelleUsage,
  pageCitee,
  type DetailDocumentIngestion,
} from "../../../../../../../../lib/ingestion";
import {
  droitsIngestionDd,
  extractionCourante,
  relancePossible,
} from "../../../../../../../../lib/ingestion-extractions";
import { chargerMission } from "../../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Document du dossier", "File document") };
}

/**
 * Détail d'un document de due diligence (DD-02, DD-10) : statut, erreur lisible, pages lues et lecture
 * IA en brouillon (résumé, éléments sourcés, correction, validation ou rejet). Aucun coût affiché.
 */
export default async function PageDocumentDd({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; dossierId: string; docId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, dossierId, docId } = await params;
  if (!estIdentifiant(dossierId) || !estIdentifiant(docId)) notFound();
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const citee = pageCitee((await searchParams).page);
  const api = apiIngestionDd(dossierId);
  const r = await chargerServeur<DetailDocumentIngestion>(cheminDocument(api, docId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t("Le document n'a pas pu être chargé.", "The document could not be loaded.")}
        message={r.message}
        hrefReessayer={hrefDocumentDd(id, dossierId, docId)}
      />
    );
  }
  const d = r.donnees;
  const droits = droitsIngestionDd(utilisateur.roles, mission.donnees);
  const enCours = documentEnCours(d);
  const erreur = erreurDocument(d, langue);
  const courante = extractionCourante(d.extractions);
  const lecture = courante?.nature === "lecture_document" ? courante : null;
  const relancable = relancePossible("dd", d, d.extractions);
  const hrefDocument = hrefDocumentDd(id, dossierId, d.id);

  return (
    <div className="mp-dd-pile">
      <ActualisationAuto actif={enCours} />
      <p className="mp-texte-petit">
        <Link href={hrefDocumentsDd(id, dossierId)}>
          {t("Tous les documents du dossier", "All file documents")}
        </Link>
      </p>
      <h3 className="mp-carte__titre">{d.nom}</h3>
      <div className="mp-dd-meta">
        <StatutDocument statut={d.statut} />
        <span className="mp-texte-petit">
          {`${libelleUsage(d.usage, langue)} · ${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille, langue)} · ${t("importé par", "imported by")} ${d.cree_par.nom}${d.cree_le ? ` ${t("le", "on")} ${formaterDateHeure(d.cree_le, undefined, langue)}` : ""}`}
        </span>
      </div>

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
          titre={t("La lecture a échoué", "Reading failed")}
          annonce="aucune"
        >
          <p>{erreur ?? t("Erreur inconnue.", "Unknown error.")}</p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "ia_indisponible" ? (
        <Alerte
          tonalite="attention"
          titre={t("L'IA n'est pas disponible", "The AI is not available")}
          annonce="aucune"
        >
          <p>
            {t(
              "Le texte du document est lu, mais l'IA n'a pas pu en proposer de lecture. Rien n'a été inventé : relancez la lecture quand l'IA est de nouveau disponible.",
              "The document text has been read, but the AI could not propose a reading. Nothing was invented: restart the reading when the AI is available again.",
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
              "L'IA n'a relevé aucun élément exploitable dans ce document.",
              "The AI found no usable item in this document.",
            )}
          </p>
        </Alerte>
      ) : null}

      {relancable ? (
        droits.relancer ? (
          <BoutonRelance
            api={api}
            docId={d.id}
            libelle={t("Relancer la lecture", "Restart the reading")}
          />
        ) : (
          <p className="mp-texte-doux">
            {t(
              "La lecture peut être relancée par un membre autorisé à écrire dans la due diligence et à utiliser l'IA.",
              "The reading can be restarted by a member allowed to write in due diligence and to use the AI.",
            )}
          </p>
        )
      ) : null}

      <Carte titre={t("Lecture du document", "Document reading")} niveauTitre={3}>
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

      {lecture ? (
        <Carte titre={t("Lecture IA (brouillon)", "AI reading (draft)")} niveauTitre={3}>
          <DocumentsLecture
            api={api}
            extraction={lecture}
            hrefDocument={hrefDocument}
            peutCorriger={droits.corriger}
            peutDecider={droits.decider}
          />
        </Carte>
      ) : null}

      <Carte titre={t("Pages lues", "Pages read")} niveauTitre={3}>
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

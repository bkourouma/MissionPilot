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

export const metadata: Metadata = { title: "Document du dossier" };

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
        titre="Le document n'a pas pu être chargé."
        message={r.message}
        hrefReessayer={hrefDocumentDd(id, dossierId, docId)}
      />
    );
  }
  const d = r.donnees;
  const droits = droitsIngestionDd(utilisateur.roles, mission.donnees);
  const enCours = documentEnCours(d);
  const erreur = erreurDocument(d);
  const courante = extractionCourante(d.extractions);
  const lecture = courante?.nature === "lecture_document" ? courante : null;
  const relancable = relancePossible("dd", d, d.extractions);
  const hrefDocument = hrefDocumentDd(id, dossierId, d.id);

  return (
    <div className="mp-dd-pile">
      <ActualisationAuto actif={enCours} />
      <p className="mp-texte-petit">
        <Link href={hrefDocumentsDd(id, dossierId)}>Tous les documents du dossier</Link>
      </p>
      <h3 className="mp-carte__titre">{d.nom}</h3>
      <div className="mp-dd-meta">
        <StatutDocument statut={d.statut} />
        <span className="mp-texte-petit">
          {`${libelleUsage(d.usage)} · ${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille)} · importé par ${d.cree_par.nom}${d.cree_le ? ` le ${formaterDateHeure(d.cree_le)}` : ""}`}
        </span>
      </div>

      {enCours ? (
        <Alerte tonalite="info" titre="Lecture en cours" annonce="aucune">
          <p>Le document est lu en arrière-plan ; cette page se met à jour toute seule.</p>
        </Alerte>
      ) : null}

      {d.statut === "echec" ? (
        <Alerte tonalite="danger" titre="La lecture a échoué" annonce="aucune">
          <p>{erreur ?? "Erreur inconnue."}</p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "ia_indisponible" ? (
        <Alerte tonalite="attention" titre="L'IA n'est pas disponible" annonce="aucune">
          <p>
            Le texte du document est lu, mais l&apos;IA n&apos;a pas pu en proposer de lecture. Rien
            n&apos;a été inventé : relancez la lecture quand l&apos;IA est de nouveau disponible.
          </p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "rien_trouve" ? (
        <Alerte tonalite="info" titre="Rien d'exploitable trouvé" annonce="aucune">
          <p>L&apos;IA n&apos;a relevé aucun élément exploitable dans ce document.</p>
        </Alerte>
      ) : null}

      {relancable ? (
        droits.relancer ? (
          <BoutonRelance api={api} docId={d.id} libelle="Relancer la lecture" />
        ) : (
          <p className="mp-texte-doux">
            La lecture peut être relancée par un membre autorisé à écrire dans la due diligence et à
            utiliser l&apos;IA.
          </p>
        )
      ) : null}

      <Carte titre="Lecture du document" niveauTitre={3}>
        <dl className="mp-liste-definitions">
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
      </Carte>

      {lecture ? (
        <Carte titre="Lecture IA (brouillon)" niveauTitre={3}>
          <DocumentsLecture
            api={api}
            extraction={lecture}
            hrefDocument={hrefDocument}
            peutCorriger={droits.corriger}
            peutDecider={droits.decider}
          />
        </Carte>
      ) : null}

      <Carte titre="Pages lues" niveauTitre={3}>
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

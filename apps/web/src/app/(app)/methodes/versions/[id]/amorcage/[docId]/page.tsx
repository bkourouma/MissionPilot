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

export const metadata: Metadata = { title: "Document d'amorçage" };

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
  const citee = pageCitee((await searchParams).page);
  const api = apiIngestionStandard(id);
  const [doc, version] = await Promise.all([
    chargerServeur<DetailDocumentIngestion>(cheminDocument(api, docId)),
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
  ]);
  if ((!doc.ok && doc.statut === 404) || (!version.ok && version.statut === 404)) notFound();
  const retour = { href: hrefAmorcage(id), libelle: "Documents d'amorçage" };
  if (!doc.ok || !version.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Document d'amorçage" retour={retour} />
        <EtatErreur
          titre="Le document n'a pas pu être chargé."
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
  const erreur = erreurDocument(d);
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
        soustitre={`${LIBELLES_FORMAT[d.format]} · ${formaterTaille(d.taille)} · importé par ${d.cree_par.nom}${d.cree_le ? ` le ${formaterDateHeure(d.cree_le)}` : ""}`}
        badges={<StatutDocument statut={d.statut} />}
      />

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
            Le texte du document est lu, mais l&apos;IA n&apos;a pas pu en proposer de standard.
            Rien n&apos;a été inventé : relancez quand l&apos;IA est de nouveau disponible.
          </p>
        </Alerte>
      ) : null}

      {d.statut === "termine" && d.resultat === "rien_trouve" ? (
        <Alerte tonalite="info" titre="Rien d'exploitable trouvé" annonce="aucune">
          <p>L&apos;IA n&apos;a rien trouvé à proposer dans ce document.</p>
        </Alerte>
      ) : null}

      {relancable ? (
        droits.relancer ? (
          <BoutonRelance api={api} docId={d.id} libelle="Relancer la proposition" />
        ) : !brouillon ? (
          <p className="mp-texte-doux">
            Cette version est publiée : la proposition ne peut plus être relancée.
          </p>
        ) : (
          <p className="mp-texte-doux">
            Relancer la proposition demande aussi le droit d&apos;utiliser l&apos;IA.
          </p>
        )
      ) : null}

      <Carte titre="Lecture du document">
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

      {proposition ? (
        <Carte titre="Proposition de l'IA (brouillon)">
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

      <Carte titre="Pages lues">
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

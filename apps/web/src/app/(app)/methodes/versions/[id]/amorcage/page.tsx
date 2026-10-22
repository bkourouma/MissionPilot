import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AmorcageListe,
  AmorcageTeleversement,
} from "../../../../../../components/methodes/AmorcageDocuments";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import {
  apiIngestionStandard,
  avecRequete,
  cheminListe,
  hrefAmorcage,
  hrefEditeurVersion,
  type PageDocumentsIngestion,
} from "../../../../../../lib/ingestion";
import { droitsIngestionStandard } from "../../../../../../lib/ingestion-extractions";
import type { VersionDetail } from "../../../../../../lib/methodes";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Amorçage depuis des documents" };

/**
 * Amorçage du standard à partir de documents historiques (STD-13) : téléversement vers le brouillon
 * d'une méthode du cabinet et liste des documents. Réservé aux détenteurs de `standard.gerer`.
 */
export default async function PageAmorcage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.gerer");
  const api = apiIngestionStandard(id);
  const [version, liste] = await Promise.all([
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
    chargerServeur<PageDocumentsIngestion>(avecRequete(cheminListe(api), { limite: 30 })),
  ]);
  if (!version.ok && version.statut === 404) notFound();
  if (!version.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Amorçage depuis des documents"
          retour={{ href: hrefEditeurVersion(id), libelle: "Version de la méthode" }}
        />
        <EtatErreur
          titre="La version n'a pas pu être chargée."
          message={version.message}
          hrefReessayer={hrefAmorcage(id)}
        />
      </div>
    );
  }
  const v = version.donnees;
  const brouillon = v.version.statut === "brouillon";
  const duCabinet = v.methode.cabinet_id !== null;
  const droits = droitsIngestionStandard(utilisateur.roles, brouillon && duCabinet);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Amorçage depuis des documents"
        soustitre={`${v.methode.libelle} — version ${v.version.version}`}
        retour={{ href: hrefEditeurVersion(id), libelle: "Éditeur de la méthode" }}
      />

      {!duCabinet ? (
        <Alerte tonalite="info" titre="Méthode du standard" annonce="aucune">
          <p>
            L&apos;amorçage s&apos;applique à une méthode du cabinet. Créez d&apos;abord une
            variante du standard, puis revenez sur son brouillon.
          </p>
        </Alerte>
      ) : !brouillon ? (
        <Alerte tonalite="attention" titre="Version publiée" annonce="aucune">
          <p>
            Cette version est publiée : on ne peut plus y téléverser de document ni relancer une
            lecture. Les documents déjà importés restent consultables ; pour amorcer, ouvrez le
            brouillon de la méthode.
          </p>
        </Alerte>
      ) : null}

      {droits.televerser ? (
        <Carte titre="Importer un document historique">
          <AmorcageTeleversement versionId={id} />
        </Carte>
      ) : null}

      <Carte titre="Documents importés">
        {liste.ok ? (
          <>
            <AmorcageListe versionId={id} documents={liste.donnees.elements} />
            {liste.donnees.curseur_suivant ? (
              <p className="mp-texte-petit">
                Seuls les 30 documents les plus récents sont affichés.
              </p>
            ) : null}
          </>
        ) : (
          <EtatErreur
            titre="Les documents n'ont pas pu être chargés."
            message={liste.message}
            hrefReessayer={hrefAmorcage(id)}
          />
        )}
      </Carte>
    </div>
  );
}

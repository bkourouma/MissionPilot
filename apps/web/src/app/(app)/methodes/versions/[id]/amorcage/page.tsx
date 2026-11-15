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
import { obtenirT } from "../../../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Amorçage depuis des documents", "Bootstrap from documents") };
}

/**
 * Amorçage du standard à partir de documents historiques (STD-13) : téléversement vers le brouillon
 * d'une méthode du cabinet et liste des documents. Réservé aux détenteurs de `standard.gerer`.
 */
export default async function PageAmorcage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.gerer");
  const t = await obtenirT();
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
          titre={t("Amorçage depuis des documents", "Bootstrap from documents")}
          retour={{
            href: hrefEditeurVersion(id),
            libelle: t("Version de la méthode", "Method version"),
          }}
        />
        <EtatErreur
          titre={t("La version n'a pas pu être chargée.", "The version could not be loaded.")}
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
        titre={t("Amorçage depuis des documents", "Bootstrap from documents")}
        soustitre={`${v.methode.libelle} — ${t("version", "version")} ${v.version.version}`}
        retour={{
          href: hrefEditeurVersion(id),
          libelle: t("Éditeur de la méthode", "Method editor"),
        }}
      />

      {!duCabinet ? (
        <Alerte
          tonalite="info"
          titre={t("Méthode du standard", "Standard method")}
          annonce="aucune"
        >
          <p>
            {t(
              "L'amorçage s'applique à une méthode du cabinet. Créez d'abord une variante du standard, puis revenez sur son brouillon.",
              "Bootstrapping applies to a firm method. First create a variant of the standard, then come back to its draft.",
            )}
          </p>
        </Alerte>
      ) : !brouillon ? (
        <Alerte
          tonalite="attention"
          titre={t("Version publiée", "Published version")}
          annonce="aucune"
        >
          <p>
            {t(
              "Cette version est publiée : on ne peut plus y téléverser de document ni relancer une lecture. Les documents déjà importés restent consultables ; pour amorcer, ouvrez le brouillon de la méthode.",
              "This version is published: you can no longer upload a document to it or rerun a reading. Documents already imported remain viewable; to bootstrap, open the method's draft.",
            )}
          </p>
        </Alerte>
      ) : null}

      {droits.televerser ? (
        <Carte titre={t("Importer un document historique", "Import a historical document")}>
          <AmorcageTeleversement versionId={id} />
        </Carte>
      ) : null}

      <Carte titre={t("Documents importés", "Imported documents")}>
        {liste.ok ? (
          <>
            <AmorcageListe versionId={id} documents={liste.donnees.elements} />
            {liste.donnees.curseur_suivant ? (
              <p className="mp-texte-petit">
                {t(
                  "Seuls les 30 documents les plus récents sont affichés.",
                  "Only the 30 most recent documents are shown.",
                )}
              </p>
            ) : null}
          </>
        ) : (
          <EtatErreur
            titre={t(
              "Les documents n'ont pas pu être chargés.",
              "The documents could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer={hrefAmorcage(id)}
          />
        )}
      </Carte>
    </div>
  );
}

import "../../../../../components/dossier/dossier.css";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { ImportEtat } from "../../../../../components/dossier/ImportEtat";
import { ImportEtatDocument } from "../../../../../components/dossier/ImportEtatDocument";
import { ImportEtatDocumentListe } from "../../../../../components/dossier/ImportEtatDocumentListe";
import { RapportEtatFinancier } from "../../../../../components/dossier/RapportEtatFinancier";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  libelleOrigineEtat,
  statutEtat,
  type EtatFinancier,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate, formaterMontantMineur } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import type { PageDocumentsIngestion } from "../../../../../lib/ingestion";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Finances du client", "Client finances") };
}

/** États financiers multi-exercices : statut des contrôles, revue, historique, import. */
export default async function PageFinances({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const [dossier, etats, documents] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerServeur<{ elements: EtatFinancier[] }>(`/api/dossiers/${id}/etats-financiers`),
    chargerServeur<PageDocumentsIngestion>(`/api/dossiers/${id}/ingestions?limite=30`),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !etats.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Finances du client", "Client finances")}
          retour={{ href: `/dossiers/${id}`, libelle: t("Dossier", "File") }}
        />
        <EtatErreur
          titre={t(
            "Les états financiers n'ont pas pu être chargés.",
            "The financial statements could not be loaded.",
          )}
          message={!dossier.ok ? dossier.message : !etats.ok ? etats.message : ""}
          hrefReessayer={`/dossiers/${id}/finances`}
        />
      </div>
    );
  }
  const enRevue = etats.donnees.elements.filter((e) => e.statut === "en_revue").length;

  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />

      {enRevue > 0 ? (
        <Alerte
          tonalite="attention"
          titre={t(`${enRevue} état(s) en revue`, `${enRevue} statement(s) under review`)}
          annonce="aucune"
        >
          <p>
            {t(
              "Un état dont des contrôles échouent, ou qui ne peut pas être contrôlé entièrement, n'est jamais accepté automatiquement : ouvrez-le pour l'accepter (avec un motif) ou le rejeter.",
              "A statement with failed checks, or one that cannot be fully checked, is never accepted automatically: open it to accept it (with a reason) or reject it.",
            )}
          </p>
        </Alerte>
      ) : null}

      <Carte titre={t("États financiers", "Financial statements")}>
        <Tableau
          legende={t("États financiers du client", "Client financial statements")}
          lignes={etats.donnees.elements}
          cleLigne={(e) => e.id}
          messageVide={t("Aucun état financier ingéré.", "No financial statement ingested.")}
          colonnes={[
            {
              cle: "exercice",
              entete: t("Exercice", "Fiscal year"),
              rendu: (e) => (
                <Link href={`/dossiers/${id}/finances/${e.id}`} className="mp-lien-ligne">
                  {e.exercice}
                </Link>
              ),
            },
            {
              cle: "date_cloture",
              entete: t("Clôture", "Closing"),
              rendu: (e) => formaterDate(e.date_cloture, "UTC", langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (e) => (
                <BadgeStatut tonalite={statutEtat(e.statut, langue).tonalite}>
                  {statutEtat(e.statut, langue).libelle}
                </BadgeStatut>
              ),
            },
            {
              cle: "controles",
              entete: t("Contrôles", "Checks"),
              rendu: (e) =>
                e.controles_ok
                  ? t("Tous passés", "All passed")
                  : t(
                      `${e.ecarts} écart(s), ${e.non_verifiables} non vérifiable(s)`,
                      `${e.ecarts} gap(s), ${e.non_verifiables} not verifiable`,
                    ),
            },
            {
              cle: "origine",
              entete: t("Origine", "Origin"),
              rendu: (e) => libelleOrigineEtat(e.origine, langue),
            },
            {
              cle: "actif",
              entete: t("Total actif", "Total assets"),
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.actif, e.devise, langue),
            },
            {
              cle: "resultat",
              entete: t("Résultat", "Result"),
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.resultat, e.devise, langue),
            },
          ]}
        />
      </Carte>

      <Carte titre={t("Rapport d'état financier", "Financial statement report")}>
        <RapportEtatFinancier clientId={id} />
      </Carte>

      {peutEcrire ? (
        <Carte titre={t("Importer un état financier", "Import a financial statement")}>
          <ImportEtat clientId={id} />
          <p className="mp-note-import">
            {t(
              "Classeur ou CSV au gabarit à colonnes fixes. Un nouvel état du même exercice remplace l'état courant (l'historique reste consultable).",
              "Workbook or CSV using the fixed-column template. A new statement for the same fiscal year replaces the current one (the history remains available).",
            )}
          </p>
        </Carte>
      ) : null}

      {peutEcrire ? (
        <Carte
          titre={t(
            "Importer un état financier depuis un PDF ou un classeur",
            "Import a financial statement from a PDF or workbook",
          )}
        >
          <ImportEtatDocument clientId={id} />
        </Carte>
      ) : null}

      <Carte titre={t("Documents importés", "Imported documents")}>
        {documents.ok ? (
          <ImportEtatDocumentListe clientId={id} documents={documents.donnees.elements} />
        ) : (
          <Alerte
            tonalite="danger"
            titre={t(
              "Les documents importés n'ont pas pu être chargés.",
              "The imported documents could not be loaded.",
            )}
          >
            <p>{documents.message}</p>
          </Alerte>
        )}
      </Carte>
    </div>
  );
}

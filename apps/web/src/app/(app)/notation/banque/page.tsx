import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/notation/notation.css";
import { libelleDimensionBanque } from "../../../../components/notation-augmentee/suggestions";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  HREF_NOUVEL_ITEM,
  detailStatutItem,
  cheminBanque,
  hrefItemBanque,
  lireStatutBanque,
  type ElementBanque,
  type Page,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Banque d'items de notation", "Rating item bank") };
}

/**
 * Banque d'items standard étalonnée du cabinet (NOT-09) : dernière version de chaque item,
 * statut, version validée en service. Un item se rédige en brouillon puis ne sert au questionnaire
 * adaptatif qu'une fois validé par un expert métier qui n'en est ni l'auteur ni le dernier
 * modificateur.
 */
export default async function PageBanqueNotation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  await exigerLectureNotation();
  const q = await searchParams;
  const statut = lireStatutBanque(q.statut);
  const curseur = typeof q.curseur === "string" ? q.curseur : "";
  const r = await chargerServeur<Page<ElementBanque>>(cheminBanque(curseur, statut));
  const suite = statut ? `&statut=${statut}` : "";
  const hrefListe = statut ? `/notation/banque?statut=${statut}` : "/notation/banque";
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Banque d'items", "Item bank")}
        soustitre={t(
          "Pratiques évaluées, échelles à ancrages comportementaux et formulations par public. Seuls les items validés servent aux questionnaires adaptatifs.",
          "Practices assessed, behaviorally anchored scales and wordings by audience. Only approved items are used in adaptive questionnaires.",
        )}
        actions={
          <Link href={HREF_NOUVEL_ITEM} className={classesBouton("primaire")}>
            {t("Nouvel item", "New item")}
          </Link>
        }
      />
      <nav aria-label={t("Filtrer par statut", "Filter by status")}>
        <p>
          {t("Filtrer :", "Filter:")} <Link href="/notation/banque">{t("tous", "all")}</Link> ·{" "}
          <Link href="/notation/banque?statut=valide">{t("validés", "approved")}</Link> ·{" "}
          <Link href="/notation/banque?statut=brouillon">{t("brouillons", "drafts")}</Link>
        </p>
      </nav>
      <Carte titre={t("Items", "Items")}>
        {!r.ok ? (
          <EtatErreur
            titre={t("La banque n'a pas pu être chargée.", "The bank could not be loaded.")}
            message={r.message}
            hrefReessayer={hrefListe}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              statut
                ? statut === "valide"
                  ? t("Aucun item validé.", "No approved item.")
                  : t("Aucun item en brouillon.", "No draft item.")
                : t("Aucun item dans la banque.", "No item in the bank.")
            }
            icone="info"
            action={
              <Link href={HREF_NOUVEL_ITEM} className={classesBouton("primaire")}>
                {t("Rédiger un item", "Write an item")}
              </Link>
            }
          >
            <p>
              {t(
                "Les items se rédigent en brouillon puis sont validés par un expert métier.",
                "Items are written as drafts, then approved by a business expert.",
              )}
            </p>
          </EtatVide>
        ) : (
          <>
            <Tableau
              legende={t("Items de la banque", "Bank items")}
              cleLigne={(i) => i.id}
              lignes={r.donnees.elements}
              colonnes={[
                {
                  cle: "code",
                  entete: t("Code", "Code"),
                  rendu: (i) => <Link href={hrefItemBanque(i.id)}>{i.code}</Link>,
                },
                { cle: "intitule", entete: t("Pratique", "Practice") },
                {
                  cle: "dimension",
                  entete: t("Dimension", "Dimension"),
                  rendu: (i) => libelleDimensionBanque(i.dimension),
                },
                { cle: "version", entete: t("Version", "Version"), alignement: "droite" },
                {
                  cle: "statut",
                  entete: t("Statut", "Status"),
                  rendu: (i) => (
                    <BadgeStatut
                      tonalite={detailStatutItem(i.statut, langue)?.tonalite ?? "neutre"}
                    >
                      {detailStatutItem(i.statut, langue)?.libelle ??
                        t("Statut inconnu", "Unknown status")}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "version_validee",
                  entete: t("En service", "In use"),
                  rendu: (i) =>
                    i.version_validee
                      ? `${t("version", "version")} ${i.version_validee}`
                      : t("aucune", "none"),
                },
                {
                  cle: "modifie_le",
                  entete: t("Modifié le", "Modified on"),
                  rendu: (i) => formaterDate(i.modifie_le, "UTC", langue),
                },
              ]}
            />
            <PaginationCurseur
              hrefSuivante={
                r.donnees.curseur_suivant
                  ? `/notation/banque?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}${suite}`
                  : null
              }
              hrefDebut={curseur ? hrefListe : null}
              libelle={t("Pagination de la banque", "Bank pagination")}
            />
          </>
        )}
      </Carte>
    </div>
  );
}

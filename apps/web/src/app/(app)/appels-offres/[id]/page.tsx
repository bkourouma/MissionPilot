import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import type { Metadata } from "next";
import "../../../../components/appels-offres/appels-offres.css";
import { ActionsStatutAo } from "../../../../components/appels-offres/ActionsAo";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  droitsAppelsOffres,
  hrefFiche,
  hrefGoNoGo,
  hrefMatrice,
  hrefRetroplanning,
  libelleStatutAo,
  tonaliteStatutAo,
  type FicheDetail,
} from "../../../../lib/appels-offres";
import { exigerLectureAo } from "../../../../lib/appels-offres-serveur";
import { formaterDate, formaterDateHeure, formaterMontantMineur } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Appel d'offres", "Tender") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPOSANTES: [keyof FicheDetail["rapprochement"]["composantes"], string, string][] = [
  ["secteur", "Secteur", "Sector"],
  ["competences", "Compétences", "Skills"],
  ["references", "Références du secteur", "Sector references"],
  ["pays", "Références dans le pays", "References in the country"],
  ["bailleur", "Références du bailleur", "Donor references"],
];

/**
 * Fiche d'un appel d'offres (AO-01) : informations de l'avis, rapprochement calculé par le moteur
 * avec le profil du cabinet (compétences, secteurs, références), historique des statuts, accès au
 * go/no-go, à la matrice de conformité et au rétro-planning.
 */
export default async function PageFicheAo({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const session = await exigerLectureAo();
  const droits = droitsAppelsOffres(session.utilisateur.roles);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const r = await chargerServeur<FicheDetail>(`/api/appels-offres/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Appel d'offres", "Tender")}
          retour={{ href: "/appels-offres", libelle: t("Appels d'offres", "Tenders") }}
        />
        <EtatErreur
          titre={t("La fiche n'a pas pu être chargée.", "The record could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefFiche(id)}
        />
      </div>
    );
  }
  const f = r.donnees;
  const rap = f.rapprochement;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={f.titre}
        retour={{ href: "/appels-offres", libelle: t("Appels d'offres", "Tenders") }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut, langue)}
          </BadgeStatut>
        }
        actions={
          <>
            <Link href={hrefGoNoGo(f.id)} className="mp-lien-ligne">
              Go/no-go
            </Link>
            <Link href={hrefMatrice(f.id)} className="mp-lien-ligne">
              {t("Matrice de conformité", "Compliance matrix")}
            </Link>
            <Link href={hrefRetroplanning(f.id)} className="mp-lien-ligne">
              {t("Rétro-planning", "Backward schedule")}
            </Link>
          </>
        }
      />

      {droits.gerer ? <ActionsStatutAo id={f.id} statut={f.statut} /> : null}

      <div className="mp-grille-cartes">
        <Carte titre={t("Avis", "Notice")}>
          <dl className="mp-ao__definition">
            <dt>{t("Référence", "Reference")}</dt>
            <dd>{f.reference ?? "—"}</dd>
            <dt>{t("Bailleur", "Donor")}</dt>
            <dd>{f.bailleur ?? "—"}</dd>
            <dt>{t("Pays · secteur", "Country · sector")}</dt>
            <dd>{[f.pays, f.secteur].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>{t("Montant estimé", "Estimated amount")}</dt>
            <dd>
              {f.montant_estime === null
                ? "—"
                : formaterMontantMineur(f.montant_estime, f.devise, langue)}
            </dd>
            <dt>{t("Date limite", "Deadline")}</dt>
            <dd>{f.date_limite ? formaterDate(f.date_limite, "UTC", langue) : "—"}</dd>
            <dt>Source</dt>
            <dd>
              {f.source === "import" ? t("Import", "Import") : t("Saisie", "Manual entry")}
              {f.source_libelle ? ` · ${f.source_libelle}` : ""}
            </dd>
            <dt>{t("Responsable", "Owner")}</dt>
            <dd>{f.responsable_nom ?? "—"}</dd>
            <dt>{t("Avis en ligne", "Online notice")}</dt>
            <dd>
              {f.url ? (
                <a
                  href={f.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                  className="mp-lien-ligne"
                >
                  {t("Ouvrir l'avis", "Open the notice")}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          {f.objet ? <p className="mp-texte-preserve">{f.objet}</p> : null}
        </Carte>

        <Carte titre={t(`Rapprochement : ${rap.score}/100`, `Match: ${rap.score}/100`)}>
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Score déterministe calculé avec les compétences, secteurs et références du cabinet.",
              "Deterministic score computed from the firm's skills, sectors and references.",
            )}
          </p>
          <dl className="mp-ao__definition">
            {COMPOSANTES.map(([cle, libelleFr, libelleEn]) => (
              <Fragment key={cle}>
                <dt>{t(libelleFr, libelleEn)}</dt>
                <dd>{rap.composantes[cle]}/100</dd>
              </Fragment>
            ))}
            <dt>{t("Compétences retrouvées", "Skills found")}</dt>
            <dd>{rap.competencesTrouvees.join(", ") || t("aucune", "none")}</dd>
            <dt>{t("Références", "References")}</dt>
            <dd>
              {t(
                `${rap.referencesSecteur} du secteur, ${rap.referencesPays} du pays, ${rap.referencesBailleur} du bailleur`,
                `${rap.referencesSecteur} in the sector, ${rap.referencesPays} in the country, ${rap.referencesBailleur} with the donor`,
              )}
            </dd>
          </dl>
        </Carte>
      </div>

      <Carte titre={t("Historique", "History")}>
        <ul className="mp-liste-lignes">
          {f.evenements.map((e) => (
            <li key={e.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <span>
                  {e.de_statut ? `${libelleStatutAo(e.de_statut, langue)} → ` : ""}
                  {libelleStatutAo(e.vers_statut, langue)}
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  {e.auteur_nom} · {formaterDateHeure(e.cree_le, undefined, langue)}
                  {e.motif ? ` · ${e.motif}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}

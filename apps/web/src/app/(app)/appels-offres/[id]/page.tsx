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

export const metadata: Metadata = { title: "Appel d'offres" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPOSANTES: [keyof FicheDetail["rapprochement"]["composantes"], string][] = [
  ["secteur", "Secteur"],
  ["competences", "Compétences"],
  ["references", "Références du secteur"],
  ["pays", "Références dans le pays"],
  ["bailleur", "Références du bailleur"],
];

/**
 * Fiche d'un appel d'offres (AO-01) : informations de l'avis, rapprochement calculé par le moteur
 * avec le profil du cabinet (compétences, secteurs, références), historique des statuts, accès au
 * go/no-go, à la matrice de conformité et au rétro-planning.
 */
export default async function PageFicheAo({ params }: { params: Promise<{ id: string }> }) {
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
          titre="Appel d'offres"
          retour={{ href: "/appels-offres", libelle: "Appels d'offres" }}
        />
        <EtatErreur
          titre="La fiche n'a pas pu être chargée."
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
        retour={{ href: "/appels-offres", libelle: "Appels d'offres" }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut)}
          </BadgeStatut>
        }
        actions={
          <>
            <Link href={hrefGoNoGo(f.id)} className="mp-lien-ligne">
              Go/no-go
            </Link>
            <Link href={hrefMatrice(f.id)} className="mp-lien-ligne">
              Matrice de conformité
            </Link>
            <Link href={hrefRetroplanning(f.id)} className="mp-lien-ligne">
              Rétro-planning
            </Link>
          </>
        }
      />

      {droits.gerer ? <ActionsStatutAo id={f.id} statut={f.statut} /> : null}

      <div className="mp-grille-cartes">
        <Carte titre="Avis">
          <dl className="mp-ao__definition">
            <dt>Référence</dt>
            <dd>{f.reference ?? "—"}</dd>
            <dt>Bailleur</dt>
            <dd>{f.bailleur ?? "—"}</dd>
            <dt>Pays · secteur</dt>
            <dd>{[f.pays, f.secteur].filter(Boolean).join(" · ") || "—"}</dd>
            <dt>Montant estimé</dt>
            <dd>
              {f.montant_estime === null ? "—" : formaterMontantMineur(f.montant_estime, f.devise)}
            </dd>
            <dt>Date limite</dt>
            <dd>{f.date_limite ? formaterDate(f.date_limite) : "—"}</dd>
            <dt>Source</dt>
            <dd>
              {f.source === "import" ? "Import" : "Saisie"}
              {f.source_libelle ? ` · ${f.source_libelle}` : ""}
            </dd>
            <dt>Responsable</dt>
            <dd>{f.responsable_nom ?? "—"}</dd>
            <dt>Avis en ligne</dt>
            <dd>
              {f.url ? (
                <a
                  href={f.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                  className="mp-lien-ligne"
                >
                  Ouvrir l&apos;avis
                </a>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          {f.objet ? <p className="mp-texte-preserve">{f.objet}</p> : null}
        </Carte>

        <Carte titre={`Rapprochement : ${rap.score}/100`}>
          <p className="mp-texte-doux mp-texte-petit">
            Score déterministe calculé avec les compétences, secteurs et références du cabinet.
          </p>
          <dl className="mp-ao__definition">
            {COMPOSANTES.map(([cle, libelle]) => (
              <Fragment key={cle}>
                <dt>{libelle}</dt>
                <dd>{rap.composantes[cle]}/100</dd>
              </Fragment>
            ))}
            <dt>Compétences retrouvées</dt>
            <dd>{rap.competencesTrouvees.join(", ") || "aucune"}</dd>
            <dt>Références</dt>
            <dd>
              {rap.referencesSecteur} du secteur, {rap.referencesPays} du pays,{" "}
              {rap.referencesBailleur} du bailleur
            </dd>
          </dl>
        </Carte>
      </div>

      <Carte titre="Historique">
        <ul className="mp-liste-lignes">
          {f.evenements.map((e) => (
            <li key={e.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <span>
                  {e.de_statut ? `${libelleStatutAo(e.de_statut)} → ` : ""}
                  {libelleStatutAo(e.vers_statut)}
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  {e.auteur_nom} · {formaterDateHeure(e.cree_le)}
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

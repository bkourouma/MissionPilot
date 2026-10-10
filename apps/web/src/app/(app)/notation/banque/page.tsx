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
import {
  HREF_NOUVEL_ITEM,
  STATUTS_ITEM,
  cheminBanque,
  hrefItemBanque,
  lireStatutBanque,
  type ElementBanque,
  type Page,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Banque d'items de notation" };

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
        titre="Banque d'items"
        soustitre="Pratiques évaluées, échelles à ancrages comportementaux et formulations par public. Seuls les items validés servent aux questionnaires adaptatifs."
        actions={
          <Link href={HREF_NOUVEL_ITEM} className={classesBouton("primaire")}>
            Nouvel item
          </Link>
        }
      />
      <nav aria-label="Filtrer par statut">
        <p>
          Filtrer : <Link href="/notation/banque">tous</Link> ·{" "}
          <Link href="/notation/banque?statut=valide">validés</Link> ·{" "}
          <Link href="/notation/banque?statut=brouillon">brouillons</Link>
        </p>
      </nav>
      <Carte titre="Items">
        {!r.ok ? (
          <EtatErreur
            titre="La banque n'a pas pu être chargée."
            message={r.message}
            hrefReessayer={hrefListe}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              statut
                ? `Aucun item ${statut === "valide" ? "validé" : "en brouillon"}.`
                : "Aucun item dans la banque."
            }
            icone="info"
            action={
              <Link href={HREF_NOUVEL_ITEM} className={classesBouton("primaire")}>
                Rédiger un item
              </Link>
            }
          >
            <p>Les items se rédigent en brouillon puis sont validés par un expert métier.</p>
          </EtatVide>
        ) : (
          <>
            <Tableau
              legende="Items de la banque"
              cleLigne={(i) => i.id}
              lignes={r.donnees.elements}
              colonnes={[
                {
                  cle: "code",
                  entete: "Code",
                  rendu: (i) => <Link href={hrefItemBanque(i.id)}>{i.code}</Link>,
                },
                { cle: "intitule", entete: "Pratique" },
                {
                  cle: "dimension",
                  entete: "Dimension",
                  rendu: (i) => libelleDimensionBanque(i.dimension),
                },
                { cle: "version", entete: "Version", alignement: "droite" },
                {
                  cle: "statut",
                  entete: "Statut",
                  rendu: (i) => (
                    <BadgeStatut tonalite={STATUTS_ITEM[i.statut]?.tonalite ?? "neutre"}>
                      {STATUTS_ITEM[i.statut]?.libelle ?? "Statut inconnu"}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "version_validee",
                  entete: "En service",
                  rendu: (i) => (i.version_validee ? `version ${i.version_validee}` : "aucune"),
                },
                {
                  cle: "modifie_le",
                  entete: "Modifié le",
                  rendu: (i) => formaterDate(i.modifie_le),
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
              libelle="Pagination de la banque"
            />
          </>
        )}
      </Carte>
    </div>
  );
}

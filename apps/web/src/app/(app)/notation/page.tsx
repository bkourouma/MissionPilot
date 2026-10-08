import Link from "next/link";
import type { Metadata } from "next";
import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import { FormulaireCreationGrille } from "../../../components/notation/FormulaireCreationGrille";
import { PonderationsGrille } from "../../../components/notation/PonderationsGrille";
import "../../../components/notation/notation.css";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { libelleFamille } from "../../../lib/notation";
import {
  cheminGrilles,
  hrefGrille,
  hrefGrilles,
  libelleOrigine,
  lireCurseurGrilles,
  type PageGrilles,
} from "../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Grilles de notation" };

/**
 * Grilles de notation du cabinet (NOT-01) : la grille générique MissionPilot (base par défaut
 * du calcul), les grilles du cabinet et leurs versions, la création par copie. La rédaction
 * est ouverte à qui gère ou publie les notations ; la validation revient à un expert métier.
 */
export default async function PageGrillesNotation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerLectureNotation();
  const curseur = lireCurseurGrilles((await searchParams).curseur);
  const r = await chargerServeur<PageGrilles>(cheminGrilles(curseur));
  const familles = [...new Set(GRILLE_GENERIQUE.dimensions.map((d) => d.famille))];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Grilles de notation"
        soustitre="Dimensions, familles et pondérations par secteur qui servent au calcul des notations. Une grille du cabinet ne sert qu'une fois validée par un expert métier."
      />

      <Carte titre="Grille générique MissionPilot">
        <div className="mp-notation__section">
          <p>
            Grille propre fondée sur des principes publics de gestion :{" "}
            {GRILLE_GENERIQUE.dimensions.length} dimensions en {familles.length} familles (
            {familles.map(libelleFamille).join(", ")}) et {(GRILLE_GENERIQUE.secteurs ?? []).length}{" "}
            pondérations par secteur. Elle sert par défaut au calcul ; pour l&apos;affiner, créez-en
            une copie ci-dessous.
          </p>
          <details className="mp-details">
            <summary>Voir les pondérations de la grille générique</summary>
            <PonderationsGrille contenu={GRILLE_GENERIQUE} />
          </details>
        </div>
      </Carte>

      <Carte titre="Créer une grille du cabinet">
        <FormulaireCreationGrille
          grilles={
            r.ok ? r.donnees.elements.map((g) => ({ id: g.id, titre: g.titre, code: g.code })) : []
          }
        />
      </Carte>

      <section aria-labelledby="titre-grilles" className="mp-pile">
        <h2 id="titre-grilles" className="mp-section__titre">
          Grilles du cabinet
        </h2>
        {!r.ok ? (
          <EtatErreur
            titre="Les grilles n'ont pas pu être chargées."
            message={r.message}
            hrefReessayer={hrefGrilles(curseur)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={curseur ? "Aucune autre grille." : "Aucune grille propre au cabinet."}
            icone="livre"
          >
            <p>
              Le calcul utilise la grille générique. Créez une copie pour adapter les pondérations à
              vos secteurs, puis faites-la valider par un expert métier.
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((g) => (
              <li key={g.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefGrille(g.id)} className="mp-lien-ligne">
                    {g.titre}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    Code {g.code} · {libelleOrigine(g.origine)} · modifiée le{" "}
                    {formaterDate(g.modifie_le)}
                  </span>
                </div>
                <div className="mp-badges">
                  {g.version_validee_id ? (
                    <BadgeStatut tonalite="succes">Version validée</BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="attention">Aucune version validée</BadgeStatut>
                  )}
                  {g.brouillon ? (
                    <BadgeStatut tonalite="neutre">Brouillon en cours</BadgeStatut>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {r.ok ? (
          <PaginationCurseur
            libelle="Pages des grilles"
            hrefSuivante={r.donnees.curseur_suivant ? hrefGrilles(r.donnees.curseur_suivant) : null}
            hrefDebut={curseur ? hrefGrilles() : null}
          />
        ) : null}
      </section>
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import { FormulaireCreationGrille } from "../../../components/notation/FormulaireCreationGrille";
import { PonderationsGrille } from "../../../components/notation/PonderationsGrille";
import "../../../components/notation/notation.css";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { libelleFamille, peutLireNotation } from "../../../lib/notation";
import {
  cheminGrilles,
  hrefGrille,
  hrefGrilles,
  libelleOrigine,
  lireCurseurGrilles,
  type PageGrilles,
} from "../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Grilles de notation", "Rating frameworks") };
}

/**
 * Grilles de notation du cabinet (NOT-01) : la grille générique CabinetPilot (base par défaut
 * du calcul), les grilles du cabinet et leurs versions, la création par copie. La rédaction
 * est ouverte à qui gère ou publie les notations ; la validation revient à un expert métier.
 */
export default async function PageGrillesNotation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerLectureNotation();
  // Les écrans liés ont la même garde (lecture des notations) : lien affiché seulement si permis.
  const voirBanqueEtCalibration = peutLireNotation(utilisateur.roles);
  const curseur = lireCurseurGrilles((await searchParams).curseur);
  const r = await chargerServeur<PageGrilles>(cheminGrilles(curseur));
  const familles = [...new Set(GRILLE_GENERIQUE.dimensions.map((d) => d.famille))];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Grilles de notation", "Rating frameworks")}
        soustitre={t(
          "Dimensions, familles et pondérations par secteur qui servent au calcul des notations. Une grille du cabinet ne sert qu'une fois validée par un expert métier.",
          "Dimensions, families and sector weightings used to compute ratings. A firm framework is used only once approved by a business expert.",
        )}
        actions={
          voirBanqueEtCalibration ? (
            <>
              <Link href="/notation/banque" className={classesBouton("secondaire")}>
                {t("Banque d'items", "Item bank")}
              </Link>
              <Link href="/notation/calibrations" className={classesBouton("secondaire")}>
                {t("Calibration des évaluateurs", "Rater calibration")}
              </Link>
            </>
          ) : undefined
        }
      />

      <Carte titre={t("Grille générique CabinetPilot", "CabinetPilot generic framework")}>
        <div className="mp-notation__section">
          <p>
            {t(
              `Grille propre fondée sur des principes publics de gestion : ${GRILLE_GENERIQUE.dimensions.length} dimensions en ${familles.length} familles (${familles.map((f) => libelleFamille(f, langue)).join(", ")}) et ${(GRILLE_GENERIQUE.secteurs ?? []).length} pondérations par secteur. Elle sert par défaut au calcul ; pour l'affiner, créez-en une copie ci-dessous.`,
              `Proprietary framework based on public management principles: ${GRILLE_GENERIQUE.dimensions.length} dimensions in ${familles.length} families (${familles.map((f) => libelleFamille(f, langue)).join(", ")}) and ${(GRILLE_GENERIQUE.secteurs ?? []).length} sector weightings. It is used by default for computation; to refine it, create a copy below.`,
            )}
          </p>
          <details className="mp-details">
            <summary>
              {t(
                "Voir les pondérations de la grille générique",
                "View the generic framework weightings",
              )}
            </summary>
            <PonderationsGrille contenu={GRILLE_GENERIQUE} />
          </details>
        </div>
      </Carte>

      <Carte titre={t("Créer une grille du cabinet", "Create a firm framework")}>
        <FormulaireCreationGrille
          grilles={
            r.ok ? r.donnees.elements.map((g) => ({ id: g.id, titre: g.titre, code: g.code })) : []
          }
        />
      </Carte>

      <section aria-labelledby="titre-grilles" className="mp-pile">
        <h2 id="titre-grilles" className="mp-section__titre">
          {t("Grilles du cabinet", "Firm frameworks")}
        </h2>
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les grilles n'ont pas pu être chargées.",
              "The frameworks could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefGrilles(curseur)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              curseur
                ? t("Aucune autre grille.", "No other framework.")
                : t("Aucune grille propre au cabinet.", "No firm-specific framework.")
            }
            icone="livre"
          >
            <p>
              {t(
                "Le calcul utilise la grille générique. Créez une copie pour adapter les pondérations à vos secteurs, puis faites-la valider par un expert métier.",
                "The computation uses the generic framework. Create a copy to adapt the weightings to your sectors, then have it approved by a business expert.",
              )}
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
                    {t("Code", "Code")} {g.code} · {libelleOrigine(g.origine, langue)} ·{" "}
                    {t("modifiée le", "modified on")} {formaterDate(g.modifie_le, "UTC", langue)}
                  </span>
                </div>
                <div className="mp-badges">
                  {g.version_validee_id ? (
                    <BadgeStatut tonalite="succes">
                      {t("Version validée", "Approved version")}
                    </BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="attention">
                      {t("Aucune version validée", "No approved version")}
                    </BadgeStatut>
                  )}
                  {g.brouillon ? (
                    <BadgeStatut tonalite="neutre">
                      {t("Brouillon en cours", "Draft in progress")}
                    </BadgeStatut>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {r.ok ? (
          <PaginationCurseur
            libelle={t("Pages des grilles", "Framework pages")}
            hrefSuivante={r.donnees.curseur_suivant ? hrefGrilles(r.donnees.curseur_suivant) : null}
            hrefDebut={curseur ? hrefGrilles() : null}
          />
        ) : null}
      </section>
    </div>
  );
}

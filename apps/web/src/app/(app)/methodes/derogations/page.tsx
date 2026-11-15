import Link from "next/link";
import type { Metadata } from "next";
import { STATUTS_DEROGATION, type StatutDerogation } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  hrefMissionMethode,
  libelleNature,
  libelleStatutDerogation,
  lireCurseur,
  STATUT_DEROGATION,
  type Derogation,
} from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Dérogations", "Waivers") };
}

interface PageDerogations {
  elements: Derogation[];
  curseur_suivant: string | null;
  compteurs: Record<StatutDerogation, number>;
}

function href(statut: StatutDerogation | null, curseur?: string | null) {
  const p = new URLSearchParams();
  if (statut) p.set("statut", statut);
  if (curseur) p.set("curseur", curseur);
  const q = p.toString();
  return q ? `/methodes/derogations?${q}` : "/methodes/derogations";
}

/** Tableau de bord des dérogations (STD-07) : missions visibles, par statut. */
export default async function PageDerogations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const sp = await searchParams;
  const statut = (STATUTS_DEROGATION as readonly string[]).includes(String(sp.statut))
    ? (sp.statut as StatutDerogation)
    : null;
  const curseur = lireCurseur(sp.curseur);
  const q = new URLSearchParams({ limite: "30" });
  if (statut) q.set("statut", statut);
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<PageDerogations>(`/api/derogations?${q.toString()}`);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Dérogations", "Waivers")}
        soustitre={t(
          "Exceptions motivées à la méthode des missions, approuvées selon la classe de risque de la brique. Leur analyse nourrit les évolutions du standard.",
          "Justified exceptions to the engagement method, approved according to the building block's risk class. Their analysis feeds changes to the standard.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les dérogations n'ont pas pu être chargées.",
            "The waivers could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={href(statut, curseur)}
        />
      ) : (
        <>
          <nav aria-label={t("Filtrer par statut", "Filter by status")} className="mp-badges">
            <Link href={href(null)} aria-current={statut === null ? "page" : undefined}>
              {t("Toutes", "All")}
            </Link>
            {STATUTS_DEROGATION.map((s) => (
              <Link key={s} href={href(s)} aria-current={statut === s ? "page" : undefined}>
                {libelleStatutDerogation(s, langue)} ({r.donnees.compteurs[s]})
              </Link>
            ))}
          </nav>
          {r.donnees.elements.length === 0 ? (
            <EtatVide titre={t("Aucune dérogation.", "No waiver.")} icone="drapeau" />
          ) : (
            <ul className="mp-liste-lignes">
              {r.donnees.elements.map((d) => (
                <li key={d.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <Link href={hrefMissionMethode(d.mission_id)} className="mp-lien-ligne">
                      {libelleNature(d.nature, langue)} — {d.brique_code}
                    </Link>
                    <span className="mp-texte-doux mp-texte-petit">
                      {d.mission_intitule} · {d.classe_risque} · {t("demandée le", "requested on")}{" "}
                      {formaterDate(d.cree_le, undefined, langue)}
                      {d.demandeur_nom
                        ? t(` par ${d.demandeur_nom}`, ` by ${d.demandeur_nom}`)
                        : ""}
                    </span>
                    <span>{d.motif}</span>
                  </div>
                  <BadgeStatut tonalite={STATUT_DEROGATION[d.statut].tonalite}>
                    {libelleStatutDerogation(d.statut, langue)}
                  </BadgeStatut>
                </li>
              ))}
            </ul>
          )}
          <PaginationCurseur
            libelle={t("Pages des dérogations", "Waiver pages")}
            hrefSuivante={
              r.donnees.curseur_suivant ? href(statut, r.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? href(statut) : null}
          />
        </>
      )}
    </div>
  );
}

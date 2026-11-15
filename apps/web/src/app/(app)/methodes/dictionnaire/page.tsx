import Link from "next/link";
import type { Metadata } from "next";
import { TAXONOMIE_LIBELLES, TAXONOMIES, type Taxonomie } from "@missionpilot/shared";
import { FormulaireFacteur } from "../../../../components/methodes/DictionnaireComiteFormulaires";
import { FormulaireModificationFacteur } from "../../../../components/methodes/FormulaireModificationFacteur";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterNombre } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { lireCurseur, peutGerer, type Facteur } from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Dictionnaire de données", "Data dictionary") };
}

interface Entree {
  id: string;
  taxonomie: Taxonomie;
  code: string;
  libelle: string;
  parent_code: string | null;
  origine: "standard" | "cabinet";
}

const TYPES = {
  booleen: "oui / non",
  nombre: "nombre",
  enumeration: "une valeur",
  liste: "plusieurs valeurs",
};
const TYPES_EN = {
  booleen: "yes / no",
  nombre: "number",
  enumeration: "one value",
  liste: "several values",
};

function href(taxonomie: Taxonomie, curseur?: string | null) {
  return `/methodes/dictionnaire?taxonomie=${taxonomie}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
}

/** Dictionnaire de données (STD-10) et facteurs de contexte typés (STD-04). */
export default async function PageDictionnaire({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const sp = await searchParams;
  const taxonomie = (TAXONOMIES as readonly string[]).includes(String(sp.taxonomie))
    ? (sp.taxonomie as Taxonomie)
    : "secteur";
  const curseur = lireCurseur(sp.curseur);
  const gere = peutGerer(utilisateur.roles);
  const [f, tx] = await Promise.all([
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
    chargerServeur<{ elements: Entree[]; curseur_suivant: string | null }>(
      `/api/standard/taxonomies?taxonomie=${taxonomie}&limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
    ),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Dictionnaire de données", "Data dictionary")}
        soustitre={t(
          "Facteurs de contexte lus par les règles de modulation, et taxonomies partagées (secteurs CITI rév. 4, pays, tailles, fonctions, processus…).",
          "Context factors read by the modulation rules, and shared taxonomies (ISIC Rev. 4 sectors, countries, sizes, functions, processes…).",
        )}
      />
      <Carte titre={t("Facteurs de contexte", "Context factors")}>
        {!f.ok ? (
          <EtatErreur
            titre={t("Les facteurs n'ont pas pu être chargés.", "The factors could not be loaded.")}
            message={f.message}
            hrefReessayer="/methodes/dictionnaire"
          />
        ) : (
          <ul className="mp-liste-lignes">
            {f.donnees.elements.map((x) => (
              <li key={x.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>{x.libelle}</strong>
                  <span className="mp-texte-doux mp-texte-petit">
                    {x.code} · {(langue === "en" ? TYPES_EN : TYPES)[x.type]} ·{" "}
                    {t("porté par", "carried by")}{" "}
                    {x.porte_par === "dossier"
                      ? t("le dossier client", "the client file")
                      : t("la mission", "the engagement")}
                    {x.min !== null || x.max !== null
                      ? t(
                          ` · de ${x.min === null ? "—" : formaterNombre(x.min, 2, langue)} à ${x.max === null ? "—" : formaterNombre(x.max, 2, langue)}`,
                          ` · from ${x.min === null ? "—" : formaterNombre(x.min, 2, langue)} to ${x.max === null ? "—" : formaterNombre(x.max, 2, langue)}`,
                        )
                      : ""}
                  </span>
                  {x.valeurs ? <span>{x.valeurs.map((v) => v.libelle).join(", ")}</span> : null}
                  {x.description ? <span>{x.description}</span> : null}
                  {x.origine === "standard" ? (
                    <span className="mp-texte-doux mp-texte-petit">
                      {t(
                        "Facteur du standard CabinetPilot : en lecture seule. Pour en tenir compte autrement, ajoutez un facteur propre au cabinet.",
                        "CabinetPilot standard factor: read-only. To account for it differently, add a firm-specific factor.",
                      )}
                    </span>
                  ) : gere ? (
                    <details className="mp-details">
                      <summary>{t("Modifier ce facteur", "Edit this factor")}</summary>
                      <FormulaireModificationFacteur facteur={x} />
                    </details>
                  ) : null}
                </div>
                <BadgeStatut tonalite={x.origine === "standard" ? "neutre" : "succes"}>
                  {x.origine === "standard" ? t("Standard", "Standard") : t("Cabinet", "Firm")}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </Carte>
      {gere ? (
        <Carte titre={t("Ajouter un facteur du cabinet", "Add a firm factor")}>
          <FormulaireFacteur />
        </Carte>
      ) : null}

      <section aria-labelledby="titre-taxonomies" className="mp-pile">
        <h2 id="titre-taxonomies" className="mp-section__titre">
          {t("Taxonomies", "Taxonomies")}
        </h2>
        <nav aria-label={t("Taxonomie", "Taxonomy")} className="mp-badges">
          {TAXONOMIES.map((x) => (
            <Link key={x} href={href(x)} aria-current={x === taxonomie ? "page" : undefined}>
              {TAXONOMIE_LIBELLES[x]}
            </Link>
          ))}
        </nav>
        {!tx.ok ? (
          <EtatErreur
            titre={t("La taxonomie n'a pas pu être chargée.", "The taxonomy could not be loaded.")}
            message={tx.message}
            hrefReessayer={href(taxonomie, curseur)}
          />
        ) : tx.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucune entrée.", "No entry.")} icone="livre" />
        ) : (
          <ul className="mp-liste-simple">
            {tx.donnees.elements.map((e) => (
              <li key={e.id}>
                {e.libelle}{" "}
                <span className="mp-methode__code">
                  ({e.code}
                  {e.parent_code ? ` · ${e.parent_code}` : ""})
                </span>
                {e.origine === "cabinet" ? t(" · cabinet", " · firm") : ""}
              </li>
            ))}
          </ul>
        )}
        {tx.ok ? (
          <PaginationCurseur
            libelle={t("Pages de la taxonomie", "Taxonomy pages")}
            hrefSuivante={
              tx.donnees.curseur_suivant ? href(taxonomie, tx.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? href(taxonomie) : null}
          />
        ) : null}
      </section>
    </div>
  );
}

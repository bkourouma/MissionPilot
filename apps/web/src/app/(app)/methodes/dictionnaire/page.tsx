import Link from "next/link";
import type { Metadata } from "next";
import { TAXONOMIE_LIBELLES, TAXONOMIES, type Taxonomie } from "@missionpilot/shared";
import { FormulaireFacteur } from "../../../../components/methodes/DictionnaireComiteFormulaires";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterNombre } from "../../../../lib/format";
import { lireCurseur, peutGerer, type Facteur } from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Dictionnaire de données" };

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
  const sp = await searchParams;
  const taxonomie = (TAXONOMIES as readonly string[]).includes(String(sp.taxonomie))
    ? (sp.taxonomie as Taxonomie)
    : "secteur";
  const curseur = lireCurseur(sp.curseur);
  const [f, t] = await Promise.all([
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
    chargerServeur<{ elements: Entree[]; curseur_suivant: string | null }>(
      `/api/standard/taxonomies?taxonomie=${taxonomie}&limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
    ),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Dictionnaire de données"
        soustitre="Facteurs de contexte lus par les règles de modulation, et taxonomies partagées (secteurs CITI rév. 4, pays, tailles, fonctions, processus…)."
      />
      <Carte titre="Facteurs de contexte">
        {!f.ok ? (
          <EtatErreur
            titre="Les facteurs n'ont pas pu être chargés."
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
                    {x.code} · {TYPES[x.type]} · porté par{" "}
                    {x.porte_par === "dossier" ? "le dossier client" : "la mission"}
                    {x.min !== null || x.max !== null
                      ? ` · de ${x.min === null ? "—" : formaterNombre(x.min)} à ${x.max === null ? "—" : formaterNombre(x.max)}`
                      : ""}
                  </span>
                  {x.valeurs ? <span>{x.valeurs.map((v) => v.libelle).join(", ")}</span> : null}
                </div>
                <BadgeStatut tonalite={x.origine === "standard" ? "neutre" : "succes"}>
                  {x.origine === "standard" ? "Standard" : "Cabinet"}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </Carte>
      {peutGerer(utilisateur.roles) ? (
        <Carte titre="Ajouter un facteur du cabinet">
          <FormulaireFacteur />
        </Carte>
      ) : null}

      <section aria-labelledby="titre-taxonomies" className="mp-pile">
        <h2 id="titre-taxonomies" className="mp-section__titre">
          Taxonomies
        </h2>
        <nav aria-label="Taxonomie" className="mp-badges">
          {TAXONOMIES.map((x) => (
            <Link key={x} href={href(x)} aria-current={x === taxonomie ? "page" : undefined}>
              {TAXONOMIE_LIBELLES[x]}
            </Link>
          ))}
        </nav>
        {!t.ok ? (
          <EtatErreur
            titre="La taxonomie n'a pas pu être chargée."
            message={t.message}
            hrefReessayer={href(taxonomie, curseur)}
          />
        ) : t.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune entrée." icone="livre" />
        ) : (
          <ul className="mp-liste-simple">
            {t.donnees.elements.map((e) => (
              <li key={e.id}>
                {e.libelle}{" "}
                <span className="mp-methode__code">
                  ({e.code}
                  {e.parent_code ? ` · ${e.parent_code}` : ""})
                </span>
                {e.origine === "cabinet" ? " · cabinet" : ""}
              </li>
            ))}
          </ul>
        )}
        {t.ok ? (
          <PaginationCurseur
            libelle="Pages de la taxonomie"
            hrefSuivante={
              t.donnees.curseur_suivant ? href(taxonomie, t.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? href(taxonomie) : null}
          />
        ) : null}
      </section>
    </div>
  );
}

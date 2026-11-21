import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { T } from "../i18n/T";
import { Icone } from "./Icone";
import { SqueletteTableau } from "./SqueletteTableau";
import {
  ariaSort,
  classeAlignement,
  classes,
  type AlignementColonne,
  type SensTri,
} from "./Tableau.tri";

export interface TriColonne {
  /** Sens actuel de cette colonne (`null` : colonne non triée). */
  sens: SensTri | null;
  /** Lien du prochain clic ; voir `hrefTri` (Tableau.tri.ts) qui applique asc, desc, aucun. */
  href: string;
}

export interface ColonneTableau<T> {
  cle: string;
  entete: string;
  /** Contenu de la cellule ; par défaut `String(ligne[cle])`. */
  rendu?: (ligne: T) => ReactNode;
  /** Les montants et quantités s'alignent à droite ; `centre` pour les marques et les états. */
  alignement?: AlignementColonne;
  /**
   * Colonne triable : l'en-tête devient un lien (cible 44 px, icône de sens, `aria-sort`).
   * L'état de tri vit dans l'URL, comme la pagination.
   */
  tri?: TriColonne;
}

export interface TableauProps<T> {
  /** Titre du tableau, annoncé aux lecteurs d'écran (caption). */
  legende: string;
  /** Afficher la légende à l'écran (sinon seulement aux lecteurs d'écran). */
  legendeVisible?: boolean;
  colonnes: readonly ColonneTableau<T>[];
  lignes: readonly T[];
  cleLigne: (ligne: T) => string;
  /** Texte (ou contenu) quand `lignes` est vide. */
  messageVide?: ReactNode;
  /** Action proposée sous le message de vide (ex. bouton « Créer un client »). */
  actionVide?: ReactNode;
  /** En-tête collant : le tableau défile dans sa hauteur maximale (`hauteurMax`). */
  enteteFixe?: boolean;
  /** Hauteur maximale du conteneur défilant avec `enteteFixe` (CSS, défaut `70vh`). */
  hauteurMax?: string;
  /** Lignes plus serrées (tableaux de saisie ou de chiffres denses). */
  dense?: boolean;
  /** Totaux : contenu du pied par `cle` de colonne (colonne absente : cellule vide). */
  pied?: Readonly<Record<string, ReactNode>>;
  /** Classes ajoutées à une ligne (ex. surbrillance d'une ligne en alerte). */
  classeLigne?: (ligne: T) => string | undefined;
  /**
   * Téléphone : la première cellule devient le titre de la fiche, sans intitulé de colonne
   * (les autres cellules gardent leur intitulé).
   */
  ficheTitre?: boolean;
  /** Affiche des lignes squelettes à la place des données. */
  chargement?: boolean;
  /** Nombre de lignes squelettes en `chargement` (défaut 5). */
  lignesChargement?: number;
}

function valeurParDefaut<T>(ligne: T, cle: string): ReactNode {
  const v = (ligne as Record<string, unknown>)[cle];
  return v == null ? "—" : String(v);
}

/** Icône de sens : flèche haut (croissant), bas (décroissant), double chevron (non trié). */
function IconeSens({ sens }: { sens: SensTri | null }) {
  if (sens === "asc") return <Icone nom="flecheHaut" taille={16} className="mp-tableau__sens" />;
  if (sens === "desc") return <Icone nom="flecheBas" taille={16} className="mp-tableau__sens" />;
  return (
    <svg
      className="mp-tableau__sens mp-tableau__sens--neutre"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

function EnteteColonne<T>({ colonne }: { colonne: ColonneTableau<T> }) {
  const { tri } = colonne;
  return (
    <th
      scope="col"
      className={classes(classeAlignement(colonne.alignement), tri && "mp-tableau__th--tri")}
      aria-sort={tri ? ariaSort(tri.sens) : undefined}
    >
      {tri ? (
        <Link href={tri.href} className="mp-tableau__tri" prefetch={false}>
          <span>{colonne.entete}</span>
          <IconeSens sens={tri.sens} />
          <span className="mp-visuellement-cache">
            {tri.sens === "asc" ? (
              <T
                fr=" (tri croissant, activer pour inverser)"
                en=" (sorted ascending, activate to reverse)"
              />
            ) : tri.sens === "desc" ? (
              <T
                fr=" (tri décroissant, activer pour retirer)"
                en=" (sorted descending, activate to clear)"
              />
            ) : (
              <T fr=" (activer pour trier)" en=" (activate to sort)" />
            )}
          </span>
        </Link>
      ) : (
        colonne.entete
      )}
    </th>
  );
}

/**
 * Tableau de données. Composant serveur : les fonctions `rendu`, `cleLigne` et `classeLigne`
 * peuvent venir d'un Server Component (aucun état client). Le tri et la page vivent dans l'URL.
 *
 * Sur grand écran : tableau classique, défilant horizontalement si besoin (région focusable
 * étiquetée par `legende`, ombres de bord aux extrémités qui défilent). Sur téléphone
 * (< 640 px) : chaque ligne devient une fiche, chaque cellule précédée de l'intitulé de sa
 * colonne (`data-libelle`) ; avec `ficheTitre`, la première cellule est le titre de la fiche.
 *
 * Ligne entière cliquable : la cellule principale contient UN lien portant la classe
 * `mp-lien-etendu` ; sa zone de clic s'étend à toute la ligne (`tr` positionnée), qui prend la
 * teinte de survol (`--mp-survol-ligne`) au survol et au focus clavier. Les autres liens et
 * boutons de la ligne restent cliquables par-dessus. Exemple :
 * `rendu: (m) => <Link href={`/missions/${m.id}`} className="mp-lien-etendu">{m.nom}</Link>`.
 */
export function Tableau<T>({
  legende,
  legendeVisible = false,
  colonnes,
  lignes,
  cleLigne,
  messageVide,
  actionVide,
  enteteFixe = false,
  hauteurMax,
  dense = false,
  pied,
  classeLigne,
  ficheTitre = false,
  chargement = false,
  lignesChargement = 5,
}: TableauProps<T>) {
  if (chargement) {
    return (
      <SqueletteTableau
        colonnes={colonnes.length}
        lignes={lignesChargement}
        libelle={`${legende}…`}
      />
    );
  }
  if (lignes.length === 0) {
    return (
      <div className="mp-tableau__vide" role="status">
        <p className="mp-tableau__vide-texte">
          {messageVide ?? <T fr="Aucun élément à afficher." en="No items to display." />}
        </p>
        {actionVide ? <div className="mp-tableau__vide-action">{actionVide}</div> : null}
      </div>
    );
  }
  const avecTri = colonnes.some((c) => c.tri);
  const style =
    enteteFixe && hauteurMax
      ? ({ "--mp-tableau-hauteur": hauteurMax } as CSSProperties)
      : undefined;
  return (
    <div
      className={classes(
        "mp-tableau",
        "mp-tableau--socle",
        enteteFixe && "mp-tableau--fixe",
        dense && "mp-tableau--dense",
        ficheTitre && "mp-tableau--fiche-titre",
        avecTri && "mp-tableau--tri",
      )}
      role="region"
      aria-label={legende}
      tabIndex={0}
      style={style}
    >
      <table className="mp-tableau__table">
        <caption className={legendeVisible ? "mp-tableau__legende" : "mp-visuellement-cache"}>
          {legende}
        </caption>
        <thead>
          <tr>
            {colonnes.map((c) => (
              <EnteteColonne key={c.cle} colonne={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => (
            <tr key={cleLigne(ligne)} className={classeLigne?.(ligne) || undefined}>
              {colonnes.map((c) => (
                <td key={c.cle} data-libelle={c.entete} className={classeAlignement(c.alignement)}>
                  {c.rendu ? c.rendu(ligne) : valeurParDefaut(ligne, c.cle)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {pied ? (
          <tfoot>
            <tr className="mp-tableau__pied">
              {colonnes.map((c) => (
                <td key={c.cle} data-libelle={c.entete} className={classeAlignement(c.alignement)}>
                  {pied[c.cle] ?? null}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

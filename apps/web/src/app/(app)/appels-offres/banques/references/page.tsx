import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireReference } from "../../../../../components/banque-ao/FormulairesReferences";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { lireCurseur } from "../../../../../lib/agents";
import {
  droitsBanqueAo,
  hrefListe,
  libelleRoleReference,
  RACINE_BANQUES,
  requeteReferences,
  type FiltresReferences,
  type ReferenceResume,
} from "../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate, formaterMontantMineur } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Références", "References") };
}

type Parametres = Promise<Record<string, string | string[] | undefined>>;
const CLES = ["q", "secteur", "pays", "bailleur", "devise", "montant_min", "montant_max"] as const;

/** Banque de références (AO-05) : recherche par secteur, pays, bailleur et montant. */
export default async function PageReferences({ searchParams }: { searchParams: Parametres }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const p = await searchParams;
  const filtres: FiltresReferences = {};
  const base = new URLSearchParams();
  for (const cle of CLES) {
    const v = p[cle];
    if (typeof v === "string" && v.trim() !== "") {
      filtres[cle] = v.slice(0, 100);
      base.set(cle, filtres[cle] as string);
    }
  }
  const curseur = lireCurseur(p.curseur);
  const r = await chargerServeur<{ elements: ReferenceResume[]; curseur_suivant: string | null }>(
    requeteReferences(filtres, curseur),
  );
  const chemin = `${RACINE_BANQUES}/references`;
  const champ = (cle: (typeof CLES)[number], libelle: string, aide?: string) => (
    <label className="mp-champ">
      <span className="mp-champ__libelle">{libelle}</span>
      <input className="mp-champ__controle" name={cle} defaultValue={filtres[cle] ?? ""} />
      {aide ? <span className="mp-champ__aide">{aide}</span> : null}
    </label>
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Références et attestations", "References and certificates")}
        soustitre={t(
          "Missions réalisées et pièces de bonne exécution, à citer dans les offres. Un filtre de montant s'applique dans une seule devise.",
          "Completed engagements and performance certificates, to cite in bids. An amount filter applies in a single currency.",
        )}
      />
      <form className="mp-formulaire mp-grille-champs" method="get">
        {champ("q", t("Texte", "Text"))}
        {champ("secteur", t("Secteur", "Sector"))}
        {champ("pays", t("Pays", "Country"), t("Code à deux lettres.", "Two-letter code."))}
        {champ("bailleur", t("Bailleur", "Donor"))}
        {champ(
          "devise",
          t("Devise", "Currency"),
          t("XOF, XAF, EUR ou USD.", "XOF, XAF, EUR or USD."),
        )}
        {champ("montant_min", t("Montant minimal", "Minimum amount"))}
        {champ("montant_max", t("Montant maximal", "Maximum amount"))}
        <div className="mp-actions-formulaire">
          <button className={classesBouton("secondaire")} type="submit">
            {t("Rechercher", "Search")}
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre={t(
            "Les références n'ont pas pu être chargées.",
            "The references could not be loaded.",
          )}
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune référence ne correspond.", "No matching reference.")} />
      ) : (
        <>
          <Tableau
            legende={t("Références", "References")}
            cleLigne={(x) => x.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: t("Mission", "Engagement"),
                rendu: (x) => <Link href={`${chemin}/${x.id}`}>{x.titre}</Link>,
              },
              { cle: "client_nom", entete: t("Client", "Client") },
              { cle: "pays", entete: t("Pays", "Country") },
              { cle: "bailleur", entete: t("Bailleur", "Donor") },
              {
                cle: "montant",
                entete: t("Montant", "Amount"),
                alignement: "droite",
                rendu: (x) => formaterMontantMineur(x.montant, x.devise, langue),
              },
              {
                cle: "date_debut",
                entete: t("Début", "Start"),
                rendu: (x) => formaterDate(x.date_debut, "UTC", langue),
              },
              {
                cle: "role_cabinet",
                entete: t("Rôle", "Role"),
                rendu: (x) => libelleRoleReference(x.role_cabinet, langue),
              },
              { cle: "attestations", entete: t("Pièces", "Documents"), alignement: "droite" },
            ]}
          />
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant ? hrefListe(chemin, base, r.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? hrefListe(chemin, base, null) : null}
          />
        </>
      )}
      {droits.gerer ? (
        <Carte titre={t("Ajouter une référence", "Add a reference")}>
          <FormulaireReference />
        </Carte>
      ) : null}
    </div>
  );
}

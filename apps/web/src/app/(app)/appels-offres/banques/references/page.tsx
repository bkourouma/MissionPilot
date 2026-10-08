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
import { obtenirSession } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Références" };

type Parametres = Promise<Record<string, string | string[] | undefined>>;
const CLES = ["q", "secteur", "pays", "bailleur", "devise", "montant_min", "montant_max"] as const;

/** Banque de références (AO-05) : recherche par secteur, pays, bailleur et montant. */
export default async function PageReferences({ searchParams }: { searchParams: Parametres }) {
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
        titre="Références et attestations"
        soustitre="Missions réalisées et pièces de bonne exécution, à citer dans les offres. Un filtre de montant s'applique dans une seule devise."
      />
      <form className="mp-formulaire mp-grille-champs" method="get">
        {champ("q", "Texte")}
        {champ("secteur", "Secteur")}
        {champ("pays", "Pays", "Code à deux lettres.")}
        {champ("bailleur", "Bailleur")}
        {champ("devise", "Devise", "XOF, XAF, EUR ou USD.")}
        {champ("montant_min", "Montant minimal")}
        {champ("montant_max", "Montant maximal")}
        <div className="mp-actions-formulaire">
          <button className={classesBouton("secondaire")} type="submit">
            Rechercher
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre="Les références n'ont pas pu être chargées."
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune référence ne correspond." />
      ) : (
        <>
          <Tableau
            legende="Références"
            cleLigne={(x) => x.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: "Mission",
                rendu: (x) => <Link href={`${chemin}/${x.id}`}>{x.titre}</Link>,
              },
              { cle: "client_nom", entete: "Client" },
              { cle: "pays", entete: "Pays" },
              { cle: "bailleur", entete: "Bailleur" },
              {
                cle: "montant",
                entete: "Montant",
                alignement: "droite",
                rendu: (x) => formaterMontantMineur(x.montant, x.devise),
              },
              { cle: "date_debut", entete: "Début", rendu: (x) => formaterDate(x.date_debut) },
              {
                cle: "role_cabinet",
                entete: "Rôle",
                rendu: (x) => libelleRoleReference(x.role_cabinet),
              },
              { cle: "attestations", entete: "Pièces", alignement: "droite" },
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
        <Carte titre="Ajouter une référence">
          <FormulaireReference />
        </Carte>
      ) : null}
    </div>
  );
}

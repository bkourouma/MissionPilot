import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireCv } from "../../../../../components/banque-ao/FormulairesCv";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { lireCurseur } from "../../../../../lib/agents";
import {
  droitsBanqueAo,
  hrefListe,
  RACINE_BANQUES,
  type CvResume,
} from "../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirSession } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Banque de CV" };

type Parametres = Promise<Record<string, string | string[] | undefined>>;

const texte = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim().slice(0, 100) : "";

/** Banque de CV (AO-04) : recherche par nom, secteur et langue ; années calculées par l'API. */
export default async function PageCv({ searchParams }: { searchParams: Parametres }) {
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const p = await searchParams;
  const filtres = { q: texte(p.q), secteur: texte(p.secteur), langue: texte(p.langue) };
  const curseur = lireCurseur(p.curseur);
  const q = new URLSearchParams({ limite: "30" });
  for (const [cle, v] of Object.entries(filtres)) if (v) q.set(cle, v);
  const base = new URLSearchParams(q);
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<{ elements: CvResume[]; curseur_suivant: string | null }>(
    `/api/banque-ao/cv?${q}`,
  );
  base.delete("limite");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Banque de CV"
        soustitre="CV structurés et datés des experts du cabinet et des experts externes. Les années d'expérience sont calculées (mois distincts, années complètes) ; le contrôle des exigences d'un appel d'offres est déterministe."
      />
      <form className="mp-formulaire mp-grille-champs" method="get">
        <label className="mp-champ">
          <span className="mp-champ__libelle">Nom ou titre</span>
          <input className="mp-champ__controle" name="q" defaultValue={filtres.q} />
        </label>
        <label className="mp-champ">
          <span className="mp-champ__libelle">Secteur</span>
          <input className="mp-champ__controle" name="secteur" defaultValue={filtres.secteur} />
        </label>
        <label className="mp-champ">
          <span className="mp-champ__libelle">Langue</span>
          <input className="mp-champ__controle" name="langue" defaultValue={filtres.langue} />
        </label>
        <div className="mp-actions-formulaire">
          <button className={classesBouton("secondaire")} type="submit">
            Rechercher
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/cv`}
          titre="La banque de CV n'a pas pu être chargée."
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun CV ne correspond." />
      ) : (
        <>
          <Tableau
            legende="CV de la banque"
            cleLigne={(c) => c.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "nom",
                entete: "Expert",
                rendu: (c) => <Link href={`${RACINE_BANQUES}/cv/${c.id}`}>{c.nom}</Link>,
              },
              { cle: "titre", entete: "Titre" },
              { cle: "secteurs", entete: "Secteurs", rendu: (c) => c.secteurs.join(", ") },
              {
                cle: "annees_experience",
                entete: "Expérience",
                alignement: "droite",
                rendu: (c) => `${c.annees_experience} an(s)`,
              },
              { cle: "version", entete: "Version", alignement: "droite" },
            ]}
          />
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefListe(`${RACINE_BANQUES}/cv`, base, r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? hrefListe(`${RACINE_BANQUES}/cv`, base, null) : null}
          />
        </>
      )}
      {droits.gerer ? (
        <Carte titre="Ajouter un CV">
          <FormulaireCv />
        </Carte>
      ) : null}
    </div>
  );
}

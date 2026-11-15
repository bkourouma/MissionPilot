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
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Banque de CV", "CV bank") };
}

type Parametres = Promise<Record<string, string | string[] | undefined>>;

const texte = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim().slice(0, 100) : "";

/** Banque de CV (AO-04) : recherche par nom, secteur et langue ; années calculées par l'API. */
export default async function PageCv({ searchParams }: { searchParams: Parametres }) {
  const t = await obtenirT();
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
        titre={t("Banque de CV", "CV bank")}
        soustitre={t(
          "CV structurés et datés des experts du cabinet et des experts externes. Les années d'expérience sont calculées (mois distincts, années complètes) ; le contrôle des exigences d'un appel d'offres est déterministe.",
          "Structured, dated CVs of the firm's experts and external experts. Years of experience are computed (distinct months, full years); the check against a tender's requirements is deterministic.",
        )}
      />
      <form className="mp-formulaire mp-grille-champs" method="get">
        <label className="mp-champ">
          <span className="mp-champ__libelle">{t("Nom ou titre", "Name or title")}</span>
          <input className="mp-champ__controle" name="q" defaultValue={filtres.q} />
        </label>
        <label className="mp-champ">
          <span className="mp-champ__libelle">{t("Secteur", "Sector")}</span>
          <input className="mp-champ__controle" name="secteur" defaultValue={filtres.secteur} />
        </label>
        <label className="mp-champ">
          <span className="mp-champ__libelle">{t("Langue", "Language")}</span>
          <input className="mp-champ__controle" name="langue" defaultValue={filtres.langue} />
        </label>
        <div className="mp-actions-formulaire">
          <button className={classesBouton("secondaire")} type="submit">
            {t("Rechercher", "Search")}
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/cv`}
          titre={t("La banque de CV n'a pas pu être chargée.", "The CV bank could not be loaded.")}
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucun CV ne correspond.", "No matching CV.")} />
      ) : (
        <>
          <Tableau
            legende={t("CV de la banque", "CVs in the bank")}
            cleLigne={(c) => c.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "nom",
                entete: t("Expert", "Expert"),
                rendu: (c) => <Link href={`${RACINE_BANQUES}/cv/${c.id}`}>{c.nom}</Link>,
              },
              { cle: "titre", entete: t("Titre", "Title") },
              {
                cle: "secteurs",
                entete: t("Secteurs", "Sectors"),
                rendu: (c) => c.secteurs.join(", "),
              },
              {
                cle: "annees_experience",
                entete: t("Expérience", "Experience"),
                alignement: "droite",
                rendu: (c) => t(`${c.annees_experience} an(s)`, `${c.annees_experience} yr(s)`),
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
        <Carte titre={t("Ajouter un CV", "Add a CV")}>
          <FormulaireCv />
        </Carte>
      ) : null}
    </div>
  );
}

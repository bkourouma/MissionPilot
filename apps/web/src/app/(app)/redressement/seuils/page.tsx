import type { Metadata } from "next";
import {
  RED_CRITERES_ALERTE,
  RED_CRITERE_ALERTE_SENS,
  type RedSeuilsEtatVue,
  type RedSeuilsVersionVue,
} from "@missionpilot/shared";
import "../../../../components/redressement/redressement.css";
import { EditeurSeuils } from "../../../../components/redressement/EditeurSeuils";
import { VersionsSeuils } from "../../../../components/redressement/VersionsSeuils";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  AVERTISSEMENT_SEUILS_DEFAUT,
  AVERTISSEMENT_SEUILS_DEFAUT_EN,
  cheminSeuilsSecteur,
  formaterSeuil,
  hrefSeuilsSecteur,
  libelleCritere,
  libelleSensCritere,
  libelleSecteur,
  lireSecteur,
  optionsSecteurs,
  TEXTE_SEUILS_AUCUNE_VERSION,
  TEXTE_SEUILS_AUCUNE_VERSION_EN,
} from "../../../../lib/redressement";
import { aPermission } from "@missionpilot/shared";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Seuils d'alerte", "Alert thresholds") };
}

/**
 * Seuils d'alerte précoce par secteur : version en vigueur (ou valeurs par défaut du moteur,
 * provisoires), éditeur de brouillon et publication pour qui détient « paramétrer » (les experts
 * du cabinet), lecture seule sinon. Un score déjà calculé ne change jamais.
 */
export default async function PageSeuilsRedressement({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerPermission("redressement.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const secteur = lireSecteur((await searchParams).secteur);
  const peutParametrer = aPermission(session.utilisateur.roles, "redressement.parametrer");
  const r = await chargerServeur<RedSeuilsEtatVue>(cheminSeuilsSecteur(secteur));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Seuils d'alerte", "Alert thresholds")}
        soustitre={t(
          "Seuils et pondérations du score d'alerte précoce, par secteur d'activité.",
          "Thresholds and weightings of the early-warning score, by business sector.",
        )}
      />
      <div className="mp-red">
        <form
          method="get"
          action="/redressement/seuils"
          className="mp-filtres"
          aria-label={t("Choisir un secteur", "Choose a sector")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle={t("Secteur", "Sector")}
              name="secteur"
              defaultValue={secteur}
              options={optionsSecteurs(langue)}
            />
          </div>
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            {t("Afficher", "Show")}
          </button>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les seuils d'alerte n'ont pas pu être chargés.",
              "The alert thresholds could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefSeuilsSecteur(secteur)}
          />
        ) : (
          <Seuils etat={r.donnees} secteur={secteur} peutParametrer={peutParametrer} />
        )}
      </div>
    </div>
  );
}

async function Seuils({
  etat,
  secteur,
  peutParametrer,
}: {
  etat: RedSeuilsEtatVue;
  secteur: ReturnType<typeof lireSecteur>;
  peutParametrer: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const s = etat.secteurs.find((x) => x.secteur === secteur);
  const enVigueur = s?.en_vigueur ?? null;
  const brouillon = s?.brouillon ?? null;
  const valeurs = (enVigueur?.seuils ?? etat.defaut_moteur).criteres;
  const versions: RedSeuilsVersionVue[] = [
    ...(brouillon ? [brouillon] : []),
    ...(s?.historique ?? []).filter((v) => v.id !== brouillon?.id),
  ];
  return (
    <>
      <Carte
        titre={
          enVigueur
            ? t(
                `Secteur ${libelleSecteur(secteur)} : version ${enVigueur.version} en vigueur`,
                `Sector ${libelleSecteur(secteur, langue)}: version ${enVigueur.version} in force`,
              )
            : `${t("Secteur", "Sector")} ${libelleSecteur(secteur, langue)}`
        }
      >
        <div className="mp-red-carte-corps">
          {enVigueur === null ? (
            <Alerte tonalite="attention" annonce="aucune">
              <p>{t(TEXTE_SEUILS_AUCUNE_VERSION, TEXTE_SEUILS_AUCUNE_VERSION_EN)}</p>
              <p>{t(AVERTISSEMENT_SEUILS_DEFAUT, AVERTISSEMENT_SEUILS_DEFAUT_EN)}</p>
            </Alerte>
          ) : null}
          <Tableau
            legende={t("Seuils en vigueur par critère", "Thresholds in force by criterion")}
            colonnes={[
              {
                cle: "critere",
                entete: t("Critère", "Criterion"),
                rendu: (c: (typeof RED_CRITERES_ALERTE)[number]) => libelleCritere(c, langue),
              },
              {
                cle: "sens",
                entete: t("Sens de lecture", "Reading direction"),
                rendu: (c) => libelleSensCritere(RED_CRITERE_ALERTE_SENS[c], langue),
              },
              {
                cle: "orange",
                entete: t("Seuil orange", "Orange threshold"),
                alignement: "droite",
                rendu: (c) => formaterSeuil(c, valeurs[c].orange, langue),
              },
              {
                cle: "rouge",
                entete: t("Seuil rouge", "Red threshold"),
                alignement: "droite",
                rendu: (c) => formaterSeuil(c, valeurs[c].rouge, langue),
              },
              {
                cle: "poids",
                entete: t("Poids", "Weight"),
                alignement: "droite",
                rendu: (c) => valeurs[c].poids,
              },
            ]}
            lignes={RED_CRITERES_ALERTE}
            cleLigne={(c) => c}
          />
        </div>
      </Carte>

      <Carte titre={t("Versions", "Versions")}>
        <VersionsSeuils
          versions={versions}
          peutPublier={s?.peut_publier ?? false}
          peutParametrer={peutParametrer}
        />
      </Carte>

      {peutParametrer ? (
        <Carte titre={t("Rédiger un brouillon", "Write a draft")}>
          <p className="mp-texte-doux">
            {t(
              "Le formulaire part de la version en vigueur, ou des valeurs par défaut du moteur.",
              "The form starts from the version in force, or from the engine default values.",
            )}
          </p>
          <EditeurSeuils
            key={`${secteur}-${enVigueur?.id ?? "defaut"}`}
            secteur={secteur}
            depart={enVigueur?.seuils ?? etat.defaut_moteur}
          />
        </Carte>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Lecture seule : la rédaction et la publication des seuils reviennent aux experts du cabinet.",
              "Read-only: drafting and publishing thresholds is up to the firm's experts.",
            )}
          </p>
        </Alerte>
      )}
    </>
  );
}

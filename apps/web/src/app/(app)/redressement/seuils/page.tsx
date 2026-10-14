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
import {
  AVERTISSEMENT_SEUILS_DEFAUT,
  cheminSeuilsSecteur,
  formaterSeuil,
  hrefSeuilsSecteur,
  libelleCritere,
  libelleSensCritere,
  libelleSecteur,
  lireSecteur,
  OPTIONS_SECTEURS,
  TEXTE_SEUILS_AUCUNE_VERSION,
} from "../../../../lib/redressement";
import { aPermission } from "@missionpilot/shared";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Seuils d'alerte" };

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
  const secteur = lireSecteur((await searchParams).secteur);
  const peutParametrer = aPermission(session.utilisateur.roles, "redressement.parametrer");
  const r = await chargerServeur<RedSeuilsEtatVue>(cheminSeuilsSecteur(secteur));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Seuils d'alerte"
        soustitre="Seuils et pondérations du score d'alerte précoce, par secteur d'activité."
      />
      <div className="mp-red">
        <form
          method="get"
          action="/redressement/seuils"
          className="mp-filtres"
          aria-label="Choisir un secteur"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle="Secteur"
              name="secteur"
              defaultValue={secteur}
              options={OPTIONS_SECTEURS}
            />
          </div>
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            Afficher
          </button>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="Les seuils d'alerte n'ont pas pu être chargés."
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

function Seuils({
  etat,
  secteur,
  peutParametrer,
}: {
  etat: RedSeuilsEtatVue;
  secteur: ReturnType<typeof lireSecteur>;
  peutParametrer: boolean;
}) {
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
            ? `Secteur ${libelleSecteur(secteur)} : version ${enVigueur.version} en vigueur`
            : `Secteur ${libelleSecteur(secteur)}`
        }
      >
        <div className="mp-red-carte-corps">
          {enVigueur === null ? (
            <Alerte tonalite="attention" annonce="aucune">
              <p>{TEXTE_SEUILS_AUCUNE_VERSION}</p>
              <p>{AVERTISSEMENT_SEUILS_DEFAUT}</p>
            </Alerte>
          ) : null}
          <Tableau
            legende="Seuils en vigueur par critère"
            colonnes={[
              {
                cle: "critere",
                entete: "Critère",
                rendu: (c: (typeof RED_CRITERES_ALERTE)[number]) => libelleCritere(c),
              },
              {
                cle: "sens",
                entete: "Sens de lecture",
                rendu: (c) => libelleSensCritere(RED_CRITERE_ALERTE_SENS[c]),
              },
              {
                cle: "orange",
                entete: "Seuil orange",
                alignement: "droite",
                rendu: (c) => formaterSeuil(c, valeurs[c].orange),
              },
              {
                cle: "rouge",
                entete: "Seuil rouge",
                alignement: "droite",
                rendu: (c) => formaterSeuil(c, valeurs[c].rouge),
              },
              {
                cle: "poids",
                entete: "Poids",
                alignement: "droite",
                rendu: (c) => valeurs[c].poids,
              },
            ]}
            lignes={RED_CRITERES_ALERTE}
            cleLigne={(c) => c}
          />
        </div>
      </Carte>

      <Carte titre="Versions">
        <VersionsSeuils
          versions={versions}
          peutPublier={s?.peut_publier ?? false}
          peutParametrer={peutParametrer}
        />
      </Carte>

      {peutParametrer ? (
        <Carte titre="Rédiger un brouillon">
          <p className="mp-texte-doux">
            Le formulaire part de la version en vigueur, ou des valeurs par défaut du moteur.
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
            Lecture seule : la rédaction et la publication des seuils reviennent aux experts du
            cabinet.
          </p>
        </Alerte>
      )}
    </>
  );
}

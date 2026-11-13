import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BoutonPreparer } from "../../../../../components/avancement/BoutonPreparer";
import { ParametresAvancement } from "../../../../../components/avancement/ParametresAvancement";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  CHEMIN_API_PARAMETRES_AVANCEMENT,
  cheminApiListeAvancement,
  etatCommentaire,
  etatRapport,
  formaterAvancement,
  hrefAvancementMission,
  hrefRapportAvancement,
  libelleSemaineRapport,
  lireAvant,
  libellesAvancement,
  type LigneAvancement,
  type PageAvancement,
  type ParametresAvancement as Parametres,
} from "../../../../../lib/avancement";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Avancement de la mission", "Engagement progress") };
}

/**
 * Rapports d'avancement hebdomadaires d'une mission (AUT-10) : un brouillon par semaine, relu par le
 * chef de mission puis validé. Les chiffres viennent du moteur (jamais modifiables ici). Le client ne
 * voit un rapport qu'une fois validé ; aucun e-mail n'est envoyé.
 */
export default async function PageAvancementMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const libelles = libellesAvancement(langue);
  const { utilisateur } = await exigerPermission("avancement.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const avant = lireAvant((await searchParams).avant);
  const gestionnaire = aPermission(utilisateur.roles, "automatisation.gerer");
  const peutPreparer =
    aPermission(utilisateur.roles, "avancement.valider") &&
    ["signee", "en_cours"].includes(r.donnees.statut);
  const [liste, parametres] = await Promise.all([
    chargerServeur<PageAvancement>(cheminApiListeAvancement(id, avant)),
    gestionnaire
      ? chargerServeur<Parametres>(CHEMIN_API_PARAMETRES_AVANCEMENT)
      : Promise.resolve(null),
  ]);

  const colonnes: ColonneTableau<LigneAvancement>[] = [
    {
      cle: "semaine",
      entete: t("Semaine", "Week"),
      rendu: (l) => (
        <Link href={hrefRapportAvancement(id, l.id)}>{libelleSemaineRapport(l, langue)}</Link>
      ),
    },
    {
      cle: "avancement",
      entete: t("Avancement", "Progress"),
      alignement: "droite",
      rendu: (l) => formaterAvancement(l.avancement_pourcentage, langue),
    },
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (l) => {
        const e = etatRapport(l.statut, langue);
        return <BadgeStatut tonalite={e.tonalite}>{e.libelle}</BadgeStatut>;
      },
    },
    {
      cle: "commentaire",
      entete: t("Commentaire", "Comment"),
      rendu: (l) => {
        const e = etatCommentaire(l.statut_commentaire, langue);
        return e ? (
          <BadgeStatut tonalite={e.tonalite}>{e.libelle}</BadgeStatut>
        ) : (
          <span className="mp-texte-doux">{t("Aucun", "None")}</span>
        );
      },
    },
    {
      cle: "valide_le",
      entete: t("Validé le", "Approved on"),
      rendu: (l) => (l.valide_le ? formaterDate(l.valide_le, "Africa/Abidjan", langue) : "—"),
    },
  ];

  return (
    <div className="mp-pile mp-pile--large">
      <section aria-labelledby="titre-avancement" className="mp-pile">
        <h2 id="titre-avancement" className="mp-section__titre">
          {t("Rapports d'avancement hebdomadaires", "Weekly progress reports")}
        </h2>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Un point chiffré par semaine pour le client : vous relisez, complétez l'introduction et le commentaire, puis vous validez. Du plus récent au plus ancien.",
            "A weekly update with figures for the client: you review, complete the introduction and the comment, then approve. Most recent first.",
          )}
        </p>
        <Alerte tonalite="info" annonce="aucune">
          <p>{libelles.mentionVisibiliteClient}</p>
        </Alerte>
        {peutPreparer ? <BoutonPreparer missionId={id} /> : null}
        {!liste.ok ? (
          <EtatErreur
            titre={t("Les rapports n'ont pas pu être chargés.", "The reports could not be loaded.")}
            message={liste.message}
            hrefReessayer={hrefAvancementMission(id, avant)}
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              avant
                ? t("Aucun autre rapport.", "No more reports.")
                : libelles.aucunRapportCabinet.titre
            }
            icone="calendrier"
          >
            <p>
              {avant
                ? t(
                    "Vous avez atteint la fin de la liste.",
                    "You have reached the end of the list.",
                  )
                : libelles.aucunRapportCabinet.aide}
            </p>
          </EtatVide>
        ) : (
          <Tableau
            legende={t(
              "Rapports d'avancement hebdomadaires, du plus récent au plus ancien",
              "Weekly progress reports, most recent first",
            )}
            colonnes={colonnes}
            lignes={liste.donnees.elements}
            cleLigne={(l) => l.id}
          />
        )}
        {liste.ok ? (
          <PaginationCurseur
            hrefSuivante={
              liste.donnees.suivant ? hrefAvancementMission(id, liste.donnees.suivant) : null
            }
            hrefDebut={avant ? hrefAvancementMission(id) : null}
            libelle={t("Pages des rapports d'avancement", "Progress report pages")}
          />
        ) : null}
      </section>
      {parametres?.ok ? <ParametresAvancement parametres={parametres.donnees} /> : null}
    </div>
  );
}

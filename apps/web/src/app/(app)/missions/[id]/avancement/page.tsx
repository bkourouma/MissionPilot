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
  aucunRapportCabinet,
  CHEMIN_API_PARAMETRES_AVANCEMENT,
  cheminApiListeAvancement,
  etatCommentaire,
  etatRapport,
  formaterAvancement,
  hrefAvancementMission,
  hrefRapportAvancement,
  libelleSemaineRapport,
  lireAvant,
  MENTION_VISIBILITE_CLIENT,
  type LigneAvancement,
  type PageAvancement,
  type ParametresAvancement as Parametres,
} from "../../../../../lib/avancement";
import { formaterDate } from "../../../../../lib/format";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Avancement de la mission" };

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
      entete: "Semaine",
      rendu: (l) => <Link href={hrefRapportAvancement(id, l.id)}>{libelleSemaineRapport(l)}</Link>,
    },
    {
      cle: "avancement",
      entete: "Avancement",
      alignement: "droite",
      rendu: (l) => formaterAvancement(l.avancement_pourcentage),
    },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (l) => {
        const e = etatRapport(l.statut);
        return <BadgeStatut tonalite={e.tonalite}>{e.libelle}</BadgeStatut>;
      },
    },
    {
      cle: "commentaire",
      entete: "Commentaire",
      rendu: (l) => {
        const e = etatCommentaire(l.statut_commentaire);
        return e ? (
          <BadgeStatut tonalite={e.tonalite}>{e.libelle}</BadgeStatut>
        ) : (
          <span className="mp-texte-doux">Aucun</span>
        );
      },
    },
    {
      cle: "valide_le",
      entete: "Validé le",
      rendu: (l) => (l.valide_le ? formaterDate(l.valide_le, "Africa/Abidjan") : "—"),
    },
  ];

  return (
    <div className="mp-pile mp-pile--large">
      <section aria-labelledby="titre-avancement" className="mp-pile">
        <h2 id="titre-avancement" className="mp-section__titre">
          Rapports d&apos;avancement hebdomadaires
        </h2>
        <p className="mp-texte-doux mp-texte-petit">
          Un point chiffré par semaine pour le client : vous relisez, complétez l&apos;introduction
          et le commentaire, puis vous validez. Du plus récent au plus ancien.
        </p>
        <Alerte tonalite="info" annonce="aucune">
          <p>{MENTION_VISIBILITE_CLIENT}</p>
        </Alerte>
        {peutPreparer ? <BoutonPreparer missionId={id} /> : null}
        {!liste.ok ? (
          <EtatErreur
            titre="Les rapports n'ont pas pu être chargés."
            message={liste.message}
            hrefReessayer={hrefAvancementMission(id, avant)}
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={avant ? "Aucun autre rapport." : aucunRapportCabinet.titre}
            icone="calendrier"
          >
            <p>{avant ? "Vous avez atteint la fin de la liste." : aucunRapportCabinet.aide}</p>
          </EtatVide>
        ) : (
          <Tableau
            legende="Rapports d'avancement hebdomadaires, du plus récent au plus ancien"
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
            libelle="Pages des rapports d'avancement"
          />
        ) : null}
      </section>
      {parametres?.ok ? <ParametresAvancement parametres={parametres.donnees} /> : null}
    </div>
  );
}

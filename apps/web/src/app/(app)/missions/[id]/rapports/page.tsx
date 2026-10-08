import type { Metadata } from "next";
import { GenerationRapport } from "../../../../../components/rapports/GenerationRapport";
import { ListeRapports } from "../../../../../components/rapports/ListeRapports";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  cheminListeRapports,
  hrefRapports,
  lireCurseur,
  niveauGenere,
  personnesConnues,
  type PageRapports,
} from "../../../../../lib/rapports";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Rapports de la mission" };

/**
 * Rapports de la mission (SOC-07) : génération de l'« État d'avancement » (PDF, Word,
 * PowerPoint) et liste paginée des rapports générés que l'utilisateur peut lire. Le niveau du
 * rapport (avancement, jours, finances) découle de ses droits ; l'API reste seule juge.
 */
export default async function PageRapportsMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const curseur = lireCurseur((await searchParams).curseur);
  const [liste, personnesCabinet] = await Promise.all([
    chargerServeur<PageRapports>(cheminListeRapports(m.id, curseur)),
    chargerPersonnes(utilisateur.roles),
  ]);
  const cloturee = m.statut === "cloturee";
  const personnes = personnesConnues(personnesCabinet, m.equipe);

  return (
    <div className="mp-pile mp-pile--large">
      <Carte titre="Générer un état d'avancement">
        <GenerationRapport
          missionId={m.id}
          niveau={niveauGenere(utilisateur.roles)}
          cloturee={cloturee}
          premierePage={!curseur}
        />
      </Carte>

      <section aria-labelledby="titre-rapports" className="mp-pile">
        <h2 id="titre-rapports" className="mp-section__titre">
          Rapports générés
        </h2>
        <p className="mp-texte-doux mp-texte-petit">
          Du plus récent au plus ancien. Seuls les rapports que vos droits vous permettent
          d&apos;ouvrir sont listés.
        </p>
        {!liste.ok ? (
          <EtatErreur
            titre="Les rapports n'ont pas pu être chargés."
            message={liste.message}
            hrefReessayer={hrefRapports(m.id)}
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={curseur ? "Aucun autre rapport." : "Aucun rapport généré pour cette mission."}
            icone="dossier"
          >
            <p>
              {cloturee
                ? "La mission est clôturée : aucun rapport ne peut plus être généré."
                : "Générez un état d'avancement ci-dessus : il apparaîtra ici, prêt à télécharger."}
            </p>
          </EtatVide>
        ) : (
          <ListeRapports
            rapports={liste.donnees.elements}
            utilisateurId={utilisateur.id}
            personnes={personnes}
          />
        )}
        {liste.ok ? (
          <PaginationCurseur
            libelle="Pages des rapports"
            hrefSuivante={
              liste.donnees.curseur_suivant
                ? hrefRapports(m.id, liste.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? hrefRapports(m.id) : null}
          />
        ) : null}
      </section>
    </div>
  );
}

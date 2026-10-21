import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChiffresRapport } from "../../../../../components/avancement/ChiffresRapport";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import {
  cheminApiPortailRapport,
  CHEMIN_AVANCEMENT_PORTAIL,
  hrefRapportPortail,
  libelleSemaineRapport,
  type RapportPortailAvancement,
} from "../../../../../lib/avancement";
import { formaterDate } from "../../../../../lib/format";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Rapport d'avancement" };

/**
 * Un rapport d'avancement hebdomadaire validé : introduction et commentaire du chef de mission, puis
 * les chiffres de la semaine. Copie figée, en lecture seule ; 404 uniforme de l'API : « introuvable ».
 */
export default async function DetailAvancementPortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.avancement.lire")) {
    return <NonDisponible titre="Avancement" />;
  }
  const r = await chargerPortail<RapportPortailAvancement>(cheminApiPortailRapport(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_AVANCEMENT_PORTAIL, libelle: "Avancement" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Rapport d'avancement" retour={retour} />
        <EtatErreur
          titre="Le rapport n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefRapportPortail(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={libelleSemaineRapport(d)}
        retour={retour}
        soustitre={`${d.mission_intitule} · publié le ${formaterDate(d.valide_le, "Africa/Abidjan")}`}
        badges={
          <BadgeStatut tonalite="neutre" sansIcone>
            Lecture seule
          </BadgeStatut>
        }
      />
      {d.introduction ? (
        <Carte titre="Introduction" niveauTitre={2}>
          <p style={{ whiteSpace: "pre-line" }}>{d.introduction}</p>
        </Carte>
      ) : null}
      <ChiffresRapport contenu={d.contenu} pourClient />
      {d.commentaire ? (
        <Carte titre="Commentaire du chef de mission" niveauTitre={2}>
          <p style={{ whiteSpace: "pre-line" }}>{d.commentaire}</p>
        </Carte>
      ) : null}
    </div>
  );
}
